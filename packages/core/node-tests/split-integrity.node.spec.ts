import { beforeEach, describe, expect, it } from 'vitest';
import { NodeSqlJsAdapter, ServiceManager, type Services } from '../src';
import { asMilli, type MilliUnits } from '../src/money';

/**
 * Split / transfer integrity and exact delete-undo (U2, A10, A15, A19, A20, A21).
 * Every case checks the database directly: stored balances against row sums,
 * split lines against their parent, mirrors against their lines.
 */

const m = (value: number) => asMilli(value);

describe('split and transfer integrity', () => {
  let adapter: NodeSqlJsAdapter;
  let s: Services;
  let budgetId: number;
  let checking: number;
  let savings: number;
  let eur: number;
  let groceries: number;
  let rent: number;

  const rows = <T = Record<string, unknown>>(sql: string, ...params: unknown[]) =>
    adapter.prepare(sql).all(...params) as T[];
  const one = <T = Record<string, unknown>>(sql: string, ...params: unknown[]) =>
    rows<T>(sql, ...params)[0];

  /** Every user table, row by row (rates excluded where a test changes them). */
  const dump = (exclude: string[] = []) => {
    const tables = rows<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
    )
      .map((t) => t.name)
      .filter((name) => !exclude.includes(name));
    return Object.fromEntries(
      tables.map((name) => [name, rows(`SELECT * FROM "${name}" ORDER BY rowid`)])
    );
  };

  /** Stored balances and running balances agree with the rows. */
  const expectLedgerConsistent = () => {
    // Budget reads go through the snapshot (checked against full queries
    // under BUDGERO_SNAPSHOT_VERIFY=1).
    for (const month of ['2026-02', '2026-03', '2026-05']) {
      s.monthlyBudgets.getMonthlyBudget(month, budgetId);
      s.monthlyBudgets.getReadyToAssign(budgetId, month);
    }
    for (const account of rows<{ ID: number; BalanceNative: number; BalanceConverted: number }>(
      'SELECT ID, BalanceNative, BalanceConverted FROM accounts'
    )) {
      const ledger = rows<{
        ID: number;
        n: number;
        c: number;
        RunningBalanceNative: number;
        RunningBalanceConverted: number;
      }>(
        `SELECT ID, COALESCE(InflowNative, InflowConverted) - COALESCE(OutflowNative, OutflowConverted) n,
                InflowConverted - OutflowConverted c, RunningBalanceNative, RunningBalanceConverted
           FROM transactions WHERE AccountID = ? ORDER BY Date, ID`,
        account.ID
      );
      let native = 0;
      let converted = 0;
      for (const row of ledger) {
        native += row.n;
        converted += row.c;
        expect(row.RunningBalanceNative, `running native of ${row.ID}`).toBe(native);
        expect(row.RunningBalanceConverted, `running converted of ${row.ID}`).toBe(converted);
      }
      expect(account.BalanceNative, `account ${account.ID} native`).toBe(native);
      expect(account.BalanceConverted ?? converted, `account ${account.ID} converted`).toBe(
        converted
      );
    }
  };

  /** Split lines sum to their parent; mirrors offset their transfer lines. */
  const expectSplitsConsistent = () => {
    for (const p of rows<{ ID: number; pn: number; pc: number; ln: number; lc: number }>(
      `SELECT t.ID, COALESCE(t.InflowNative, t.InflowConverted) - COALESCE(t.OutflowNative, t.OutflowConverted) pn,
              t.InflowConverted - t.OutflowConverted pc,
              SUM(COALESCE(s.InflowNative, s.InflowConverted) - COALESCE(s.OutflowNative, s.OutflowConverted)) ln,
              SUM(s.InflowConverted - s.OutflowConverted) lc
         FROM transactions t JOIN transaction_splits s ON s.TransactionID = t.ID GROUP BY t.ID`
    )) {
      expect(p.ln, `native lines of ${p.ID}`).toBe(p.pn);
      expect(p.lc, `converted lines of ${p.ID}`).toBe(p.pc);
    }
    const orphans = rows(
      `SELECT m.ID FROM transactions m WHERE m.TransferID LIKE 'split\\_transfer\\_%' ESCAPE '\\'
         AND NOT EXISTS (SELECT 1 FROM transactions p
           JOIN transaction_splits l ON l.TransactionID = p.ID AND l.TransferAccountID = m.AccountID
          WHERE m.TransferID = 'split_transfer_' || p.ID || '_' || p.Date)`
    );
    expect(orphans, 'mirrors without a parent line').toEqual([]);
    const missing = rows(
      `SELECT l.ID FROM transaction_splits l JOIN transactions p ON p.ID = l.TransactionID
        WHERE l.TransferAccountID IS NOT NULL AND NOT EXISTS (SELECT 1 FROM transactions m
          WHERE m.TransferID = 'split_transfer_' || p.ID || '_' || p.Date AND m.AccountID = l.TransferAccountID)`
    );
    expect(missing, 'transfer lines without a mirror').toEqual([]);
  };

  const add = (
    accountId: number,
    outflow: number,
    date = '2026-03-10',
    categoryId = groceries,
    transferId = ''
  ) =>
    s.transactions.addTransaction(
      m(0),
      m(outflow),
      accountId,
      categoryId,
      budgetId,
      date,
      'memo',
      transferId,
      'Shop'
    );

  /** A split of `total` (native) in `accountId`: a category line and a transfer line. */
  const addSplit = async (
    accountId: number,
    total: number,
    transferPart: number,
    date?: string
  ) => {
    const id = await add(accountId, total, date);
    await s.splits.upsertSplits(id, [
      {
        CategoryID: rent,
        Memo: 'rent',
        InflowConverted: m(0),
        OutflowConverted: m(total - transferPart),
        InflowNative: m(0),
        OutflowNative: m(total - transferPart),
        OrderIndex: 0,
      },
      {
        TransferAccountID: savings,
        Memo: 'to savings',
        InflowConverted: m(0),
        OutflowConverted: m(transferPart),
        InflowNative: m(0),
        OutflowNative: m(transferPart),
        OrderIndex: 1,
      },
    ]);
    return id;
  };

  const mirrorsOf = (parentId: number) =>
    rows<{ ID: number; AccountID: number; InflowNative: number; InflowConverted: number }>(
      "SELECT * FROM transactions WHERE TransferID GLOB 'split_transfer_' || ? || '_*' ORDER BY ID",
      parentId
    );

  beforeEach(async () => {
    adapter = await NodeSqlJsAdapter.create();
    const manager = new ServiceManager();
    await manager.initialize(adapter);
    s = manager.getServices();
    budgetId = await s.budgets.createBudget({
      name: 'Integrity',
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
          m(balance),
          undefined,
          true,
          'Initial Balance',
          '2026-01-01'
        )
      ).ID;
    checking = await account('Checking', 'USD', 1_000_000);
    savings = await account('Savings', 'USD', 0);
    eur = await account('Euro', 'EUR', 500_000);
    const categories = s.categories.getAllCategories(budgetId);
    groceries = categories.find((c) => c.Name === 'Groceries')!.ID;
    rent = categories.find(
      (c) => !['Groceries', 'Income', 'Uncategorized', 'Transfers'].includes(c.Name)
    )!.ID;
    // A month-by-month EUR → USD history, so dates convert differently.
    for (let month = 1; month <= 6; month++) {
      adapter
        .prepare(
          'INSERT OR IGNORE INTO currency_rates(FromCurrency,ToCurrency,Rate,RateDate,LastUpdated,BudgetID) VALUES(?,?,?,?,?,?)'
        )
        .run(
          'EUR',
          'USD',
          1 + month / 10,
          `2026-0${month}-01`,
          `2026-0${month}-01 00:00:00`,
          budgetId
        );
    }
  });

  describe('A19: editing a split parent amount directly', () => {
    it('rescales the lines and the transfer mirror with the parent', async () => {
      const id = await addSplit(checking, 100_000, 40_000);
      await s.transactions.updateTransactionColumn(id, 'OutflowNative', 150_000);

      const lines = s.splits.getSplits(id);
      expect(lines.map((l) => [l.OutflowNative, l.OutflowConverted])).toEqual([
        [90_000, 90_000],
        [60_000, 60_000],
      ]);
      expect(mirrorsOf(id).map((r) => r.InflowNative)).toEqual([60_000]);
      expectSplitsConsistent();
      expectLedgerConsistent();
    });

    it('also when the amount comes from a full row update (rules, budget-currency edits)', async () => {
      const id = await addSplit(checking, 100_000, 25_000);
      await s.transactions.updateTransaction(
        id,
        m(0),
        m(80_000),
        checking,
        groceries,
        '2026-03-10',
        'memo'
      );
      expect(s.splits.getSplits(id).map((l) => l.OutflowNative)).toEqual([60_000, 20_000]);
      await s.transactions.updateTransactionColumn(id, 'OutflowConverted', 40_000);
      expect(s.splits.getSplits(id).map((l) => l.OutflowConverted)).toEqual([30_000, 10_000]);
      expectSplitsConsistent();
      expectLedgerConsistent();
    });
  });

  describe('A20: re-conversion of a foreign-currency split parent', () => {
    it('re-projects the lines and re-converts the mirror on a date change', async () => {
      const id = await addSplit(eur, 100_000, 40_000, '2026-02-01');
      expectSplitsConsistent();
      await s.transactions.updateTransactionColumn(id, 'Date', '2026-05-01');

      const parent = s.transactions.getTransactionByID(id);
      expect(parent.OutflowConverted).toBe(150_000); // 1.5 in May
      expect(s.splits.getSplits(id).map((l) => l.OutflowConverted)).toEqual([90_000, 60_000]);
      // The mirror follows the parent's date and May's rate.
      const [mirror] = mirrorsOf(id);
      expect(mirror).toMatchObject({ Date: '2026-05-01', InflowNative: 60_000 });
      expectSplitsConsistent();
      expectLedgerConsistent();
    });

    it('re-projects the lines after a rate edit and after a custom rate re-conversion', async () => {
      const id = await addSplit(eur, 100_001, 40_000, '2026-02-10');
      await s.transactions.updateTransactionColumn(id, 'ExchangeRate', 1.37, true);
      expectSplitsConsistent();
      await s.currency.addCustomRate('EUR', 'USD', 0.93, '2026-02-01', '2026-02-28', budgetId);
      expect(s.transactions.getTransactionByID(id).OutflowConverted).toBe(137_001);
      expectSplitsConsistent();

      const other = await addSplit(eur, 77_777, 11_111, '2026-03-03');
      await s.currency.addCustomRate('EUR', 'USD', 0.91, '2026-03-01', '2026-03-31', budgetId);
      expect(s.transactions.getTransactionByID(other).OutflowConverted).toBe(70_777);
      expectSplitsConsistent();
      expectLedgerConsistent();
    });
  });

  describe('A21: deleting a split-transfer mirror row', () => {
    it('deletes the whole split transaction, like a transfer leg', async () => {
      const id = await addSplit(checking, 100_000, 40_000);
      const [mirror] = mirrorsOf(id);
      s.transactions.deleteTransaction(mirror.ID);

      expect(rows('SELECT ID FROM transactions WHERE ID = ?', id)).toEqual([]);
      expect(rows('SELECT ID FROM transaction_splits WHERE TransactionID = ?', id)).toEqual([]);
      expect(mirrorsOf(id)).toEqual([]);
      expectSplitsConsistent();
      expectLedgerConsistent();
    });

    it('expands a batch delete that holds a mirror to its parent', async () => {
      const id = await addSplit(checking, 100_000, 40_000);
      const keep = await add(checking, 5_000);
      const [mirror] = mirrorsOf(id);
      s.transactions.deleteTransactions([mirror.ID]);
      expect(rows('SELECT ID FROM transactions WHERE ID IN (?, ?)', id, keep)).toEqual([
        { ID: keep },
      ]);
      expectSplitsConsistent();
      expectLedgerConsistent();
    });
  });

  describe('A15: transfer edits', () => {
    it('updates both legs in one transaction (a failing partner write changes nothing)', async () => {
      const source = await add(checking, 10_000, '2026-03-10', groceries, 'tr-1');
      await s.transactions.addTransaction(
        m(10_000),
        m(0),
        savings,
        groceries,
        budgetId,
        '2026-03-10',
        'memo',
        'tr-1'
      );
      const before = dump();
      const prepare = adapter.prepare.bind(adapter);
      let writes = 0;
      adapter.prepare = (sql: string) => {
        if (/SET InflowNative = \?, OutflowNative = \?,\s+InflowConverted/.test(sql)) {
          writes += 1;
          if (writes === 2) throw new Error('partner write failed');
        }
        return prepare(sql);
      };
      await expect(
        s.transactions.updateTransactionColumn(source, 'OutflowNative', 12_000)
      ).rejects.toThrow('partner write failed');
      adapter.prepare = prepare;
      expect(dump()).toEqual(before);

      await s.transactions.updateTransactionColumn(source, 'OutflowNative', 12_000);
      expect(
        rows(
          "SELECT InflowNative, OutflowNative FROM transactions WHERE TransferID = 'tr-1' ORDER BY ID"
        )
      ).toEqual([
        { InflowNative: 0, OutflowNative: 12_000 },
        { InflowNative: 12_000, OutflowNative: 0 },
      ]);
      expectLedgerConsistent();
    });
  });

  describe('A10: multi-row writes commit once', () => {
    const sequence = () =>
      one<{ seq: number }>("SELECT seq FROM sqlite_sequence WHERE name = 'transactions'")?.seq;

    it('a recurring transfer whose second leg fails writes nothing and burns no IDs', async () => {
      await s.recurring.createRecurringTransaction({
        budgetId,
        accountId: checking,
        toAccountId: savings,
        name: 'Save',
        amount: m(20_000),
        direction: 'outflow',
        schedule: { startDate: '2026-03-01', intervalUnit: 'month', intervalCount: 1 },
      });
      const [occurrence] = s.recurring.listOccurrences(budgetId, { status: 'scheduled' });
      const before = dump();
      const seq = sequence();
      const prepare = adapter.prepare.bind(adapter);
      let inserts = 0;
      adapter.prepare = (sql: string) => {
        if (/INSERT INTO transactions/.test(sql) && ++inserts === 2)
          throw new Error('leg 2 failed');
        return prepare(sql);
      };
      await expect(
        s.recurring.markOccurrenceReady({ occurrenceId: occurrence.id })
      ).rejects.toThrow('leg 2 failed');
      adapter.prepare = prepare;
      expect(sequence()).toBe(seq);
      expect(dump()).toEqual(before);

      const ready = await s.recurring.markOccurrenceReady({ occurrenceId: occurrence.id });
      expect(ready.transactionId).toBe((seq ?? 0) + 1);
      expect(ready.destinationTransactionId).toBe((seq ?? 0) + 2);
      expectLedgerConsistent();
    });

    it('a batch with a split that fails validation writes neither the parent nor its lines', async () => {
      const before = dump();
      const batch = s.transactions.createWriteBatch();
      const ref = await s.transactions.addTransaction(
        m(0),
        m(10_000),
        checking,
        0,
        budgetId,
        '2026-03-10',
        '',
        '',
        undefined,
        undefined,
        undefined,
        false,
        [],
        false,
        undefined,
        batch
      );
      await s.splits.upsertSplits(
        { batchIndex: ref },
        [
          {
            CategoryID: 999_999,
            Memo: '',
            InflowConverted: m(0),
            OutflowConverted: m(10_000),
            OrderIndex: 0,
          },
        ],
        batch
      );
      expect(() => batch.commit()).toThrow();
      expect(dump()).toEqual(before);
    });
  });

  describe('U5: markReady redo under the first IDs', () => {
    it('re-posts a transfer occurrence under the same IDs and TransferID', async () => {
      await s.recurring.createRecurringTransaction({
        budgetId,
        accountId: checking,
        toAccountId: savings,
        name: 'Save',
        amount: m(20_000),
        direction: 'outflow',
        schedule: { startDate: '2026-03-01', intervalUnit: 'month', intervalCount: 1 },
      });
      const [occurrence] = s.recurring.listOccurrences(budgetId, { status: 'scheduled' });
      const first = await s.recurring.markOccurrenceReady({ occurrenceId: occurrence.id });
      const posted = rows(
        'SELECT * FROM transactions WHERE TransferID = ? ORDER BY ID',
        first.transferId
      );
      s.transactions.deleteTransaction(first.transactionId);
      s.recurring.resetOccurrence({ occurrenceId: occurrence.id });

      const again = await s.recurring.markOccurrenceReady({
        occurrenceId: occurrence.id,
        reuse: {
          transactionId: first.transactionId,
          destinationTransactionId: first.destinationTransactionId,
          transferId: first.transferId,
        },
      });
      expect(again).toMatchObject({
        transactionId: first.transactionId,
        destinationTransactionId: first.destinationTransactionId,
        transferId: first.transferId,
      });
      expect(
        rows('SELECT * FROM transactions WHERE TransferID = ? ORDER BY ID', first.transferId)
      ).toEqual(posted);
    });
  });

  describe('U2: restoring a delete', () => {
    const identity = (key: string) => ({
      operationId: `file:${key}`,
      fileRowKey: key,
      date: '2026-03-10',
      inflow: 0,
      outflow: 30_000,
      payee: 'Shop',
      memo: '',
      currency: 'USD',
    });

    it('puts back a split with mirrors, flags, rates, reconcile state and links exactly', async () => {
      // A split in a foreign-currency account with a transfer line.
      const split = await addSplit(eur, 100_000, 40_000, '2026-02-10');
      // A row with provenance, a recurring link and every flag set.
      await s.recurring.createRecurringTransaction({
        budgetId,
        accountId: checking,
        categoryId: groceries,
        name: 'Gym',
        amount: m(30_000),
        direction: 'outflow',
        schedule: { startDate: '2026-03-10', intervalUnit: 'month', intervalCount: 1 },
      });
      const [occurrence] = s.recurring.listOccurrences(budgetId, { status: 'scheduled' });
      const posted = (await s.recurring.markOccurrenceReady({ occurrenceId: occurrence.id }))
        .transactionId;
      const imported = await s.transactions.addTransaction(
        m(0),
        m(30_000),
        checking,
        groceries,
        budgetId,
        '2026-03-11',
        '',
        '',
        'Shop',
        null,
        null,
        true,
        [identity('a')],
        true
      );
      s.transactions.reconcileAccount(checking, '2026-03-10', { clearedOnly: false });
      adapter
        .prepare('UPDATE transactions SET ExcludeFromReadyToAssign = 1 WHERE ID = ?')
        .run(posted);
      // A later row whose running balance depends on the deleted ones.
      await add(checking, 1_000, '2026-04-01');
      const ids = [split, posted, imported];
      const before = dump();

      const snapshot = s.transactions.captureRestoreSnapshot(ids);
      s.transactions.deleteTransactions(ids);
      expect(rows('SELECT ID FROM transactions WHERE ID IN (?, ?, ?)', ...ids)).toEqual([]);
      // Rates move on before the undo; restored rows keep the ones they had.
      adapter.prepare('UPDATE currency_rates SET Rate = Rate + 1').run();

      s.transactions.restoreTransactions(JSON.parse(JSON.stringify(snapshot)));
      expect(dump(['currency_rates'])).toEqual(
        Object.fromEntries(Object.entries(before).filter(([name]) => name !== 'currency_rates'))
      );
      expectSplitsConsistent();
      expectLedgerConsistent();
    });

    it('refuses to restore over an existing row and writes nothing', async () => {
      const id = await add(checking, 1_000);
      const snapshot = s.transactions.captureRestoreSnapshot([id]);
      const before = dump();
      expect(() => s.transactions.restoreTransactions(snapshot)).toThrow(/already exists/);
      expect(dump()).toEqual(before);
    });
  });

  describe('saveSplitTransaction (split editor, one write)', () => {
    it('sets a new parent total and the lines together', async () => {
      const id = await addSplit(checking, 100_000, 40_000);
      await s.transactions.saveSplitTransaction(id, {
        amount: { inflow: m(0), outflow: m(120_000) as MilliUnits, currency: 'native' },
        splits: [
          {
            CategoryID: rent,
            Memo: 'a',
            InflowConverted: m(0),
            OutflowConverted: m(70_000),
            InflowNative: m(0),
            OutflowNative: m(70_000),
            OrderIndex: 0,
          },
          {
            TransferAccountID: savings,
            Memo: 'b',
            InflowConverted: m(0),
            OutflowConverted: m(50_000),
            InflowNative: m(0),
            OutflowNative: m(50_000),
            OrderIndex: 1,
          },
        ],
      });
      expect(s.transactions.getTransactionByID(id).OutflowNative).toBe(120_000);
      expect(mirrorsOf(id).map((r) => r.InflowNative)).toEqual([50_000]);
      expectSplitsConsistent();
      expectLedgerConsistent();
    });

    it('rejects lines that do not match the new total without changing the parent', async () => {
      const id = await addSplit(checking, 100_000, 40_000);
      const before = dump();
      await expect(
        s.transactions.saveSplitTransaction(id, {
          amount: { inflow: m(0), outflow: m(120_000), currency: 'native' },
          splits: [
            {
              CategoryID: rent,
              Memo: 'a',
              InflowConverted: m(0),
              OutflowConverted: m(100_000),
              InflowNative: m(0),
              OutflowNative: m(100_000),
              OrderIndex: 0,
            },
          ],
        })
      ).rejects.toThrow(/sum to parent/);
      expect(dump()).toEqual(before);
    });
  });
});
