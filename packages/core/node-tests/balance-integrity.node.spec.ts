import { beforeEach, describe, expect, it } from 'vitest';
import {
  asMilli,
  NodeSqlJsAdapter,
  ServiceManager,
  type DatabaseAdapter,
  type Services,
} from '../src';

/**
 * Stored balances (accounts.BalanceNative and the last running balance) must
 * always equal the sum of the account's rows after deletes and split edits.
 */
describe('account balances stay equal to the sum of their rows', () => {
  let adapter: DatabaseAdapter;
  let services: Services;
  let budgetId: number;
  let checking: number;
  let savings: number;
  let groceries: number;

  const rowsOf = (accountId: number) =>
    adapter
      .prepare(
        `SELECT ID, TransferID, Date, CategoryID,
                InflowNative - OutflowNative AS Net, RunningBalanceNative AS Running
         FROM transactions WHERE AccountID = ? ORDER BY Date, ID`
      )
      .all(accountId) as {
      ID: number;
      TransferID: string | null;
      Date: string;
      CategoryID: number;
      Net: number;
      Running: number;
    }[];

  const expectConsistent = (accountId: number, expected: number) => {
    const rows = rowsOf(accountId);
    const sum = rows.reduce((total, row) => total + row.Net, 0);
    expect(sum).toBe(expected);
    expect(services.accounts.getAccount(accountId).BalanceNative).toBe(expected);
    expect(services.accounts.getAccount(accountId).BalanceConverted).toBe(expected);
    if (rows.length > 0) expect(rows[rows.length - 1].Running).toBe(expected);
  };

  const addOutflow = (accountId: number, amount: number, categoryId: number, date: string) =>
    services.transactions.addTransaction(
      asMilli(0),
      asMilli(amount),
      accountId,
      categoryId,
      budgetId,
      date,
      'spend'
    );

  const transferSplit = (amount: number, categoryAmount = 0) => [
    {
      TransferAccountID: savings,
      InflowConverted: asMilli(0),
      OutflowConverted: asMilli(amount),
    },
    ...(categoryAmount
      ? [
          {
            CategoryID: groceries,
            InflowConverted: asMilli(0),
            OutflowConverted: asMilli(categoryAmount),
          },
        ]
      : []),
  ];

  beforeEach(async () => {
    adapter = await NodeSqlJsAdapter.create();
    const manager = new ServiceManager();
    await manager.initialize(adapter);
    services = manager.getServices();
    budgetId = await services.budgets.createBudget({
      name: 'Balances',
      display_currency: 'USD',
      badge_icon: 'dollar',
      number_format: '123,456.78',
      create_default_categories: true,
    });
    checking = (
      await services.accounts.createAccount(
        'Checking',
        budgetId,
        'checking',
        'USD',
        asMilli(100000),
        undefined,
        undefined,
        'Initial Balance',
        '2026-01-01'
      )
    ).ID;
    savings = (
      await services.accounts.createAccount('Savings', budgetId, 'savings', 'USD', asMilli(0))
    ).ID;
    const group = services.categories.addCategoryGroup('Everyday', budgetId);
    groceries = services.categories.addCategory(group, budgetId, 'Groceries');
  });

  describe('split transfer mirrors', () => {
    it('re-saving, editing and clearing splits never double-counts the target', async () => {
      const parent = await addOutflow(checking, 6000, groceries, '2026-09-10');

      await services.splits.upsertSplits(parent, transferSplit(6000));
      expectConsistent(savings, 6000);

      await services.splits.upsertSplits(parent, transferSplit(6000));
      expectConsistent(savings, 6000);
      expect(rowsOf(savings)).toHaveLength(1);

      await services.splits.upsertSplits(parent, transferSplit(2000, 4000));
      expectConsistent(savings, 2000);

      await services.splits.clearSplits(parent);
      expectConsistent(savings, 0);
      expect(rowsOf(savings)).toHaveLength(0);
      expectConsistent(checking, 94000);
    });

    it('keeps later rows in the target account consistent when a mirror is replaced', async () => {
      await services.transactions.addTransaction(
        asMilli(1000),
        asMilli(0),
        savings,
        groceries,
        budgetId,
        '2026-09-20',
        'later'
      );
      const parent = await addOutflow(checking, 6000, groceries, '2026-09-10');
      await services.splits.upsertSplits(parent, transferSplit(6000));
      await services.splits.upsertSplits(parent, transferSplit(2500, 3500));
      expectConsistent(savings, 3500);
    });

    it('moves mirrors with the parent date so deleting the parent removes them', async () => {
      const parent = await addOutflow(checking, 6000, groceries, '2026-09-10');
      await services.splits.upsertSplits(parent, transferSplit(6000));

      await services.transactions.updateTransactionColumn(parent, 'date', '2026-09-15');
      const [mirror] = rowsOf(savings);
      expect(mirror.Date).toBe('2026-09-15');
      expect(mirror.TransferID).toBe(`split_transfer_${parent}_2026-09-15`);
      expectConsistent(savings, 6000);

      expect(services.transactions.getTransactionsForDelete([parent])).toHaveLength(2);
      services.transactions.deleteTransaction(parent);
      expect(rowsOf(savings)).toHaveLength(0);
      expectConsistent(savings, 0);
      expectConsistent(checking, 100000);
    });

    it('finds mirrors keyed by an older parent date', async () => {
      const parent = await addOutflow(checking, 6000, groceries, '2026-09-10');
      await services.splits.upsertSplits(parent, transferSplit(6000));
      // Data written before mirrors followed their parent's date.
      adapter.prepare('UPDATE transactions SET Date = ? WHERE ID = ?').run('2026-09-12', parent);

      services.transactions.deleteTransactions([parent]);
      expect(rowsOf(savings)).toHaveLength(0);
      expectConsistent(savings, 0);
      expectConsistent(checking, 100000);
    });
  });

  describe('category deletes', () => {
    it('fixes balances of accounts whose transactions the category takes along', async () => {
      await addOutflow(checking, 2000, groceries, '2026-09-01');
      await addOutflow(checking, 3000, groceries, '2026-09-05');
      const other = services.categories.getAllCategories(budgetId)[0].ID;
      await addOutflow(checking, 1000, other, '2026-09-10');
      await services.transactions.addTransaction(
        asMilli(500),
        asMilli(0),
        savings,
        groceries,
        budgetId,
        '2026-09-02',
        'refund'
      );

      services.categories.deleteCategory(groceries);
      expectConsistent(checking, 99000);
      expectConsistent(savings, 0);
    });

    it('fixes balances when a category group is deleted', async () => {
      const group = services.categories.addCategoryGroup('Fun', budgetId);
      const games = services.categories.addCategory(group, budgetId, 'Games');
      const music = services.categories.addCategory(group, budgetId, 'Music');
      await addOutflow(checking, 2000, games, '2026-09-01');
      await addOutflow(savings, 3000, music, '2026-09-05');

      services.categories.deleteCategoryGroup(group);
      expectConsistent(checking, 100000);
      expectConsistent(savings, 0);
    });

    it('removes split-transfer mirrors of deleted split parents', async () => {
      const parent = await addOutflow(checking, 6000, groceries, '2026-09-10');
      await services.splits.upsertSplits(parent, transferSplit(6000));

      services.categories.deleteCategory(groceries);
      expect(rowsOf(savings)).toHaveLength(0);
      expectConsistent(savings, 0);
      expectConsistent(checking, 100000);
    });
  });

  describe('loan account delete', () => {
    it('keeps payment legs in other accounts and their balances', async () => {
      const loan = (
        await services.accounts.createAccount(
          'Car Loan',
          budgetId,
          'loan',
          'USD',
          asMilli(-500000),
          undefined,
          undefined,
          'Initial Balance',
          '2026-01-01'
        )
      ).ID;
      const transfers = services.categories.getCategoryByName('Transfers', budgetId)!.ID;
      const payment = await services.transactions.addTransaction(
        asMilli(0),
        asMilli(10000),
        checking,
        transfers,
        budgetId,
        '2026-09-01',
        'Payment',
        'loan-payment'
      );
      await services.transactions.addTransaction(
        asMilli(10000),
        asMilli(0),
        loan,
        transfers,
        budgetId,
        '2026-09-01',
        'Payment',
        'loan-payment'
      );
      const linked = JSON.parse(services.accounts.getAccount(loan).Metadata || '{}')
        .linked_category_id as number;
      expect(services.transactions.getTransactionByID(payment).CategoryID).toBe(linked);
      expectConsistent(checking, 90000);

      services.accounts.deleteAccount(loan);

      expectConsistent(checking, 90000);
      const kept = services.transactions.getTransactionByID(payment);
      expect(kept.CategoryID).toBe(
        services.categories.getCategoryByName('Uncategorized', budgetId)!.ID
      );
      expect(services.categories.getAllCategories(budgetId).some((c) => c.ID === linked)).toBe(
        false
      );
    });
  });
});
