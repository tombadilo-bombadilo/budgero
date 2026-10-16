import { beforeEach, describe, expect, it } from 'vitest';
import {
  asMilli,
  NodeSqlJsAdapter,
  ServiceManager,
  type GetAllTransactions,
  type Services,
} from '../src';

// Lighter twins of whole-ledger reads (payee names, the dashboard's newest
// uncategorized rows, balance-history aggregates). Each is checked against the
// query it replaces on data that hits the edge cases of the old code.

describe('lighter ledger queries match the queries they replace', () => {
  let adapter: NodeSqlJsAdapter;
  let services: Services;
  let budgetId: number;
  let otherBudgetId: number;
  let checking: number;
  let card: number;
  let groceries: number;
  let rent: number;
  let uncategorized: number;

  const exec = (sql: string, ...params: unknown[]) => adapter.prepare(sql).run(...params);
  const add = (
    accountId: number,
    date: string,
    inflow: number,
    outflow: number,
    categoryId: number,
    payee = '',
    memo = ''
  ) =>
    services.transactions.addTransaction(
      asMilli(inflow),
      asMilli(outflow),
      accountId,
      categoryId,
      budgetId,
      date,
      memo,
      '',
      payee
    );

  const createBudget = (name: string) =>
    services.budgets.createBudget({
      name,
      display_currency: 'USD',
      badge_icon: 'dollar',
      number_format: '123,456.78',
      create_default_categories: true,
    });

  beforeEach(async () => {
    adapter = await NodeSqlJsAdapter.create();
    const manager = new ServiceManager();
    await manager.initialize(adapter);
    services = manager.getServices();
    budgetId = await createBudget('Main');
    otherBudgetId = await createBudget('Other');
    checking = (
      await services.accounts.createAccount('Checking', budgetId, 'checking', 'USD', asMilli(0))
    ).ID;
    card = (await services.accounts.createAccount('Card', budgetId, 'credit', 'USD', asMilli(0)))
      .ID;
    const categories = services.categories.getAllCategories(budgetId);
    uncategorized = categories.find((c) => c.Name === 'Uncategorized')!.ID;
    const spending = categories.filter(
      (c) => !['Income', 'Uncategorized', 'Transfers'].includes(c.Name)
    );
    groceries = spending[0].ID;
    rent = spending[1].ID;
  });

  describe('getPayeeNames', () => {
    const reference = (id: number) => services.payees.getPayeesWithUsage(id).map((p) => p.Name);

    it('returns exactly the usage directory names, in order', async () => {
      await add(checking, '2026-01-02', 0, 1_000, groceries, 'Amazon');
      await add(checking, '2026-01-03', 0, 1_000, groceries, 'AMAZON');
      await add(checking, '2026-01-04', 0, 1_000, groceries, 'amazon');
      await add(checking, '2026-01-05', 0, 1_000, groceries, 'Ärzte');
      await add(checking, '2026-01-06', 0, 1_000, groceries, 'ärzte');
      await add(checking, '2026-01-07', 0, 1_000, groceries, 'Zoo');
      await add(card, '2026-01-08', 0, 1_000, rent, 'Landlord');
      // A payee that only appears in rows written without the payee directory.
      const raw = await add(checking, '2026-01-09', 0, 1_000, groceries, 'Seed');
      exec(`UPDATE transactions SET Payee = 'Raw Only' WHERE ID = ?`, raw);
      // Case variants known only from rows (no saved entry): the directory
      // keeps whichever spelling the usage query's case-folded GROUP BY picks.
      for (const [i, name] of ['Mixed Case', 'MIXED CASE', 'mixed case', 'Mixed case'].entries()) {
        const id = await add(card, `2026-01-2${i}`, 0, 100, rent, 'Seed');
        exec(`UPDATE transactions SET Payee = ? WHERE ID = ?`, name, id);
      }
      // Blank and whitespace payees are not names.
      const blank = await add(checking, '2026-01-10', 0, 1_000, groceries, 'Tmp');
      exec(`UPDATE transactions SET Payee = '   ' WHERE ID = ?`, blank);
      // Saved-only payees and a saved case variant of a used one.
      services.payees.addPayee(budgetId, 'Saved Only');
      services.payees.addPayee(budgetId, 'zoo');
      // A split parent whose lines carry payees: the parent payee is not used.
      const parent = await add(checking, '2026-01-11', 0, 2_000, groceries, 'Parent Only');
      exec(`DELETE FROM payees WHERE Name = 'Parent Only'`);
      await services.splits.upsertSplits(parent, [
        {
          CategoryID: groceries,
          Memo: '',
          Payee: 'Line A',
          InflowConverted: asMilli(0),
          OutflowConverted: asMilli(1_000),
          InflowNative: asMilli(0),
          OutflowNative: asMilli(1_000),
          OrderIndex: 0,
        },
        {
          CategoryID: rent,
          Memo: '',
          Payee: 'line a',
          InflowConverted: asMilli(0),
          OutflowConverted: asMilli(1_000),
          InflowNative: asMilli(0),
          OutflowNative: asMilli(1_000),
          OrderIndex: 1,
        },
      ]);
      // Another budget's payees stay out.
      services.payees.addPayee(otherBudgetId, 'Elsewhere');

      const names = services.payees.getPayeeNames(budgetId);
      expect(names).toEqual(reference(budgetId));
      expect(names).toContain('Raw Only');
      expect(names).toContain('Saved Only');
      expect(names).not.toContain('Parent Only');
      expect(names).not.toContain('Elsewhere');
      expect(services.payees.getPayeeNames(otherBudgetId)).toEqual(reference(otherBudgetId));
    });

    it('matches on random case variants in rows and split lines', async () => {
      let seed = 7;
      const rand = () => {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        return seed / 2147483648;
      };
      const spell = (base: string) =>
        [...base].map((ch) => (rand() < 0.5 ? ch.toUpperCase() : ch.toLowerCase())).join('');
      const bases = ['north shop', 'east cafe', 'süd markt', 'west'];
      for (let i = 0; i < 120; i++) {
        const id = await add(
          i % 2 ? card : checking,
          `2026-04-${String((i % 28) + 1).padStart(2, '0')}`,
          0,
          100,
          groceries,
          'Seed'
        );
        exec(`UPDATE transactions SET Payee = ? WHERE ID = ?`, spell(bases[i % bases.length]), id);
        if (i % 10 === 0) {
          await services.splits.upsertSplits(id, [
            {
              CategoryID: groceries,
              Memo: '',
              Payee: spell(bases[(i + 1) % bases.length]),
              InflowConverted: asMilli(0),
              OutflowConverted: asMilli(100),
              InflowNative: asMilli(0),
              OutflowNative: asMilli(100),
              OrderIndex: 0,
            },
          ]);
        }
      }
      exec(`DELETE FROM payees WHERE BudgetID = ?`, budgetId);
      expect(services.payees.getPayeeNames(budgetId)).toEqual(reference(budgetId));
    });

    it('matches after payee edits, deletes and renames', async () => {
      const a = await add(checking, '2026-02-01', 0, 1_000, groceries, 'Cafe');
      await add(checking, '2026-02-02', 0, 1_000, groceries, 'Bakery');
      expect(services.payees.getPayeeNames(budgetId)).toEqual(reference(budgetId));
      await services.transactions.updateTransactionColumn(a, 'Payee', 'Café');
      expect(services.payees.getPayeeNames(budgetId)).toEqual(reference(budgetId));
      services.payees.renamePayee(budgetId, 'Bakery', 'Boulangerie');
      expect(services.payees.getPayeeNames(budgetId)).toEqual(reference(budgetId));
      services.transactions.deleteTransaction(a);
      expect(services.payees.getPayeeNames(budgetId)).toEqual(reference(budgetId));
    });
  });

  describe('getRecentUncategorizedTransactions', () => {
    // The dashboard card's old in-memory filter over getAllTransactions.
    const reference = (id: number, limit: number): GetAllTransactions[] =>
      services.transactions
        .getAllTransactions(id)
        .filter((t) => {
          if (t.Category === 'Split') return false;
          return (
            !t.CategoryID || t.CategoryID === 0 || !t.Category || t.Category === 'Uncategorized'
          );
        })
        .sort((a, b) => new Date(b.Date).getTime() - new Date(a.Date).getTime())
        .slice(0, limit);

    it('returns the same newest rows and columns as filtering the whole ledger', async () => {
      for (let d = 1; d <= 9; d++) {
        await add(checking, `2026-03-0${d}`, 0, 1_000 * d, uncategorized, `P${d}`, `memo ${d}`);
        await add(card, `2026-03-0${d}`, 0, 500, uncategorized);
        await add(checking, `2026-03-0${d}`, 0, 700, groceries);
      }
      // A split parent filed under Uncategorized is not uncategorized.
      const parent = await add(checking, '2026-03-20', 0, 2_000, uncategorized);
      await services.splits.upsertSplits(parent, [
        {
          CategoryID: groceries,
          Memo: '',
          Payee: '',
          InflowConverted: asMilli(0),
          OutflowConverted: asMilli(2_000),
          InflowNative: asMilli(0),
          OutflowNative: asMilli(2_000),
          OrderIndex: 0,
        },
      ]);
      // A category renamed to '' counts as uncategorized.
      exec(`UPDATE categories SET Name = '' WHERE ID = ?`, rent);
      await add(checking, '2026-03-15', 0, 300, rent);
      // Rows left on CategoryID 0 or a missing category (foreign keys off).
      exec('PRAGMA foreign_keys = OFF');
      const zero = await add(checking, '2026-03-16', 0, 100, groceries);
      exec('UPDATE transactions SET CategoryID = 0 WHERE ID = ?', zero);
      const dangling = await add(card, '2026-03-17', 0, 100, groceries);
      exec('UPDATE transactions SET CategoryID = 987654 WHERE ID = ?', dangling);
      exec('PRAGMA foreign_keys = ON');
      // Another budget's uncategorized rows stay out.
      const otherAccount = (
        await services.accounts.createAccount('Other', otherBudgetId, 'checking', 'USD', asMilli(0))
      ).ID;
      const otherUncategorized = services.categories
        .getAllCategories(otherBudgetId)
        .find((c) => c.Name === 'Uncategorized')!.ID;
      await services.transactions.addTransaction(
        asMilli(0),
        asMilli(100),
        otherAccount,
        otherUncategorized,
        otherBudgetId,
        '2026-03-30',
        '',
        '',
        ''
      );

      for (const limit of [1, 6, 30]) {
        expect(services.transactions.getRecentUncategorizedTransactions(budgetId, limit)).toEqual(
          reference(budgetId, limit)
        );
      }
      const ids = services.transactions.getRecentUncategorizedTransactions(budgetId, 30);
      expect(ids.map((t) => t.ID)).toEqual(expect.arrayContaining([zero, dangling]));
      expect(ids.map((t) => t.ID)).not.toContain(parent);
      expect(services.transactions.getRecentUncategorizedTransactions(otherBudgetId, 6)).toEqual(
        reference(otherBudgetId, 6)
      );
    });

    it('is empty when nothing is uncategorized', async () => {
      await add(checking, '2026-03-01', 0, 1_000, groceries);
      expect(services.transactions.getRecentUncategorizedTransactions(budgetId, 6)).toEqual([]);
    });
  });

  describe('getBalanceHistoryRows', () => {
    beforeEach(async () => {
      await add(checking, '2025-11-30', 100_000, 0, groceries);
      await add(checking, '2025-12-31', 0, 5_000, groceries);
      await add(checking, '2026-01-01', 0, 1_000, groceries);
      await add(checking, '2026-01-01', 0, 2_000, rent);
      await add(checking, '2026-01-31', 0, 3_000, rent);
      await add(checking, '2026-02-01', 50_000, 0, groceries);
      await add(card, '2025-06-15', 0, 9_000, groceries);
      await add(card, '2026-02-10', 0, 1_500, groceries);
      await add(card, '2026-12-01', 0, 700, groceries); // future
    });

    const net = (rows: { Net: number }[]) => rows.reduce((sum, row) => sum + row.Net, 0);
    const ledgerNet = (accountId: number) =>
      services.transactions
        .getAllTransactions(budgetId)
        .filter((t) => t.AccountId === accountId)
        .reduce((sum, t) => sum + t.InflowConverted - t.OutflowConverted, 0);

    it('collapses rows before the window and groups the rest per day', () => {
      const rows = services.transactions.getBalanceHistoryRows(budgetId, '2026-01-01', 'day');
      const chk = rows.filter((r) => r.AccountId === checking);
      expect(chk.sort((a, b) => a.Date.localeCompare(b.Date))).toEqual([
        { AccountId: checking, Date: '2025-11-30', Net: 95_000 },
        { AccountId: checking, Date: '2026-01-01', Net: -3_000 },
        { AccountId: checking, Date: '2026-01-31', Net: -3_000 },
        { AccountId: checking, Date: '2026-02-01', Net: 50_000 },
      ]);
      for (const account of [checking, card]) {
        expect(net(rows.filter((r) => r.AccountId === account))).toBe(ledgerNet(account));
      }
    });

    it('groups the window per month', () => {
      const rows = services.transactions.getBalanceHistoryRows(budgetId, '2026-01-01', 'month');
      const chk = rows
        .filter((r) => r.AccountId === checking)
        .sort((a, b) => a.Date.localeCompare(b.Date));
      expect(chk.map((r) => [r.Date.slice(0, 7), r.Net])).toEqual([
        ['2025-11', 95_000],
        ['2026-01', -6_000],
        ['2026-02', 50_000],
      ]);
      const crd = rows
        .filter((r) => r.AccountId === card)
        .sort((a, b) => a.Date.localeCompare(b.Date));
      expect(crd.map((r) => [r.Date, r.Net])).toEqual([
        ['2025-06-15', -9_000],
        ['2026-02-10', -1_500],
        ['2026-12-01', -700],
      ]);
    });

    it('keeps rows with a non-canonical Date apart', async () => {
      const odd = await add(checking, '2026-01-05', 0, 400, groceries);
      exec(`UPDATE transactions SET Date = '2025-02-30' WHERE ID = ?`, odd);
      const rows = services.transactions.getBalanceHistoryRows(budgetId, '2026-01-01', 'month');
      expect(rows).toContainEqual({ AccountId: checking, Date: '2025-02-30', Net: -400 });
      expect(net(rows.filter((r) => r.AccountId === checking))).toBe(ledgerNet(checking));
    });
  });
});
