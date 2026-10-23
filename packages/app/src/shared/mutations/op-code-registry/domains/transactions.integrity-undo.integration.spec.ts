import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
// The integration test needs the Node database adapter; production uses the browser entry.
// eslint-disable-next-line no-restricted-imports
import { asMilli, NodeSqlJsAdapter, ServiceManager, type Services } from '@budgero/core';
import { MutationExecutor, type UndoEntry } from '@budgero/runtime';
import {
  executeMutationOp,
  getInvalidatesForOp,
  getUndoSpec,
} from '@shared/mutations/op-code-registry';
import { useUndoStore } from '@shared/mutations/UndoStore';

// Real core services behind the op registry, the mutation executor and the
// undo store: every undo below must bring the database back row for row.
const runtime = vi.hoisted(() => ({
  services: undefined as Services | undefined,
  execute: undefined as ((spec: unknown) => Promise<unknown>) | undefined,
}));
vi.mock('@shared/runtime/global', () => ({
  getRuntime: () => ({
    services: () => runtime.services,
    mutationsRouter: () => ({ execute: (spec: unknown) => runtime.execute!(spec) }),
  }),
}));

type Row = Record<string, unknown>;

describe('exact undo / redo with real services', () => {
  let adapter: NodeSqlJsAdapter;
  let s: Services;
  let budgetId: number;
  let checking: number;
  let savings: number;
  let eur: number;
  let groceries: number;
  let rent: number;

  const rows = (sql: string, ...params: unknown[]) => adapter.prepare(sql).all(...params) as Row[];

  /** Every table, row by row. Volatile bookkeeping columns can be dropped per table. */
  const dump = (drop: Record<string, string[]> = {}) =>
    Object.fromEntries(
      rows("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").map(({ name }) => [
        name,
        rows(`SELECT * FROM "${String(name)}" ORDER BY rowid`).map((row) => {
          const copy = { ...row };
          for (const column of drop[String(name)] ?? []) delete copy[column];
          return copy;
        }),
      ])
    );

  /** Table by table, so a failure names the table that differs. */
  const expectSameDb = (actual: Record<string, Row[]>, expected: Record<string, Row[]>) => {
    expect(Object.keys(actual)).toEqual(Object.keys(expected));
    for (const table of Object.keys(expected)) {
      // AUTOINCREMENT high-water marks never go back (IDs are not reused).
      if (table === 'sqlite_sequence') continue;
      expect(actual[table], table).toEqual(expected[table]);
    }
  };

  const run = (op: string, payload: Record<string, unknown>) =>
    runtime.execute!({ op, payload }) as Promise<{ result: unknown }>;
  const store = () => useUndoStore.getState();

  const addSplit = async (accountId: number, total: number, transferPart: number, date: string) =>
    (
      (await run('transactions.add', {
        accountId,
        budgetId,
        date,
        payee: 'Shop',
        outflow: total,
        splits: [
          { categoryId: rent, outflow: total - transferPart, memo: 'rent' },
          { transferAccountId: savings, outflow: transferPart, memo: 'save' },
        ],
      })) as { result: number }
    ).result;

  beforeEach(async () => {
    const manager = new ServiceManager();
    const cwd = vi.spyOn(process, 'cwd').mockReturnValue(resolve(process.cwd(), '../core'));
    try {
      adapter = await NodeSqlJsAdapter.create();
      await manager.initialize(adapter);
    } finally {
      cwd.mockRestore();
    }
    s = manager.getServices();
    runtime.services = s;
    useUndoStore.getState().clear();
    const executor = new MutationExecutor({
      executeOp: executeMutationOp,
      getUndoSpec,
      getInvalidatesForOp,
      getQueryClient: () => undefined,
      pushUndo: (entry: UndoEntry) => useUndoStore.getState().push(entry),
      recordHistory: () => {},
      getActiveSpaceId: () => 'space-1',
      getSpaceRole: () => 'owner',
    });
    runtime.execute = (spec) => executor.execute(spec as never);

    budgetId = await s.budgets.createBudget({
      name: 'Undo',
      display_currency: 'USD',
      badge_icon: 'dollar',
      number_format: '123,456.78',
      create_default_categories: true,
    });
    const account = async (name: string, currency: string, balance: number) =>
      (
        await s.accounts.createAccount(
          name,
          budgetId,
          'checking',
          currency,
          asMilli(balance),
          undefined,
          true,
          'Initial Balance',
          '2026-01-01'
        )
      ).ID;
    checking = await account('Checking', 'USD', 1_000_000);
    // Every account has an opening row: an emptied account stores BalanceConverted 0 (was NULL).
    savings = await account('Savings', 'USD', 10_000);
    eur = await account('Euro', 'EUR', 500_000);
    const categories = s.categories.getAllCategories(budgetId);
    groceries = categories.find((c) => c.Name === 'Groceries')!.ID;
    rent = categories.find(
      (c) => !['Groceries', 'Income', 'Uncategorized', 'Transfers'].includes(c.Name)
    )!.ID;
    for (let month = 1; month <= 6; month++) {
      adapter
        .prepare(
          'INSERT INTO currency_rates(FromCurrency,ToCurrency,Rate,RateDate,LastUpdated,BudgetID) VALUES(?,?,?,?,?,?)'
        )
        .run('EUR', 'USD', 1 + month / 10, `2026-0${month}-01`, '2026-01-01 00:00:00', budgetId);
    }
  });

  describe('U2: undo of deletes', () => {
    it('restores a deleted split (lines, mirror, FX amounts, reconcile and RTA flags) exactly', async () => {
      const split = await addSplit(eur, 100_000, 40_000, '2026-02-01');
      await add(checking, 2_000, '2026-03-01');
      s.transactions.reconcileAccount(eur, '2026-02-28');
      adapter
        .prepare('UPDATE transactions SET ExcludeFromReadyToAssign = 1 WHERE ID = ?')
        .run(split);
      const before = dump();

      await run('transactions.delete', { id: split });
      expect(rows('SELECT ID FROM transactions WHERE ID = ?', split)).toEqual([]);
      await store().undo();
      expectSameDb(dump(), before);

      await store().redo();
      expect(rows('SELECT ID FROM transaction_splits WHERE TransactionID = ?', split)).toEqual([]);
      await store().undo();
      expectSameDb(dump(), before);
    });

    it('restores a batch delete with a transfer, a split and plain rows in one op', async () => {
      const split = await addSplit(checking, 90_000, 30_000, '2026-03-05');
      const plain = await add(checking, 1_234, '2026-03-06');
      await run('transactions.addTransfer', {
        budgetId,
        transferId: 'tr-1',
        source: { accountId: checking, outflow: 5_000, inflow: 0, date: '2026-03-07', memo: '' },
        destination: {
          accountId: savings,
          inflow: 5_000,
          outflow: 0,
          date: '2026-03-07',
          memo: '',
        },
      });
      const [leg] = s.transactions.getTransactionsByTransferID('tr-1');
      const before = dump();

      await run('transactions.deleteBatch', { ids: [split, plain, leg.ID] });
      const undo = store().past.at(-1)!.undo;
      expect(undo.map((call) => call.op)).toEqual(['transactions.restore']);
      await store().undo();
      expectSameDb(dump(), before);
    });

    it('restores a deleted transfer exactly', async () => {
      await run('transactions.addTransfer', {
        budgetId,
        transferId: 'tr-2',
        source: { accountId: eur, outflow: 5_000, inflow: 0, date: '2026-03-07', memo: '' },
        destination: {
          accountId: savings,
          inflow: 6_500,
          outflow: 0,
          date: '2026-03-07',
          memo: '',
        },
      });
      const before = dump();
      await run('transactions.deleteTransfer', { transferId: 'tr-2' });
      await store().undo();
      expectSameDb(dump(), before);
    });
  });

  describe('U5: undo → redo → undo', () => {
    it('recurring markReady (transfer) returns to the scheduled state every time', async () => {
      await s.recurring.createRecurringTransaction({
        budgetId,
        accountId: checking,
        toAccountId: savings,
        name: 'Save',
        amount: asMilli(20_000),
        direction: 'outflow',
        schedule: { startDate: '2026-03-01', intervalUnit: 'month', intervalCount: 1 },
      });
      const [occurrence] = s.recurring.listOccurrences(budgetId, { status: 'scheduled' });
      const volatile = {
        recurring_transaction_occurrences: ['UpdatedAt', 'ReadyAt'],
        recurring_transactions: ['UpdatedAt', 'LastOccurrenceDate'],
      };
      const before = dump(volatile);
      await run('recurring.markReady', { options: { occurrenceId: occurrence.id } });
      const posted = dump(volatile);

      for (let round = 0; round < 2; round++) {
        await store().undo();
        expectSameDb(dump(volatile), before);
        await store().redo();
        expectSameDb(dump(volatile), posted);
      }
      await store().undo();
      expectSameDb(dump(volatile), before);
    });

    it('reconcileCleared with an adjustment returns to the open state every time', async () => {
      await add(checking, 3_000, '2026-03-01', true);
      const volatile = { accounts: ['ReconciledAt'] };
      const before = dump(volatile);
      await run('transactions.reconcileCleared', {
        accountId: checking,
        reconcileDate: '2026-03-31',
        adjustment: {
          accountId: checking,
          budgetId,
          categoryId: groceries,
          date: '2026-03-31',
          memo: 'Account Reconciliation',
          inflow: 1_500,
          outflow: 0,
        },
      });
      const reconciled = dump(volatile);

      for (let round = 0; round < 2; round++) {
        await store().undo();
        expectSameDb(dump(volatile), before);
        await store().redo();
        expectSameDb(dump(volatile), reconciled);
      }
      await store().undo();
      expectSameDb(dump(volatile), before);
    });
  });

  describe('A10 / A11: one op, one write', () => {
    const sequence = () =>
      rows("SELECT seq FROM sqlite_sequence WHERE name = 'transactions'")[0]?.seq;

    it('a transfer whose second leg fails writes nothing and burns no IDs', async () => {
      const before = dump();
      const seq = sequence();
      await expect(
        run('transactions.addTransfer', {
          budgetId,
          transferId: 'tr-bad',
          source: { accountId: checking, outflow: 5_000, inflow: 0, date: '2026-03-07', memo: '' },
          destination: { accountId: 99_999, inflow: 5_000, outflow: 0, date: '2026-03-07' },
        })
      ).rejects.toThrow();
      expect(sequence()).toBe(seq);
      expectSameDb(dump(), before);
    });

    it('a split add whose lines fail writes nothing and burns no IDs', async () => {
      const before = dump();
      const seq = sequence();
      await expect(
        run('transactions.add', {
          accountId: checking,
          budgetId,
          date: '2026-03-01',
          outflow: 1_000,
          splits: [{ categoryId: 99_999, outflow: 1_000 }],
        })
      ).rejects.toThrow();
      expect(sequence()).toBe(seq);
      expectSameDb(dump(), before);
    });

    it('a new split transaction is one op and one undo step', async () => {
      // (Payee directory entries outlive their rows, so create them first.)
      await addSplit(checking, 1_000, 500, '2026-02-01');
      useUndoStore.getState().clear();
      const before = dump();
      await addSplit(checking, 50_000, 20_000, '2026-03-01');
      expect(store().past).toHaveLength(1);
      await store().undo();
      expectSameDb(dump(), before);
    });

    it('the split editor saves a new total and lines as one op; undo is exact', async () => {
      const id = await addSplit(eur, 100_000, 40_000, '2026-02-01');
      const before = dump();
      await run('transactions.saveSplits', {
        transactionId: id,
        amount: { inflow: 0, outflow: 130_000, currency: 'native' },
        splits: [
          { category_id: rent, inflow_original: 0, outflow_original: 70_000 },
          { transfer_account_id: savings, inflow_original: 0, outflow_original: 60_000 },
        ],
      });
      expect(s.transactions.getTransactionByID(id).OutflowNative).toBe(130_000);
      expect(s.splits.getSplits(id).map((line) => line.OutflowNative)).toEqual([70_000, 60_000]);
      expect(
        store()
          .past.at(-1)!
          .undo.map((call) => call.op)
      ).toEqual(['transactions.restore']);
      await store().undo();
      expectSameDb(dump(), before);
    });

    it('the batch toolbar edit is one op; undo is exact', async () => {
      const a = await add(checking, 1_000, '2026-03-01');
      const b = await add(checking, 2_000, '2026-03-02');
      const split = await addSplit(checking, 9_000, 3_000, '2026-03-03');
      s.transactions.updateTransactionColumn(a, 'Payee', 'Shop');
      const before = dump();
      await run('transactions.batchEdit', {
        edits: [a, b, split].map((id) => ({
          id,
          accountId: savings,
          categoryId: groceries,
          payee: 'Shop',
        })),
      });
      expect(
        rows('SELECT DISTINCT AccountID FROM transactions WHERE ID IN (?, ?, ?)', a, b, split)
      ).toEqual([{ AccountID: savings }]);
      expect(
        store()
          .past.at(-1)!
          .undo.map((call) => call.op)
      ).toEqual(['transactions.restore']);
      await store().undo();
      expectSameDb(dump(), before);
    });

    it('duplicate commits every copy together and undoes exactly', async () => {
      const split = await addSplit(checking, 9_000, 3_000, '2026-03-03');
      const plain = await add(checking, 1_000, '2026-03-04');
      const before = dump();
      const { result } = (await run('transactions.duplicate', {
        ids: [split, plain],
        transferIds: {},
      })) as { result: { created: number[] } };
      expect(result.created).toHaveLength(2);
      expect(s.splits.getSplits(result.created[0])).toHaveLength(2);
      await store().undo();
      expectSameDb(dump(), before);
      await store().redo();
      expect(s.splits.getSplits(result.created[0])).toHaveLength(2);
    });
  });

  async function add(accountId: number, outflow: number, date: string, cleared = false) {
    return (
      (await run('transactions.add', {
        accountId,
        budgetId,
        categoryId: groceries,
        date,
        memo: '',
        payee: 'Shop',
        inflow: 0,
        outflow,
        ...(cleared ? { cleared } : {}),
      })) as { result: number }
    ).result;
  }
});
