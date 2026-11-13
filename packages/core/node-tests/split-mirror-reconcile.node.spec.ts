import { beforeEach, describe, expect, it } from 'vitest';
import { NodeSqlJsAdapter, ServiceManager, type Services } from '../src';
import { asMilli } from '../src/money';
import type { TransactionSplit } from '../src/services/transactions/types';

/**
 * Saving a split's lines keeps the mirror rows of lines whose transfer target
 * did not change: same ID, cleared / reconciled state, import provenance and
 * label. Only mirrors of removed or retargeted lines go, only new transfer
 * lines get new rows.
 */

const m = (value: number) => asMilli(value);
type Line = Omit<TransactionSplit, 'ID' | 'TransactionID'>;

describe('split mirrors are reconciled in place', () => {
  let adapter: NodeSqlJsAdapter;
  let s: Services;
  let budgetId: number;
  let checking: number;
  let savings: number;
  let card: number;
  let rent: number;

  const rows = <T = Record<string, unknown>>(sql: string, ...params: unknown[]) =>
    adapter.prepare(sql).all(...params) as T[];
  const exec = (sql: string, ...params: unknown[]) => adapter.prepare(sql).run(...params);

  type Mirror = {
    ID: number;
    AccountID: number;
    OutflowNative: number;
    InflowNative: number;
    Memo: string;
    Payee: string | null;
    Cleared: number;
    Reconciled: number;
    LabelID: number | null;
    Date: string;
    TransferID: string;
  };
  const mirrorsOf = (parentId: number) =>
    rows<Mirror>(
      "SELECT * FROM transactions WHERE TransferID GLOB 'split_transfer_' || ? || '_*' ORDER BY ID",
      parentId
    );

  const categoryLine = (amount: number, memo = 'rent'): Line => ({
    CategoryID: rent,
    Memo: memo,
    InflowConverted: m(0),
    OutflowConverted: m(amount),
    InflowNative: m(0),
    OutflowNative: m(amount),
  });
  const transferLine = (target: number, amount: number, memo = 'move'): Line => ({
    TransferAccountID: target,
    Memo: memo,
    InflowConverted: m(0),
    OutflowConverted: m(amount),
    InflowNative: m(0),
    OutflowNative: m(amount),
  });

  /** Balances and running balances agree with the rows. */
  const expectLedgerConsistent = () => {
    for (const account of rows<{ ID: number; BalanceNative: number }>(
      'SELECT ID, BalanceNative FROM accounts'
    )) {
      let native = 0;
      for (const row of rows<{ n: number; RunningBalanceNative: number }>(
        `SELECT COALESCE(InflowNative, InflowConverted) - COALESCE(OutflowNative, OutflowConverted) n,
                RunningBalanceNative FROM transactions WHERE AccountID = ? ORDER BY Date, ID`,
        account.ID
      )) {
        native += row.n;
        expect(row.RunningBalanceNative).toBe(native);
      }
      expect(account.BalanceNative, `account ${account.ID}`).toBe(native);
    }
  };

  const addParent = (outflow: number) =>
    s.transactions.addTransaction(
      m(0),
      m(outflow),
      checking,
      rent,
      budgetId,
      '2026-03-10',
      'parent memo',
      '',
      'Shop'
    );

  /** Mark a mirror reconciled, attach import provenance and a label. */
  const settle = (mirror: Mirror, labelId: number | null) => {
    exec(
      'UPDATE transactions SET Cleared = 1, Reconciled = 1, LabelID = ? WHERE ID = ?',
      labelId,
      mirror.ID
    );
    exec(
      `INSERT INTO import_provenance (TransactionID, BudgetID, AccountID, Currency, OperationID, FileRowKey, IdentityJSON)
       VALUES (?, ?, ?, 'USD', ?, 'row-1', '{}')`,
      mirror.ID,
      budgetId,
      mirror.AccountID,
      `op-${mirror.ID}`
    );
  };
  const provenanceOf = (id: number) =>
    rows('SELECT OperationID FROM import_provenance WHERE TransactionID = ?', id);

  beforeEach(async () => {
    adapter = await NodeSqlJsAdapter.create();
    const manager = new ServiceManager();
    await manager.initialize(adapter);
    s = manager.getServices();
    budgetId = await s.budgets.createBudget({
      name: 'Reconcile',
      display_currency: 'USD',
      badge_icon: 'dollar',
      number_format: '123,456.78',
      create_default_categories: true,
    });
    const account = async (name: string) =>
      (
        await s.accounts.createAccount(
          name,
          budgetId,
          'checking',
          'USD',
          m(100_000),
          undefined,
          true,
          'Initial Balance',
          '2026-01-01'
        )
      ).ID;
    checking = await account('Checking');
    savings = await account('Savings');
    card = await account('Other');
    rent = s.categories
      .getAllCategories(budgetId)
      .find((c) => !['Groceries', 'Income', 'Uncategorized', 'Transfers'].includes(c.Name))!.ID;
  });

  it('a memo-only save keeps the mirror row, its status, provenance and label', async () => {
    const id = await addParent(10_000);
    await s.splits.upsertSplits(id, [categoryLine(3_000), transferLine(savings, 7_000)]);
    const [before] = mirrorsOf(id);
    const labelId = s.labels.addLabel(budgetId, 'Tag', '#ff0000');
    settle(before, labelId);

    await s.splits.upsertSplits(id, [
      categoryLine(3_000, 'new memo'),
      transferLine(savings, 7_000, 'moved memo'),
    ]);

    const [after] = mirrorsOf(id);
    expect(mirrorsOf(id)).toHaveLength(1);
    expect(after.ID).toBe(before.ID);
    expect(after.Cleared).toBe(1);
    expect(after.Reconciled).toBe(1);
    expect(after.LabelID).toBe(labelId);
    expect(after.Memo).toBe('moved memo');
    expect(provenanceOf(after.ID)).toHaveLength(1);
    expectLedgerConsistent();
  });

  it('an amount change updates a reconciled mirror in place and keeps its status', async () => {
    // A normal transfer edit syncs the partner leg's amount and leaves its
    // Cleared / Reconciled flags alone (preparePartnerSync); mirrors do the same.
    const id = await addParent(10_000);
    await s.splits.upsertSplits(id, [categoryLine(3_000), transferLine(savings, 7_000)]);
    const [before] = mirrorsOf(id);
    settle(before, null);

    await s.splits.upsertSplits(id, [categoryLine(6_000), transferLine(savings, 4_000)]);

    const [after] = mirrorsOf(id);
    expect(after.ID).toBe(before.ID);
    expect(after.InflowNative).toBe(4_000);
    expect(after.Cleared).toBe(1);
    expect(after.Reconciled).toBe(1);
    expectLedgerConsistent();
  });

  it('retargeting, removing and adding lines only touch those mirrors', async () => {
    const id = await addParent(10_000);
    await s.splits.upsertSplits(id, [
      categoryLine(1_000),
      transferLine(savings, 2_000, 'a'),
      transferLine(card, 3_000, 'b'),
      transferLine(savings, 4_000, 'c'),
    ]);
    const [savingsA, cardB, savingsC] = mirrorsOf(id);
    settle(savingsA, null);
    settle(savingsC, null);

    // b moves to Savings, c goes: per account, in order, Savings keeps its two
    // rows (a, then b), Other's row goes and the new Other lines get new rows.
    await s.splits.upsertSplits(id, [
      categoryLine(1_000),
      transferLine(savings, 2_000, 'a'),
      transferLine(savings, 3_000, 'b'),
      transferLine(card, 2_000, 'd'),
      transferLine(card, 2_000, 'e'),
    ]);
    let after = mirrorsOf(id);
    expect(after.map((row) => [row.ID, row.AccountID, row.InflowNative, row.Memo])).toEqual([
      [savingsA.ID, savings, 2_000, 'a'],
      [cardB.ID, card, 2_000, 'd'],
      [savingsC.ID, savings, 3_000, 'b'],
      [savingsC.ID + 1, card, 2_000, 'e'],
    ]);
    expect(after.map((row) => row.Reconciled)).toEqual([1, 0, 1, 0]);

    // Dropping the Savings lines deletes both their rows; Other keeps its own.
    await s.splits.upsertSplits(id, [
      categoryLine(6_000),
      transferLine(card, 2_000, 'd'),
      transferLine(card, 2_000, 'e'),
    ]);
    after = mirrorsOf(id);
    expect(after.map((row) => row.ID)).toEqual([cardB.ID, savingsC.ID + 1]);
    expect(provenanceOf(savingsA.ID)).toEqual([]);
    expectLedgerConsistent();
  });

  it('a later parent date change still moves the kept mirrors in place', async () => {
    const id = await addParent(10_000);
    await s.splits.upsertSplits(id, [transferLine(card, 3_000), transferLine(savings, 7_000)]);
    const [cardMirror, savingsMirror] = mirrorsOf(id);
    settle(savingsMirror, null);
    // Savings line first now; the ID order of the mirrors no longer follows the lines.
    await s.splits.upsertSplits(id, [transferLine(savings, 7_000), transferLine(card, 3_000)]);
    await s.transactions.updateTransactionColumn(id, 'Date', '2026-03-20');

    const after = mirrorsOf(id);
    expect(after.map((row) => [row.ID, row.Date])).toEqual([
      [cardMirror.ID, '2026-03-20'],
      [savingsMirror.ID, '2026-03-20'],
    ]);
    expect(after[1].Reconciled).toBe(1);
    expectLedgerConsistent();
  });

  it('new mirrors get the same IDs on every replay', async () => {
    const replay = async () => {
      const id = await addParent(10_000);
      await s.splits.upsertSplits(id, [categoryLine(3_000), transferLine(savings, 7_000)]);
      await s.splits.upsertSplits(id, [
        categoryLine(1_000),
        transferLine(savings, 7_000),
        transferLine(card, 2_000),
      ]);
      return mirrorsOf(id).map((row) => row.ID - id);
    };
    const first = await replay();
    const second = await replay();
    expect(second).toEqual(first);
  });
});
