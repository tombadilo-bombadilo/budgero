import initSqlJs from 'sql.js';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { NodeSqlJsAdapter, ServiceManager, type Services } from '../src';
import { asMilli } from '../src/money';
import { migrations } from '../src/database/migrations.js';
import { createMigrationDatabase } from '../src/database/migration-database-factory.js';
import type { RecurringSplitLine } from '../src/services/recurring/types';

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
});
