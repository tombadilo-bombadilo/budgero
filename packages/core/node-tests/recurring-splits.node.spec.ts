import initSqlJs from 'sql.js';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { NodeSqlJsAdapter, ServiceManager, type Services } from '../src';
import { asMilli } from '../src/money';
import { migrations } from '../src/database/migrations.js';
import { createMigrationDatabase } from '../src/database/migration-database-factory.js';
import type { RecurringSplitLine } from '../src/services/recurring/types';
import { dumpDb } from './db-dump.helpers';

function isoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const line = (
  outflow: number,
  target: { categoryId?: number; transferAccountId?: number },
  extra: Partial<RecurringSplitLine> = {}
): RecurringSplitLine => ({
  categoryId: target.categoryId ?? null,
  transferAccountId: target.transferAccountId ?? null,
  memo: '',
  payee: '',
  inflow: asMilli(0),
  outflow: asMilli(outflow),
  ...extra,
});

describe('recurring transactions with split lines', () => {
  let services: Services;
  let budgetId: number;
  let checking: number;
  let savings: number;
  let groceries: number;
  let rent: number;
  const startDate = isoDate(new Date());

  beforeEach(async () => {
    const adapter = await NodeSqlJsAdapter.create();
    const manager = new ServiceManager();
    await manager.initialize(adapter);
    services = manager.getServices();
    budgetId = await services.budgets.createBudget({
      name: 'Splits',
      display_currency: 'USD',
      badge_icon: 'dollar',
      number_format: 'dollar',
      create_default_categories: true,
    });
    checking = (await services.accounts.createAccount('Checking', budgetId, 'checking', 'USD', 0))
      .ID;
    savings = (await services.accounts.createAccount('Savings', budgetId, 'savings', 'USD', 0)).ID;
    const groupId = services.categories.addCategoryGroup('Bills', budgetId);
    groceries = services.categories.addCategory(groupId, budgetId, 'Groceries');
    rent = services.categories.addCategory(groupId, budgetId, 'Rent');
  });

  const create = (splits: RecurringSplitLine[] | null, extra: Record<string, unknown> = {}) =>
    services.recurring.createRecurringTransaction({
      budgetId,
      accountId: checking,
      categoryId: null,
      name: 'Payday moves',
      amount: asMilli(100_000),
      direction: 'outflow',
      schedule: { startDate, intervalUnit: 'month', intervalCount: 1 },
      splits,
      ...extra,
    });

  const firstOccurrence = (templateId: number) =>
    services.recurring
      .listOccurrences(budgetId, { status: 'scheduled' })
      .find((o) => o.recurringTransactionId === templateId)!;

  describe('validation', () => {
    it('stores the lines and drops the category', async () => {
      const template = await create(
        [
          line(60_000, { categoryId: rent }),
          line(40_000, { categoryId: groceries }, { memo: ' food ' }),
        ],
        { categoryId: groceries }
      );
      expect(template.categoryId).toBeNull();
      expect(template.splits).toEqual([
        line(60_000, { categoryId: rent }),
        line(40_000, { categoryId: groceries }, { memo: 'food' }),
      ]);
      expect(services.recurring.getRecurringTransaction(template.id).splits).toHaveLength(2);
    });

    it('treats null and [] as no splits', async () => {
      expect((await create(null, { categoryId: rent })).splits).toBeNull();
      expect((await create([], { categoryId: rent })).splits).toBeNull();
    });

    it('rejects lines that do not add up or are malformed', async () => {
      await expect(
        create([line(60_000, { categoryId: rent }), line(30_000, { categoryId: groceries })])
      ).rejects.toThrow(/sum/);
      // One line is allowed, as in the add form (e.g. a copied one-line split).
      await expect(create([line(100_000, { categoryId: rent })])).resolves.toBeTruthy();
      await expect(
        create([
          line(60_000, { categoryId: rent, transferAccountId: savings }),
          line(40_000, { categoryId: groceries }),
        ])
      ).rejects.toThrow(/either a category or a transfer account/);
      await expect(
        create([line(60_000, {}), line(40_000, { categoryId: groceries })])
      ).rejects.toThrow(/either a category or a transfer account/);
      await expect(
        create([
          line(60_000, { categoryId: rent }, { inflow: asMilli(1) }),
          line(40_000, { categoryId: groceries }),
        ])
      ).rejects.toThrow(/inflow or an outflow/);
      await expect(
        create([
          { ...line(0, { categoryId: rent }), outflow: 60_000.5 as never },
          { ...line(0, { categoryId: groceries }), outflow: 39_999.5 as never },
        ])
      ).rejects.toThrow(/inflow or an outflow/);
      await expect(
        create([line(60_000, { transferAccountId: checking }), line(40_000, { categoryId: rent })])
      ).rejects.toThrow(/own account/);
      // Inflow templates: lines sum to +amount.
      await expect(
        create(
          [
            { ...line(0, { categoryId: rent }), inflow: asMilli(70_000) },
            { ...line(0, { categoryId: groceries }), inflow: asMilli(30_000) },
          ],
          { direction: 'inflow' }
        )
      ).resolves.toMatchObject({ direction: 'inflow' });
    });

    it('does not split transfer templates', async () => {
      await expect(
        create([line(60_000, { categoryId: rent }), line(40_000, { categoryId: groceries })], {
          toAccountId: savings,
        })
      ).rejects.toThrow(/transfers cannot be split/);
    });

    it('update keeps, replaces and clears the lines', async () => {
      const template = await create([
        line(60_000, { categoryId: rent }),
        line(40_000, { categoryId: groceries }),
      ]);

      // Kept lines must still match a new amount.
      await expect(
        services.recurring.updateRecurringTransaction(template.id, { amount: asMilli(90_000) })
      ).rejects.toThrow(/sum/);
      const renamed = await services.recurring.updateRecurringTransaction(template.id, {
        name: 'Renamed',
      });
      expect(renamed.splits).toHaveLength(2);

      const replaced = await services.recurring.updateRecurringTransaction(template.id, {
        amount: asMilli(90_000),
        splits: [line(50_000, { categoryId: rent }), line(40_000, { transferAccountId: savings })],
      });
      expect(replaced.amount).toBe(90_000);
      expect(replaced.splits?.[1].transferAccountId).toBe(savings);

      const cleared = await services.recurring.updateRecurringTransaction(template.id, {
        splits: null,
        categoryId: rent,
      });
      expect(cleared.splits).toBeNull();
      expect(cleared.categoryId).toBe(rent);
    });
  });

  it('projects a split template as a Split row', async () => {
    const template = await create([
      line(60_000, { categoryId: rent }),
      line(40_000, { categoryId: groceries }),
    ]);
    const projected = services.recurring
      .listProjectedTransactions(budgetId, { accountId: checking })
      .find((row) => row.RecurringTransactionID === template.id)!;
    expect(projected).toMatchObject({
      Category: 'Split',
      CategoryID: null,
      OutflowNative: 100_000,
    });
  });

  it('marking ready posts the parent, its lines and the transfer mirror in one go', async () => {
    const template = await create([
      line(60_000, { categoryId: rent }, { memo: 'flat' }),
      line(40_000, { transferAccountId: savings }, { memo: 'saving' }),
    ]);
    const occurrence = firstOccurrence(template.id);

    const result = await services.recurring.markOccurrenceReady({
      occurrenceId: occurrence.id,
      recurringTransactionId: template.id,
      dueDate: occurrence.dueDate,
      payee: template.name,
    });
    expect(result.destinationTransactionId).toBeUndefined();

    const parent = services.transactions.getTransactionByID(result.transactionId);
    expect(parent).toMatchObject({
      AccountID: checking,
      // What transactions.add with splits stores for the parent.
      CategoryID: services.categories
        .getAllCategories(budgetId)
        .find((c) => c.Name === 'Uncategorized')!.ID,
      Payee: 'Payday moves',
      OutflowNative: 100_000,
      Date: occurrence.dueDate,
    });

    const lines = services.splits.getSplits(result.transactionId);
    expect(
      lines.map((l) => [l.CategoryID ?? null, l.TransferAccountID ?? null, l.OutflowNative, l.Memo])
    ).toEqual([
      [rent, null, 60_000, 'flat'],
      [null, savings, 40_000, 'saving'],
    ]);

    const mirrors = services.transactions.getTransactionsByAccount(savings);
    expect(mirrors).toHaveLength(1);
    expect(mirrors[0]).toMatchObject({ InflowConverted: 40_000 });
    expect(mirrors[0].TransferID).toBe(
      `split_transfer_${result.transactionId}_${occurrence.dueDate}`
    );

    expect(services.accounts.getAccount(checking)!.BalanceNative).toBe(-100_000);
    expect(services.accounts.getAccount(savings)!.BalanceNative).toBe(40_000);
    expect(services.recurring.getOccurrenceWithTemplate(occurrence.id)).toMatchObject({
      status: 'ready',
      transactionId: result.transactionId,
    });
  });

  it('undo of mark ready (delete + reset) removes the parent, lines and mirror', async () => {
    const template = await create([
      line(60_000, { categoryId: rent }),
      line(40_000, { transferAccountId: savings }),
    ]);
    const occurrence = firstOccurrence(template.id);
    const { transactionId } = await services.recurring.markOccurrenceReady({
      occurrenceId: occurrence.id,
    });

    // The markReady undo ops: transactions.delete, then recurring.resetOccurrence.
    services.transactions.deleteTransaction(transactionId);
    services.recurring.resetOccurrence({ occurrenceId: occurrence.id });

    expect(services.transactions.getTransactionsByAccount(checking)).toHaveLength(0);
    expect(services.transactions.getTransactionsByAccount(savings)).toHaveLength(0);
    expect(services.splits.getSplits(transactionId)).toEqual([]);
    expect(services.accounts.getAccount(checking)!.BalanceNative).toBe(0);
    expect(services.accounts.getAccount(savings)!.BalanceNative).toBe(0);
    expect(services.recurring.getOccurrenceWithTemplate(occurrence.id).status).toBe('scheduled');

    // Redo posts under the same parent ID again.
    const again = await services.recurring.markOccurrenceReady({
      occurrenceId: occurrence.id,
      reuse: { transactionId },
    });
    expect(again.transactionId).toBe(transactionId);
    expect(services.splits.getSplits(transactionId)).toHaveLength(2);
    expect(services.accounts.getAccount(savings)!.BalanceNative).toBe(40_000);
  });

  it('redo puts the transfer mirrors back under their first IDs (S7)', async () => {
    const template = await create([
      line(50_000, { transferAccountId: savings }),
      line(30_000, { categoryId: rent }),
      line(20_000, { transferAccountId: savings }),
    ]);
    const occurrence = firstOccurrence(template.id);
    const first = await services.recurring.markOccurrenceReady({ occurrenceId: occurrence.id });
    const mirrorIds = services.transactions
      .getTransactionsByAccount(savings)
      .map((tx) => tx.ID)
      .sort((x, y) => x - y);
    expect(mirrorIds).toHaveLength(2);
    expect(first.mirrorTransactionIds).toEqual(mirrorIds);
    const inflowById = () =>
      Object.fromEntries(
        services.transactions
          .getTransactionsByAccount(savings)
          .map((tx) => [tx.ID, tx.InflowNative])
      );
    const before = inflowById();

    services.transactions.deleteTransaction(first.transactionId);
    services.recurring.resetOccurrence({ occurrenceId: occurrence.id });
    // A row created meanwhile would take the next free IDs.
    await services.transactions.addTransaction(
      asMilli(0),
      asMilli(1_000),
      checking,
      rent,
      budgetId,
      startDate,
      'meanwhile',
      ''
    );

    const again = await services.recurring.markOccurrenceReady({
      occurrenceId: occurrence.id,
      reuse: {
        transactionId: first.transactionId,
        mirrorTransactionIds: first.mirrorTransactionIds,
      },
    });
    expect(again.transactionId).toBe(first.transactionId);
    expect(again.mirrorTransactionIds).toEqual(mirrorIds);
    expect(inflowById()).toEqual(before);
    expect(services.accounts.getAccount(savings)!.BalanceNative).toBe(70_000);
  });

  it('templates without transfer lines report no mirrors', async () => {
    const template = await create([
      line(60_000, { categoryId: rent }),
      line(40_000, { categoryId: groceries }),
    ]);
    const ready = await services.recurring.markOccurrenceReady({
      occurrenceId: firstOccurrence(template.id).id,
    });
    expect(ready.mirrorTransactionIds).toBeUndefined();
  });

  it('a line whose category is gone fails without posting anything', async () => {
    const template = await create([
      line(60_000, { categoryId: rent }),
      line(40_000, { categoryId: groceries }),
    ]);
    services.categories.deleteCategory(groceries);
    const occurrence = firstOccurrence(template.id);
    await expect(
      services.recurring.markOccurrenceReady({ occurrenceId: occurrence.id })
    ).rejects.toThrow(/category no longer exists/);
    expect(services.transactions.getTransactionsByAccount(checking)).toHaveLength(0);
    expect(services.recurring.getOccurrenceWithTemplate(occurrence.id).status).toBe('scheduled');
  });
});

describe('split lines follow category and account changes', () => {
  async function setup() {
    const db = await NodeSqlJsAdapter.create();
    const manager = new ServiceManager();
    await manager.initialize(db);
    const s = manager.getServices();
    const budgetId = await s.budgets.createBudget({
      name: 'Refs',
      display_currency: 'USD',
      badge_icon: 'dollar',
      number_format: 'dollar',
      create_default_categories: false,
    });
    const checking = (await s.accounts.createAccount('Checking', budgetId, 'checking', 'USD', 0))
      .ID;
    const savings = (await s.accounts.createAccount('Savings', budgetId, 'savings', 'USD', 0)).ID;
    const group = s.categories.addCategoryGroup('Bills', budgetId);
    const groceries = s.categories.addCategory(group, budgetId, 'Groceries');
    const rent = s.categories.addCategory(group, budgetId, 'Rent');
    const food = s.categories.addCategory(group, budgetId, 'Food');
    const template = await s.recurring.createRecurringTransaction({
      budgetId,
      accountId: checking,
      categoryId: null,
      name: 'Payday moves',
      amount: asMilli(100_000),
      direction: 'outflow',
      schedule: { startDate: isoDate(new Date()), intervalUnit: 'month', intervalCount: 1 },
      splits: [
        line(50_000, { categoryId: rent }),
        line(30_000, { categoryId: groceries }),
        line(20_000, { transferAccountId: savings }),
      ],
    });
    const lineTargets = () =>
      s.recurring
        .getRecurringTransaction(template.id, { includeInactive: true })
        .splits!.map((l) => l.categoryId ?? (l.transferAccountId ? 'transfer' : null));
    return { db, s, budgetId, checking, savings, groceries, rent, food, template, lineTargets };
  }

  it('counts split templates in the delete impact', async () => {
    const c = await setup();
    expect(c.s.categories.getCategoryDeletionImpact(c.groceries).scheduled).toBe(1);
    expect(c.s.categories.getCategoryDeletionImpact(c.food).scheduled).toBe(0);
  });

  it('delete and move: the line follows, and undo restores the database exactly', async () => {
    const c = await setup();
    const before = dumpDb(c.db);
    const journal = c.s.categories.deleteCategoryWithUndo(c.groceries, c.food);
    expect(c.lineTargets()).toEqual([c.rent, c.food, 'transfer']);
    c.s.categories.restoreDeletedCategories(JSON.parse(JSON.stringify(journal)));
    expect(dumpDb(c.db)).toEqual(before);
  });

  it('merge (reassign) moves the line to the surviving category', async () => {
    const c = await setup();
    c.s.transactions.reassignTransactions(c.food, c.groceries);
    expect(c.lineTargets()).toEqual([c.rent, c.food, 'transfer']);
  });

  it('delete without a destination: the line loses its category and posting says so', async () => {
    const c = await setup();
    const before = dumpDb(c.db);
    const journal = c.s.categories.deleteCategoryWithUndo(c.groceries);
    expect(c.lineTargets()).toEqual([c.rent, null, 'transfer']);

    const occurrence = c.s.recurring
      .listOccurrences(c.budgetId, { status: 'scheduled' })
      .find((o) => o.recurringTransactionId === c.template.id)!;
    await expect(
      c.s.recurring.markOccurrenceReady({ occurrenceId: occurrence.id })
    ).rejects.toMatchObject({ code: 'RECURRING_SPLIT_CATEGORY_MISSING' });
    // The template can still be paused, renamed, or given new lines.
    await c.s.recurring.updateRecurringTransaction(c.template.id, { active: false });
    await c.s.recurring.updateRecurringTransaction(c.template.id, { active: true });

    c.s.categories.restoreDeletedCategories(JSON.parse(JSON.stringify(journal)));
    expect(dumpDb(c.db)).toEqual(before);
  });

  it('two devices replaying the same delete write the same lines', async () => {
    const a = await setup();
    const b = await setup();
    a.s.categories.deleteCategoryWithUndo(a.groceries, a.food);
    b.s.categories.deleteCategoryWithUndo(b.groceries, b.food);
    const json = (c: typeof a) =>
      c.db.prepare('SELECT ID, SplitsJSON FROM recurring_transactions ORDER BY ID').all();
    expect(json(b)).toEqual(json(a));
  });

  it('deleting the transfer target deletes the template, and undo brings it back', async () => {
    const c = await setup();
    const before = dumpDb(c.db);
    const journal = c.s.accounts.deleteAccountWithUndo(c.savings);
    expect(journal).not.toBeNull();
    expect(c.s.recurring.listRecurringTransactions(c.budgetId, { includeInactive: true })).toEqual(
      []
    );
    expect(
      c.db.prepare('SELECT COUNT(*) AS n FROM recurring_transaction_occurrences').get()
    ).toMatchObject({ n: 0 });
    c.s.accounts.restoreDeletedAccount(JSON.parse(JSON.stringify(journal)));
    expect(dumpDb(c.db)).toEqual(before);
  });
});

describe('analytics projections of split templates', () => {
  it('gives each category its share and keeps transfer lines out of spending', async () => {
    const db = await NodeSqlJsAdapter.create();
    const manager = new ServiceManager();
    await manager.initialize(db);
    const s = manager.getServices();
    const budgetId = await s.budgets.createBudget({
      name: 'Proj',
      display_currency: 'USD',
      badge_icon: 'dollar',
      number_format: 'dollar',
      create_default_categories: false,
    });
    const checking = (await s.accounts.createAccount('Checking', budgetId, 'checking', 'USD', 0))
      .ID;
    const savings = (await s.accounts.createAccount('Savings', budgetId, 'savings', 'USD', 0)).ID;
    const bills = s.categories.addCategoryGroup('Bills', budgetId);
    const fun = s.categories.addCategoryGroup('Fun', budgetId);
    const rent = s.categories.addCategory(bills, budgetId, 'Rent');
    const games = s.categories.addCategory(fun, budgetId, 'Games');
    const gone = s.categories.addCategory(fun, budgetId, 'Gone');
    const today = new Date();
    const due = new Date(today.getFullYear(), today.getMonth() + 1, 15);
    const startDate = isoDate(today);
    const endDate = isoDate(new Date(today.getFullYear(), today.getMonth() + 1, 28));
    await s.recurring.createRecurringTransaction({
      budgetId,
      accountId: checking,
      categoryId: null,
      name: 'Payday moves',
      amount: asMilli(100_000),
      direction: 'outflow',
      schedule: { startDate: isoDate(due), intervalUnit: 'year', intervalCount: 1 },
      splits: [
        line(50_000, { categoryId: rent }),
        line(25_000, { categoryId: games }, { payee: 'Steam' }),
        line(5_000, { categoryId: gone }),
        line(20_000, { transferAccountId: savings }),
      ],
    });
    s.categories.deleteCategory(gone);
    s.recurring.ensureOccurrencesThrough(budgetId, endDate);
    const opts = { includeProjections: true };

    // 80 of the 100 is spending; the transfer line is not.
    expect(s.analytics.getPeriodSummary(startDate, endDate, budgetId, opts).TotalSpending).toBe(
      80_000
    );
    expect(s.analytics.getPeriodSummary(startDate, endDate, budgetId).TotalSpending).toBe(0);

    const byGroup = s.analytics.getSpendingByDatesByCategories(startDate, endDate, budgetId, opts);
    expect(Object.fromEntries(byGroup.map((row) => [row.CategoryGroupName, row.Spending]))).toEqual(
      { Bills: 50_000, Fun: 25_000 }
    );

    const top = s.analytics.getTopSpendingCategories(startDate, endDate, budgetId, 10, opts);
    expect(Object.fromEntries(top.map((row) => [row.CategoryName, row.Spending]))).toEqual({
      Rent: 50_000,
      Games: 25_000,
      Uncategorized: 5_000,
    });

    const payees = s.analytics.getSpendingByPayees(startDate, endDate, budgetId, opts);
    expect(Object.fromEntries(payees.map((row) => [row.Payee, row.Spending]))).toEqual({
      'Payday moves': 55_000,
      Steam: 25_000,
    });
  });
});

describe('patching a split template without sending its lines (S8)', () => {
  async function setup() {
    const db = await NodeSqlJsAdapter.create();
    const manager = new ServiceManager();
    await manager.initialize(db);
    const s = manager.getServices();
    const budgetId = await s.budgets.createBudget({
      name: 'Patch',
      display_currency: 'USD',
      badge_icon: 'dollar',
      number_format: 'dollar',
      create_default_categories: false,
    });
    const checking = (await s.accounts.createAccount('Checking', budgetId, 'checking', 'USD', 0))
      .ID;
    const savings = (await s.accounts.createAccount('Savings', budgetId, 'savings', 'USD', 0)).ID;
    const cash = (await s.accounts.createAccount('Cash', budgetId, 'cash', 'USD', 0)).ID;
    const group = s.categories.addCategoryGroup('Bills', budgetId);
    const rent = s.categories.addCategory(group, budgetId, 'Rent');
    const template = await s.recurring.createRecurringTransaction({
      budgetId,
      accountId: checking,
      categoryId: null,
      name: 'Payday moves',
      amount: asMilli(100_000),
      direction: 'outflow',
      schedule: { startDate: isoDate(new Date()), intervalUnit: 'month', intervalCount: 1 },
      splits: [line(60_000, { categoryId: rent }), line(40_000, { transferAccountId: savings })],
    });
    const patch = (p: Record<string, unknown>) =>
      s.recurring.updateRecurringTransaction(template.id, p);
    return { s, checking, savings, cash, rent, template, patch };
  }

  it('keeps the lines for patches that leave them consistent', async () => {
    const c = await setup();
    expect((await c.patch({ name: 'Renamed', memo: 'm' })).splits).toEqual(c.template.splits);
    expect((await c.patch({ accountId: c.cash })).splits).toEqual(c.template.splits);
    expect((await c.patch({ amount: asMilli(100_000), direction: 'outflow' })).splits).toEqual(
      c.template.splits
    );
    // An undo sends the old lines back unchanged: same thing.
    expect((await c.patch({ name: 'Back', splits: c.template.splits })).splits).toEqual(
      c.template.splits
    );
  });

  it('rejects only a result that cannot post, with a code the app translates', async () => {
    const c = await setup();
    await expect(c.patch({ amount: asMilli(90_000) })).rejects.toMatchObject({
      code: 'RECURRING_SPLIT_SUM_MISMATCH',
    });
    await expect(c.patch({ direction: 'inflow' })).rejects.toMatchObject({
      code: 'RECURRING_SPLIT_SUM_MISMATCH',
    });
    await expect(c.patch({ accountId: c.savings })).rejects.toMatchObject({
      code: 'RECURRING_SPLIT_OWN_ACCOUNT',
    });
    await expect(c.patch({ toAccountId: c.cash })).rejects.toMatchObject({
      code: 'RECURRING_SPLIT_ON_TRANSFER',
    });
    const stored = c.s.recurring.getRecurringTransaction(c.template.id);
    expect(stored).toMatchObject({ amount: 100_000, direction: 'outflow', accountId: c.checking });
    // Clearing or replacing the lines in the same patch is fine.
    expect(
      (await c.patch({ amount: asMilli(90_000), splits: null, categoryId: c.rent })).splits
    ).toBeNull();
  });
});

describe('migration 075: recurring split lines', () => {
  it('adds a nullable SplitsJSON column', async () => {
    const SQL = await initSqlJs({
      locateFile: (file: string) =>
        path.join(process.cwd(), 'node_modules', 'sql.js', 'dist', file),
    });
    const db = createMigrationDatabase(new SQL.Database());
    for (const m of migrations.filter((x) => x.version <= 74)) {
      try {
        if (typeof m.up === 'function') m.up(db);
        else db.exec(m.up);
      } catch (error) {
        if (!(error instanceof Error && error.message.includes('duplicate column'))) throw error;
      }
    }
    const m075 = migrations.find((m) => m.version === 75)!;
    expect(m075.verify!(db)).toBe(false);
    (m075.up as (d: typeof db) => void)(db);
    expect(m075.verify!(db)).toBe(true);
    const column = db
      .exec('PRAGMA table_info(recurring_transactions)')[0]
      .values.find((row) => row[1] === 'SplitsJSON');
    // [cid, name, type, notnull, dflt_value, pk]
    expect(column?.slice(2, 5)).toEqual(['TEXT', 0, 'NULL']);
    // Re-running is a no-op.
    (m075.up as (d: typeof db) => void)(db);
    expect(m075.verify!(db)).toBe(true);
  });

  it('fails on anything but an existing column', async () => {
    const SQL = await initSqlJs({
      locateFile: (file: string) =>
        path.join(process.cwd(), 'node_modules', 'sql.js', 'dist', file),
    });
    // No recurring_transactions table: the ALTER fails for another reason.
    const db = createMigrationDatabase(new SQL.Database());
    const m075 = migrations.find((m) => m.version === 75)!;
    expect(() => (m075.up as (d: typeof db) => void)(db)).toThrow(/no such table/);
  });
});
