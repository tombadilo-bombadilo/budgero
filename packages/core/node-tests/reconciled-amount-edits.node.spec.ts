import { beforeEach, describe, expect, it } from 'vitest';
import { NodeSqlJsAdapter, ServiceManager, type Services } from '../src';
import { asMilli } from '../src/money';

/**
 * #140: a reconciled row whose bank (native) amount an edit changes goes back
 * to uncleared (Reconciled = 0, Cleared = 0); rows whose bank amount stays
 * keep their status. Custom rates skip transfers with a reconciled leg.
 * #138: a cross-currency transfer's exact sent and received amounts can be
 * stored, and editing one leg keeps the partner's amount.
 */

const m = (value: number) => asMilli(value);
const date = '2026-05-10';

type Row = {
  ID: number;
  AccountID: number;
  InflowNative: number;
  OutflowNative: number;
  InflowConverted: number;
  OutflowConverted: number;
  ExchangeRate: number | null;
  ExchangeRateOverride: number;
  TransferRateOverride: number;
  Reconciled: number;
  Cleared: number;
};

describe('reconciled rows and transfer amounts', () => {
  let adapter: NodeSqlJsAdapter;
  let s: Services;
  let budgetId: number;
  let checking: number;
  let savings: number;
  let euro: number;
  let rent: number;

  const row = (id: number) =>
    adapter.prepare('SELECT * FROM transactions WHERE ID = ?').get(id) as Row;
  const flags = (id: number) => {
    const { Reconciled, Cleared } = row(id);
    return { Reconciled, Cleared };
  };
  const lock = (...ids: number[]) => {
    for (const id of ids) {
      adapter.prepare('UPDATE transactions SET Reconciled = 1, Cleared = 1 WHERE ID = ?').run(id);
    }
  };
  const LOCKED = { Reconciled: 1, Cleared: 1 };
  const OPEN = { Reconciled: 0, Cleared: 0 };

  /** Balances and running balances agree with the rows. */
  const expectLedgerConsistent = () => {
    const accounts = adapter.prepare('SELECT ID, BalanceNative FROM accounts').all() as {
      ID: number;
      BalanceNative: number;
    }[];
    for (const account of accounts) {
      let native = 0;
      const rows = adapter
        .prepare(
          `SELECT COALESCE(InflowNative, InflowConverted) - COALESCE(OutflowNative, OutflowConverted) n,
                  RunningBalanceNative FROM transactions WHERE AccountID = ? ORDER BY Date, ID`
        )
        .all(account.ID) as { n: number; RunningBalanceNative: number }[];
      for (const entry of rows) {
        native += entry.n;
        expect(entry.RunningBalanceNative).toBe(native);
      }
      expect(account.BalanceNative, `account ${account.ID}`).toBe(native);
    }
  };

  const addRow = (accountId: number, outflow: number) =>
    s.transactions.addTransaction(m(0), m(outflow), accountId, rent, budgetId, date, 'row');

  const addTransfer = async (
    transferId: string,
    from: number,
    sent: number,
    to: number,
    received: number
  ) => {
    const source = await s.transactions.addTransaction(
      m(0),
      m(sent),
      from,
      0,
      budgetId,
      date,
      'out',
      transferId
    );
    const destination = await s.transactions.addTransaction(
      m(received),
      m(0),
      to,
      0,
      budgetId,
      date,
      'in',
      transferId
    );
    return { source, destination };
  };

  beforeEach(async () => {
    adapter = await NodeSqlJsAdapter.create();
    const manager = new ServiceManager();
    await manager.initialize(adapter);
    s = manager.getServices();
    budgetId = await s.budgets.createBudget({
      name: 'Reconciled',
      display_currency: 'USD',
      badge_icon: 'dollar',
      number_format: '123,456.78',
      create_default_categories: true,
    });
    checking = (await s.accounts.createAccount('Checking', budgetId, 'checking', 'USD', 0)).ID;
    savings = (await s.accounts.createAccount('Savings', budgetId, 'savings', 'USD', 0)).ID;
    euro = (await s.accounts.createAccount('Euro', budgetId, 'checking', 'EUR', 0)).ID;
    await s.currency.saveRate('EUR', 'USD', 1.25, date, budgetId);
    rent = s.categories.getAllCategories(budgetId).find((c) => c.Name !== 'Income')!.ID;
  });

  describe('rule 1: an edit that changes a reconciled bank amount unlocks the row', () => {
    it('a native amount edit unlocks the row; writing the same amount does not', async () => {
      const id = await addRow(checking, 10_000);
      lock(id);

      await s.transactions.updateTransactionColumn(id, 'OutflowNative', 10_000);
      expect(flags(id)).toEqual(LOCKED);

      await s.transactions.updateTransactionColumn(id, 'OutflowNative', 12_000);
      expect(row(id).OutflowNative).toBe(12_000);
      expect(flags(id)).toEqual(OPEN);
      expectLedgerConsistent();
    });

    it('a budget-currency amount edit of a foreign row changes its bank amount and unlocks it', async () => {
      const id = await addRow(euro, 8_000);
      lock(id);

      await s.transactions.updateTransactionColumn(id, 'OutflowConverted', 20_000);
      expect(row(id).OutflowNative).toBe(16_000);
      expect(flags(id)).toEqual(OPEN);
    });

    it('a budget-rate edit of a normal foreign row only moves the budget value: still locked', async () => {
      const id = await addRow(euro, 8_000);
      lock(id);

      await s.transactions.updateTransactionColumn(id, 'ExchangeRate', 1.5);
      expect(row(id).OutflowNative).toBe(8_000);
      expect(row(id).OutflowConverted).toBe(12_000);
      expect(flags(id)).toEqual(LOCKED);
    });

    it('a rate edit of a transfer leg re-derives its bank amount and unlocks it', async () => {
      const { source, destination } = await addTransfer('t-rate', checking, 10_000, euro, 8_000);
      lock(source, destination);

      await s.transactions.updateTransactionColumn(destination, 'ExchangeRate', 1.6);
      expect(row(destination).InflowNative).toBe(6_250);
      expect(flags(destination)).toEqual(OPEN);
      expect(flags(source)).toEqual(LOCKED);
      expectLedgerConsistent();
    });

    it('a same-currency transfer edit mirrors the amount and unlocks a reconciled partner', async () => {
      const { source, destination } = await addTransfer('t-same', checking, 5_000, savings, 5_000);
      lock(destination);

      await s.transactions.updateTransactionColumn(source, 'OutflowNative', 7_000);
      expect(row(destination).InflowNative).toBe(7_000);
      expect(flags(destination)).toEqual(OPEN);
      expect(flags(source)).toEqual(OPEN);
      expectLedgerConsistent();
    });

    it('a split parent total change unlocks the parent', async () => {
      const id = await addRow(checking, 10_000);
      await s.splits.upsertSplits(id, [
        {
          CategoryID: rent,
          Memo: 'a',
          InflowConverted: m(0),
          OutflowConverted: m(10_000),
          InflowNative: m(0),
          OutflowNative: m(10_000),
        },
      ]);
      lock(id);

      await s.transactions.saveSplitTransaction(id, {
        amount: { inflow: m(0), outflow: m(12_000), currency: 'native' },
        splits: [
          {
            CategoryID: rent,
            Memo: 'a',
            InflowConverted: m(0),
            OutflowConverted: m(12_000),
            InflowNative: m(0),
            OutflowNative: m(12_000),
            OrderIndex: 0,
          },
        ],
      });
      expect(row(id).OutflowNative).toBe(12_000);
      expect(flags(id)).toEqual(OPEN);
      expectLedgerConsistent();
    });
  });

  describe('rule 9: editing one leg of a cross-currency transfer', () => {
    it('the sent leg: the received amount scales, so the partner unlocks; the rate stays', async () => {
      const { source, destination } = await addTransfer('t-cross', checking, 10_000, euro, 8_000);
      lock(source, destination);

      await s.transactions.updateTransactionColumn(source, 'OutflowNative', 11_000);

      expect(row(source).OutflowNative).toBe(11_000);
      expect(flags(source)).toEqual(OPEN);
      expect(row(destination).InflowNative).toBe(8_800);
      expect(flags(destination)).toEqual(OPEN);
      const details = s.transactions.getTransferRateDetails('t-cross')!;
      expect(details.rate).toBeCloseTo(0.8, 10);
      expectLedgerConsistent();
    });

    it('the received leg: keeps the sent amount (and its reconciled status); the implied rate changes', async () => {
      const { source, destination } = await addTransfer('t-cross', checking, 10_000, euro, 8_000);
      lock(source, destination);
      const partnerBefore = row(source);

      await s.transactions.updateTransactionColumn(destination, 'InflowNative', 8_800);

      expect(row(destination).InflowNative).toBe(8_800);
      expect(flags(destination)).toEqual(OPEN);
      const partner = row(source);
      expect(partner.OutflowNative).toBe(partnerBefore.OutflowNative);
      expect(partner.OutflowConverted).toBe(partnerBefore.OutflowConverted);
      expect(flags(source)).toEqual(LOCKED);
      const details = s.transactions.getTransferRateDetails('t-cross')!;
      expect(details.rate).toBeCloseTo(0.88, 10);
      expect(details.transferRateOverride).toBe(true);
      expectLedgerConsistent();
    });
  });

  describe('transfer rate and amounts (dialog)', () => {
    it('a rate change unlocks the received leg it re-derives; the sent leg stays locked', async () => {
      const { source, destination } = await addTransfer('t-dr', checking, 10_000, euro, 8_000);
      lock(source, destination);

      const updated = await s.transactions.updateTransferRate('t-dr', 0.7);
      expect(updated.destination.amount).toBe(7_000);
      expect(updated.source.reconciled).toBe(true);
      expect(updated.destination.reconciled).toBe(false);
      expect(flags(destination)).toEqual(OPEN);
      expect(flags(source)).toEqual(LOCKED);
      expectLedgerConsistent();
    });

    it('stores the exact sent and received amounts, derives the rate and marks it overridden', async () => {
      const { source, destination } = await addTransfer('t-amt', checking, 10_000, euro, 8_000);
      lock(source, destination);

      const updated = await s.transactions.updateTransferAmounts('t-amt', 12_000, 9_000);
      expect(updated.source.amount).toBe(12_000);
      expect(updated.destination.amount).toBe(9_000);
      expect(updated.rate).toBeCloseTo(0.75, 10);
      expect(updated.transferRateOverride).toBe(true);
      // Each leg valued in the budget currency: USD 1:1, EUR at 1.25.
      expect(updated.source.budgetAmount).toBe(12_000);
      expect(updated.destination.budgetAmount).toBe(11_250);
      expect(flags(source)).toEqual(OPEN);
      expect(flags(destination)).toEqual(OPEN);
      expectLedgerConsistent();
    });

    it('only unlocks the leg whose amount changed', async () => {
      const { source, destination } = await addTransfer('t-one', checking, 10_000, euro, 8_000);
      lock(source, destination);

      await s.transactions.updateTransferAmounts('t-one', 10_000, 8_200);
      expect(flags(source)).toEqual(LOCKED);
      expect(flags(destination)).toEqual(OPEN);
    });

    it('rejects same-currency transfers and non-positive amounts', async () => {
      await addTransfer('t-usd', checking, 5_000, savings, 5_000);
      await addTransfer('t-bad', checking, 10_000, euro, 8_000);
      await expect(s.transactions.updateTransferAmounts('t-usd', 5_000, 6_000)).rejects.toThrow(
        /different account currencies/
      );
      await expect(s.transactions.updateTransferAmounts('t-bad', 0, 6_000)).rejects.toThrow(
        /greater than zero/
      );
    });

    it('an exact restore (undo) puts amounts, rates, overrides and status back', async () => {
      const { source, destination } = await addTransfer('t-undo', checking, 10_000, euro, 8_000);
      lock(source, destination);
      const before = [row(source), row(destination)];
      const snapshot = s.transactions.captureRestoreSnapshot([source]);
      expect(snapshot.transactions.map((r) => r.ID).sort()).toEqual([source, destination].sort());

      await s.transactions.updateTransferAmounts('t-undo', 12_000, 9_000);
      s.transactions.restoreTransactions(snapshot, { replace: true });

      expect([row(source), row(destination)]).toEqual(before);
      expectLedgerConsistent();
    });
  });

  describe('rule 3: custom rates skip transfers with a reconciled leg', () => {
    it('re-rates an open transfer but leaves a reconciled one alone', async () => {
      const open = await addTransfer('t-open', checking, 10_000, euro, 8_000);
      const locked = await addTransfer('t-locked', checking, 10_000, euro, 8_000);
      lock(locked.destination);

      await s.currency.addCustomRate('EUR', 'USD', 2, '2026-05-01', null, budgetId);

      expect(row(open.destination).InflowNative).toBe(5_000);
      expect(row(locked.destination).InflowNative).toBe(8_000);
      expect(row(locked.source).OutflowConverted).toBe(10_000);
      expect(flags(locked.destination)).toEqual(LOCKED);
      expect(s.transactions.getTransferRateDetails('t-locked')!.hasReconciledLeg).toBe(true);
    });
  });

  describe('reconciledRowsUnlockedByEdit (preview for the confirm dialog)', () => {
    it('lists the rows the edit would unlock', async () => {
      const plain = await addRow(euro, 8_000);
      const same = await addTransfer('p-same', checking, 5_000, savings, 5_000);
      const cross = await addTransfer('p-cross', checking, 10_000, euro, 8_000);
      lock(plain, same.destination, cross.source, cross.destination);
      const preview = (id: number, column: string, value: unknown) =>
        s.transactions.reconciledRowsUnlockedByEdit(id, column, value);

      expect(preview(plain, 'OutflowNative', 8_000)).toEqual([]);
      expect(preview(plain, 'OutflowNative', 9_000)).toEqual([plain]);
      expect(preview(plain, 'OutflowConverted', 1)).toEqual([plain]);
      expect(preview(plain, 'ExchangeRate', 1.4)).toEqual([]);
      expect(preview(plain, 'Memo', 'x')).toEqual([]);
      // Same currency: the partner mirrors the amount.
      expect(preview(same.source, 'OutflowNative', 6_000)).toEqual([same.destination]);
      // Cross currency: the partner keeps its amount.
      expect(preview(cross.destination, 'InflowNative', 9_000)).toEqual([cross.destination]);
      expect(preview(cross.destination, 'ExchangeRate', 1.6)).toEqual([cross.destination]);
      expect(preview(cross.source, 'Memo', 'x')).toEqual([]);
    });
  });

  it('undoing a delete (exact restore) brings reconciled rows back reconciled', async () => {
    const { source, destination } = await addTransfer('t-del', checking, 10_000, euro, 8_000);
    lock(source, destination);
    const snapshot = s.transactions.captureRestoreSnapshot([source]);

    s.transactions.deleteTransaction(source);
    s.transactions.restoreTransactions(snapshot);

    expect(flags(source)).toEqual(LOCKED);
    expect(flags(destination)).toEqual(LOCKED);
  });
});
