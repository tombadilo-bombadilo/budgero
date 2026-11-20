import { beforeEach, describe, expect, it } from 'vitest';
import { NodeSqlJsAdapter, ServiceManager, type Services } from '../src';
import { asMilli } from '../src/money';
import type { SplitInput } from '../src/services/transactions/split-service';

/**
 * Split transfer lines to an account in another currency carry the exact
 * amount the other account received (issue #148). The mirror is written with
 * exactly that amount on every device (whatever rate it has cached), is
 * pinned, and keeps it when the parent changes (scaled with its line when the
 * line's amount changes). Like the received leg of a transfer with typed
 * amounts, it is worth its line's budget value, at the rate the two imply. Lines to off-budget accounts may
 * keep a category (spending instead of leaving Ready to Assign).
 */

const m = (value: number) => asMilli(value);
const DATE = '2026-03-10';

interface Device {
  adapter: NodeSqlJsAdapter;
  s: Services;
  budgetId: number;
  checking: number;
  eur: number;
  savings: number;
  mortgage: number;
  rent: number;
}

async function device(eurRate: number): Promise<Device> {
  const adapter = await NodeSqlJsAdapter.create();
  const manager = new ServiceManager();
  await manager.initialize(adapter);
  const s = manager.getServices();
  const budgetId = await s.budgets.createBudget({
    name: 'Received',
    display_currency: 'USD',
    badge_icon: 'dollar',
    number_format: '123,456.78',
    create_default_categories: true,
  });
  const account = async (name: string, currency: string, onBudget = true, type = 'checking') =>
    (
      await s.accounts.createAccount(
        name,
        budgetId,
        type,
        currency,
        m(0),
        undefined,
        onBudget,
        'Initial Balance',
        '2026-01-01'
      )
    ).ID;
  const checking = await account('Checking', 'USD');
  const eur = await account('Euro', 'EUR');
  const savings = await account('Savings', 'USD', false, 'savings');
  const mortgage = await account('Mortgage', 'EUR', false, 'savings');
  await s.currency.saveRate('USD', 'EUR', eurRate, DATE, budgetId);
  await s.currency.saveRate('EUR', 'USD', 1 / eurRate, DATE, budgetId);
  const rent = s.categories
    .getAllCategories(budgetId)
    .find((c) => !['Groceries', 'Income', 'Uncategorized', 'Transfers'].includes(c.Name))!.ID;
  return { adapter, s, budgetId, checking, eur, savings, mortgage, rent };
}

const rows = <T = Record<string, unknown>>(d: Device, sql: string, ...params: unknown[]) =>
  d.adapter.prepare(sql).all(...params) as T[];

interface MirrorRow {
  ID: number;
  AccountID: number;
  InflowNative: number;
  OutflowNative: number;
  InflowConverted: number;
  OutflowConverted: number;
  TransferRateOverride: number;
  Reconciled: number;
  Date: string;
}
const mirrorsOf = (d: Device, parentId: number) =>
  rows<MirrorRow>(
    d,
    "SELECT * FROM transactions WHERE TransferID GLOB 'split_transfer_' || ? || '_*' ORDER BY ID",
    parentId
  );

const addParent = (d: Device, outflow: number) =>
  d.s.transactions.addTransaction(
    m(0),
    m(outflow),
    d.checking,
    d.rent,
    d.budgetId,
    DATE,
    'parent',
    '',
    'Shop'
  );

const line = (fields: Partial<SplitInput>, outflow: number): SplitInput => ({
  Memo: '',
  InflowConverted: m(0),
  OutflowConverted: m(outflow),
  InflowNative: m(0),
  OutflowNative: m(outflow),
  ...fields,
});

/** 100.00 USD sent, 91.23 EUR received, quoted at 99.50 USD in the budget. */
const RECEIVED = {
  InflowNative: m(91_230),
  OutflowNative: m(0),
  InflowConverted: m(99_500),
  OutflowConverted: m(0),
};
/** RECEIVED as a 100.00 USD line's mirror stores it: worth what the line sent. */
const VALUED = { ...RECEIVED, InflowConverted: m(100_000) };

describe('split transfer lines with an entered received amount', () => {
  let d: Device;

  beforeEach(async () => {
    d = await device(0.9);
  });

  it('writes the carried amount exactly, valued at its line, and pins it, on every device', async () => {
    const other = await device(0.5);
    for (const dev of [d, other]) {
      const id = await addParent(dev, 150_000);
      await dev.s.splits.upsertSplits(id, [
        line({ CategoryID: dev.rent }, 50_000),
        line({ TransferAccountID: dev.eur, Mirror: RECEIVED }, 100_000),
      ]);
      const [mirror] = mirrorsOf(dev, id);
      expect(mirror).toMatchObject({
        ...VALUED,
        AccountID: dev.eur,
        TransferRateOverride: 2,
        ExchangeRateOverride: 1,
      });
    }
  });

  it('without carried amounts converts at the rate, as before, and does not pin', async () => {
    const id = await addParent(d, 100_000);
    await d.s.splits.upsertSplits(id, [line({ TransferAccountID: d.eur }, 100_000)]);
    const [mirror] = mirrorsOf(d, id);
    expect(mirror.InflowNative).toBe(90_000);
    expect(mirror.TransferRateOverride).toBe(0);
  });

  it('ignores carried amounts on a line to an account in the same currency', async () => {
    const usd = (
      await d.s.accounts.createAccount('Cash', d.budgetId, 'cash', 'USD', m(0), undefined, true)
    ).ID;
    const id = await addParent(d, 100_000);
    await d.s.splits.upsertSplits(id, [
      line({ TransferAccountID: usd, Mirror: RECEIVED }, 100_000),
    ]);
    const [mirror] = mirrorsOf(d, id);
    expect(mirror.InflowNative).toBe(100_000);
    expect(mirror.TransferRateOverride).toBe(0);
  });

  it('refuses carried amounts that do not move the other way from the line', async () => {
    const id = await addParent(d, 100_000);
    for (const bad of [
      { ...RECEIVED, InflowNative: m(0), OutflowNative: m(91_230) },
      { ...RECEIVED, InflowNative: m(0) },
      { ...RECEIVED, InflowNative: -5 as never },
    ]) {
      await expect(
        d.s.splits.upsertSplits(id, [line({ TransferAccountID: d.eur, Mirror: bad }, 100_000)])
      ).rejects.toThrow(/received/);
    }
    expect(mirrorsOf(d, id)).toHaveLength(0);
  });

  it('a parent date change keeps a pinned mirror; a new total scales it with the line', async () => {
    const pinned = await addParent(d, 100_000);
    await d.s.splits.upsertSplits(pinned, [
      line({ TransferAccountID: d.eur, Mirror: RECEIVED }, 100_000),
    ]);
    const plain = await addParent(d, 100_000);
    await d.s.splits.upsertSplits(plain, [line({ TransferAccountID: d.eur }, 100_000)]);

    await d.s.currency.saveRate('USD', 'EUR', 0.8, '2026-03-12', d.budgetId);
    for (const id of [pinned, plain]) {
      await d.s.transactions.updateTransactionColumn(id, 'Date', '2026-03-12');
      await d.s.transactions.updateTransactionColumn(id, 'OutflowConverted', m(120_000));
    }
    // 100 -> 120 USD: 91.23 EUR -> 109.476 EUR, worth the line's 120 USD.
    const [kept] = mirrorsOf(d, pinned);
    expect(kept).toMatchObject({
      InflowNative: 109_476,
      InflowConverted: 120_000,
      Date: '2026-03-12',
      TransferRateOverride: 2,
    });
    const [moved] = mirrorsOf(d, plain);
    expect(moved.InflowNative).toBe(96_000);
    expect(moved.TransferRateOverride).toBe(0);
  });

  it('a date-only edit keeps the entered amount exactly; 150 -> 300 doubles it', async () => {
    const id = await addParent(d, 150_000);
    await d.s.splits.upsertSplits(id, [
      line({ CategoryID: d.rent }, 50_000),
      line({ TransferAccountID: d.eur, Mirror: RECEIVED }, 100_000),
    ]);
    await d.s.transactions.updateTransactionColumn(id, 'Date', '2026-03-12');
    expect(mirrorsOf(d, id)[0]).toMatchObject(VALUED);
    await d.s.transactions.updateTransactionColumn(id, 'OutflowConverted', m(300_000));
    expect(mirrorsOf(d, id)[0]).toMatchObject({
      InflowNative: 182_460,
      InflowConverted: 200_000,
      TransferRateOverride: 2,
    });
  });

  it('a save without entered amounts unpins; a flag older builds wrote stays', async () => {
    const id = await addParent(d, 100_000);
    await d.s.splits.upsertSplits(id, [
      line({ TransferAccountID: d.eur, Mirror: RECEIVED }, 100_000),
    ]);
    await d.s.splits.upsertSplits(id, [line({ TransferAccountID: d.eur }, 100_000)]);
    expect(mirrorsOf(d, id)[0]).toMatchObject({
      InflowNative: 90_000,
      TransferRateOverride: 0,
      ExchangeRateOverride: 0,
    });
    // Now a parent change converts it again.
    await d.s.currency.saveRate('USD', 'EUR', 0.8, '2026-03-12', d.budgetId);
    await d.s.transactions.updateTransactionColumn(id, 'Date', '2026-03-12');
    expect(mirrorsOf(d, id)[0].InflowNative).toBe(80_000);

    // A 1 written by an older build's transfer rate edit is no pin and is left alone.
    const [mirror] = mirrorsOf(d, id);
    d.adapter
      .prepare('UPDATE transactions SET TransferRateOverride = 1 WHERE ID = ?')
      .run(mirror.ID);
    await d.s.transactions.updateTransactionColumn(id, 'Date', '2026-03-10');
    expect(mirrorsOf(d, id)[0]).toMatchObject({ InflowNative: 90_000, TransferRateOverride: 1 });
    expect(d.s.legacyReplay.hasPinnedSplitMirrors([id])).toBe(false);
  });

  it('two lines to the same account: the pinned one keeps its amount, the other converts', async () => {
    const id = await addParent(d, 200_000);
    await d.s.splits.upsertSplits(id, [
      line({ TransferAccountID: d.eur, Mirror: RECEIVED }, 100_000),
      line({ TransferAccountID: d.eur }, 100_000),
    ]);
    expect(mirrorsOf(d, id).map((row) => [row.InflowNative, row.TransferRateOverride])).toEqual([
      [91_230, 2],
      [90_000, 0],
    ]);
    await d.s.currency.saveRate('USD', 'EUR', 0.8, '2026-03-12', d.budgetId);
    await d.s.transactions.updateTransactionColumn(id, 'Date', '2026-03-12');
    expect(mirrorsOf(d, id).map((row) => row.InflowNative)).toEqual([91_230, 80_000]);
  });

  it('a parent amount that flips direction flips the kept mirror too', async () => {
    const id = await addParent(d, 100_000);
    await d.s.splits.upsertSplits(id, [
      line({ TransferAccountID: d.eur, Mirror: RECEIVED }, 100_000),
    ]);
    await d.s.transactions.updateTransactionColumn(id, 'OutflowConverted', m(0));
    await d.s.transactions.updateTransactionColumn(id, 'InflowConverted', m(100_000));
    const [mirror] = mirrorsOf(d, id);
    expect(mirror).toMatchObject({
      InflowNative: 0,
      OutflowNative: 91_230,
      InflowConverted: 0,
      OutflowConverted: 100_000,
    });
  });

  it('quotes the exact amounts an op carries for an entered received amount', async () => {
    const id = await addParent(d, 100_000);
    const parent = d.s.transactions.getTransactionByID(id);
    const quotes = await d.s.splits.quoteMirrorAmounts(
      parent,
      [line({ CategoryID: d.rent }, 10_000), line({ TransferAccountID: d.eur }, 90_000)],
      [null, 81_000]
    );
    expect(quotes[0]).toBeNull();
    // 81.00 EUR at 1 / 0.9 = 90.00 USD in the budget.
    expect(quotes[1]).toEqual({
      InflowNative: 81_000,
      OutflowNative: 0,
      InflowConverted: 90_000,
      OutflowConverted: 0,
    });
  });

  it('reports the stored mirror per line and the reconciled mirrors a save would unlock', async () => {
    const id = await addParent(d, 100_000);
    await d.s.splits.upsertSplits(id, [
      line({ TransferAccountID: d.eur, Mirror: RECEIVED }, 100_000),
    ]);
    const [stored] = d.s.splits.getSplitsWithMirrors(id);
    expect(stored).toMatchObject({ Mirror: VALUED, MirrorPinned: true, MirrorReconciled: false });

    const [mirror] = mirrorsOf(d, id);
    d.adapter
      .prepare('UPDATE transactions SET Cleared = 1, Reconciled = 1 WHERE ID = ?')
      .run(mirror.ID);
    const save = (received: typeof RECEIVED) =>
      d.s.transactions.splitSaveUnlocksMirrors(id, {
        splits: [line({ TransferAccountID: d.eur, Mirror: received }, 100_000)],
      });
    expect(await save(RECEIVED)).toEqual([]);
    expect(await save({ ...RECEIVED, InflowNative: m(90_000) })).toEqual([mirror.ID]);

    // Saving the new amount unlocks it (uncleared), like a transfer leg edit.
    await d.s.transactions.saveSplitTransaction(id, {
      splits: [
        line(
          { TransferAccountID: d.eur, Mirror: { ...RECEIVED, InflowNative: m(90_000) } },
          100_000
        ),
      ],
    });
    expect(mirrorsOf(d, id)[0]).toMatchObject({
      ID: mirror.ID,
      InflowNative: 90_000,
      Reconciled: 0,
    });
  });

  it("needs no rate to quote: the budget value is the line's", async () => {
    const gbp = (
      await d.s.accounts.createAccount(
        'Pound',
        d.budgetId,
        'checking',
        'GBP',
        m(0),
        undefined,
        true
      )
    ).ID;
    const id = await addParent(d, 100_000);
    const [quote] = await d.s.splits.quoteMirrorAmounts(
      d.s.transactions.getTransactionByID(id),
      [line({ TransferAccountID: gbp }, 100_000)],
      [80_000]
    );
    expect(quote).toEqual({
      InflowNative: 80_000,
      OutflowNative: 0,
      InflowConverted: 100_000,
      OutflowConverted: 0,
    });
    await d.s.splits.upsertSplits(id, [line({ TransferAccountID: gbp, Mirror: quote }, 100_000)]);
    const [mirror] = mirrorsOf(d, id);
    expect(mirror).toMatchObject({ ...quote, TransferRateOverride: 2 });
    expect(d.s.transactions.getTransactionByID(mirror.ID).ExchangeRate).toBe(1.25);
  });

  it('three currencies: a EUR parent, a GBP target and a USD budget', async () => {
    const gbp = (
      await d.s.accounts.createAccount(
        'Pound',
        d.budgetId,
        'checking',
        'GBP',
        m(0),
        undefined,
        true
      )
    ).ID;
    await d.s.currency.saveRate('GBP', 'USD', 1.25, DATE, d.budgetId);
    const id = await d.s.transactions.addTransaction(
      m(0),
      m(100_000),
      d.eur,
      d.rent,
      d.budgetId,
      DATE,
      '',
      '',
      'Shop'
    );
    const parent = d.s.transactions.getTransactionByID(id);
    const lines = [
      line(
        {
          TransferAccountID: gbp,
          InflowConverted: m(0),
          OutflowConverted: parent.OutflowConverted,
        },
        100_000
      ),
    ];
    const [quote] = await d.s.splits.quoteMirrorAmounts(parent, lines, [85_000]);
    // The line's own budget value.
    expect(quote).toEqual({
      InflowNative: 85_000,
      OutflowNative: 0,
      InflowConverted: parent.OutflowConverted,
      OutflowConverted: 0,
    });
    await d.s.splits.upsertSplits(id, [{ ...lines[0], Mirror: quote }]);
    expect(mirrorsOf(d, id)[0]).toMatchObject({ ...quote, TransferRateOverride: 2 });
    // The parent's own budget rate changes: the received amount is untouched,
    // its budget value follows the line's (100 EUR at 1.5 = 150 USD).
    await d.s.transactions.updateTransactionColumn(id, 'ExchangeRate', 1.5);
    expect(mirrorsOf(d, id)[0]).toMatchObject({
      InflowNative: 85_000,
      InflowConverted: 150_000,
      TransferRateOverride: 2,
    });
  });

  it('a mirror in the budget currency is worth what it received (a EUR parent)', async () => {
    const usd = (
      await d.s.accounts.createAccount('Cash', d.budgetId, 'cash', 'USD', m(0), undefined, true)
    ).ID;
    const id = await d.s.transactions.addTransaction(
      m(0),
      m(100_000),
      d.eur,
      d.rent,
      d.budgetId,
      DATE,
      '',
      '',
      'Shop'
    );
    const sent = { InflowNative: m(105_000), OutflowNative: m(0) };
    await d.s.splits.upsertSplits(id, [
      line(
        {
          TransferAccountID: usd,
          Mirror: { ...sent, InflowConverted: m(105_000), OutflowConverted: m(0) },
        },
        100_000
      ),
    ]);
    expect(mirrorsOf(d, id)[0]).toMatchObject({
      ...sent,
      InflowConverted: 105_000,
      TransferRateOverride: 2,
      ExchangeRateOverride: 0,
    });
  });

  it('a direct edit of one mirror of a two-mirror split leaves the other alone', async () => {
    const gbp = (
      await d.s.accounts.createAccount(
        'Pound',
        d.budgetId,
        'checking',
        'GBP',
        m(0),
        undefined,
        true
      )
    ).ID;
    await d.s.currency.saveRate('USD', 'GBP', 0.8, DATE, d.budgetId);
    await d.s.currency.saveRate('GBP', 'USD', 1.25, DATE, d.budgetId);
    const id = await addParent(d, 200_000);
    await d.s.splits.upsertSplits(id, [
      line({ TransferAccountID: d.eur, Mirror: RECEIVED }, 100_000),
      line({ TransferAccountID: gbp }, 100_000),
    ]);
    const [first, second] = mirrorsOf(d, id);
    expect(d.s.legacyReplay.isSplitMirrorPair(first.ID)).toBe(true);
    await d.s.transactions.updateTransactionColumn(second.ID, 'Memo', 'note');
    await d.s.transactions.updateTransactionColumn(second.ID, 'InflowNative', m(70_000));
    const [after] = mirrorsOf(d, id);
    expect(after).toMatchObject({ ...VALUED, TransferRateOverride: 2 });
    expect(d.s.legacyReplay.hasPinnedSplitMirrors([id])).toBe(true);
  });

  it('a save that removes a line with a reconciled mirror reports that mirror', async () => {
    const id = await addParent(d, 100_000);
    await d.s.splits.upsertSplits(id, [
      line({ TransferAccountID: d.eur, Mirror: RECEIVED }, 100_000),
    ]);
    const [mirror] = mirrorsOf(d, id);
    d.adapter
      .prepare('UPDATE transactions SET Cleared = 1, Reconciled = 1 WHERE ID = ?')
      .run(mirror.ID);
    expect(
      await d.s.transactions.splitSaveUnlocksMirrors(id, {
        splits: [line({ CategoryID: d.rent }, 100_000)],
      })
    ).toEqual([mirror.ID]);
  });

  it('a move to an account in another currency keeps the received amount as entered', async () => {
    const gbp = (
      await d.s.accounts.createAccount(
        'Pound',
        d.budgetId,
        'checking',
        'GBP',
        m(0),
        undefined,
        true
      )
    ).ID;
    await d.s.currency.saveRate('USD', 'GBP', 0.8, DATE, d.budgetId);
    await d.s.currency.saveRate('GBP', 'USD', 1.25, DATE, d.budgetId);
    const id = await addParent(d, 100_000);
    await d.s.splits.upsertSplits(id, [
      line({ TransferAccountID: d.eur, Mirror: RECEIVED }, 100_000),
    ]);
    await d.s.transactions.moveTransactionToNewAccount(id, gbp);
    // The line is now 80 GBP; the EUR the other account received is unchanged.
    expect(d.s.splits.getSplits(id)[0].OutflowNative).toBe(80_000);
    expect(mirrorsOf(d, id)[0]).toMatchObject({ InflowNative: 91_230, TransferRateOverride: 2 });
  });

  it("a move into the mirror's own currency unpins it: it mirrors the line exactly", async () => {
    const euro2 = (
      await d.s.accounts.createAccount(
        'Euro 2',
        d.budgetId,
        'checking',
        'EUR',
        m(0),
        undefined,
        true
      )
    ).ID;
    const id = await addParent(d, 100_000);
    await d.s.splits.upsertSplits(id, [
      line({ TransferAccountID: d.eur, Mirror: RECEIVED }, 100_000),
    ]);
    await d.s.transactions.moveTransactionToNewAccount(id, euro2);
    const native = d.s.splits.getSplits(id)[0].OutflowNative;
    expect(mirrorsOf(d, id)[0]).toMatchObject({ InflowNative: native, TransferRateOverride: 0 });
  });

  it('custom rates leave a pinned mirror alone; a rate edit keeps its entered amount', async () => {
    const id = await addParent(d, 100_000);
    await d.s.splits.upsertSplits(id, [
      line({ TransferAccountID: d.eur, Mirror: RECEIVED }, 100_000),
    ]);
    // Its rate is implied by the entered amounts, like a transfer leg's
    // with typed amounts: a custom rate does not re-value it.
    await d.s.currency.addCustomRate('EUR', 'USD', 1.5, '2026-01-01', null, d.budgetId);
    expect(mirrorsOf(d, id)[0]).toMatchObject({
      InflowNative: 91_230,
      InflowConverted: 100_000,
      TransferRateOverride: 2,
    });
    // A manual rate on the mirror re-values it and keeps the entered amount.
    const [mirror] = mirrorsOf(d, id);
    await d.s.transactions.updateTransactionColumn(mirror.ID, 'ExchangeRate', 1.2);
    expect(mirrorsOf(d, id)[0]).toMatchObject({
      InflowNative: 91_230,
      InflowConverted: 109_476,
      TransferRateOverride: 2,
    });
  });

  it("a split's two mirrors are no transfer pair for the rate dialog or custom rates", async () => {
    const gbp = (
      await d.s.accounts.createAccount(
        'Pound',
        d.budgetId,
        'checking',
        'GBP',
        m(0),
        undefined,
        true
      )
    ).ID;
    await d.s.currency.saveRate('USD', 'GBP', 0.8, DATE, d.budgetId);
    await d.s.currency.saveRate('GBP', 'USD', 1.25, DATE, d.budgetId);
    const id = await addParent(d, 200_000);
    await d.s.splits.upsertSplits(id, [
      line({ TransferAccountID: d.eur, Mirror: RECEIVED }, 100_000),
      line({ TransferAccountID: gbp }, 100_000),
    ]);
    const key = mirrorsOf(d, id)[0].TransferID as unknown as string;
    expect(d.s.transactions.getTransferRateDetails(key)).toBeNull();
    await expect(d.s.transactions.updateTransferRate(key, 1.1)).rejects.toThrow();
    expect(d.s.legacyReplay.isSplitMirrorPairKey(key)).toBe(true);
    expect(d.s.legacyReplay.budgetHasSplitMirrorPairs(d.budgetId)).toBe(true);
    const before = mirrorsOf(d, id).map((row) => row.InflowNative);
    await d.s.currency.addCustomRate('EUR', 'GBP', 0.5, '2026-01-01', null, d.budgetId);
    expect(mirrorsOf(d, id).map((row) => row.InflowNative)).toEqual(before);
  });

  it('flags parents with pinned mirrors for the sync format checks', async () => {
    const pinned = await addParent(d, 100_000);
    await d.s.splits.upsertSplits(pinned, [
      line({ TransferAccountID: d.eur, Mirror: RECEIVED }, 100_000),
    ]);
    const plain = await addParent(d, 100_000);
    await d.s.splits.upsertSplits(plain, [line({ TransferAccountID: d.eur }, 100_000)]);
    expect(d.s.legacyReplay.hasPinnedSplitMirrors([plain])).toBe(false);
    expect(d.s.legacyReplay.hasPinnedSplitMirrors([plain, pinned])).toBe(true);
  });
});

describe('split transfer lines and categories', () => {
  let d: Device;

  beforeEach(async () => {
    d = await device(0.9);
  });

  const activity = (month = '2026-03') =>
    d.s.monthlyBudgets
      .getMonthlyBudget(month, d.budgetId)
      .find((r: { CategoryID: number }) => r.CategoryID === d.rent)?.Activity ?? 0;

  it('a line to an off-budget account may keep a category: spending, not Ready to Assign', async () => {
    const rtaBefore = d.s.monthlyBudgets.getReadyToAssign(d.budgetId, '2026-03');
    const id = await addParent(d, 100_000);
    const rtaWithParent = d.s.monthlyBudgets.getReadyToAssign(d.budgetId, '2026-03');
    await d.s.splits.upsertSplits(id, [
      line({ TransferAccountID: d.savings, CategoryID: d.rent }, 100_000),
    ]);
    const [split] = d.s.splits.getSplits(id);
    expect(split).toMatchObject({ CategoryID: d.rent, TransferAccountID: d.savings });
    expect(mirrorsOf(d, id)[0]).toMatchObject({ AccountID: d.savings, InflowNative: 100_000 });
    expect(activity()).toBe(-100_000);
    // The parent's category spending moved to the line; RTA is not charged again.
    expect(d.s.monthlyBudgets.getReadyToAssign(d.budgetId, '2026-03')).toBe(rtaWithParent);
    expect(rtaWithParent).toBe(rtaBefore);
  });

  it('without a category the line leaves the budget (Ready to Assign), as before', async () => {
    const id = await addParent(d, 100_000);
    const rta = d.s.monthlyBudgets.getReadyToAssign(d.budgetId, '2026-03');
    await d.s.splits.upsertSplits(id, [line({ TransferAccountID: d.savings }, 100_000)]);
    expect(activity()).toBe(0);
    expect(d.s.monthlyBudgets.getReadyToAssign(d.budgetId, '2026-03')).toBe(rta - 100_000);
  });

  it('the Transfers category on such a line means none', async () => {
    const transfers = d.s.categories
      .getAllCategories(d.budgetId)
      .find((c) => c.Name === 'Transfers')?.ID;
    const id = await addParent(d, 100_000);
    await d.s.splits.upsertSplits(id, [
      line({ TransferAccountID: d.savings, CategoryID: transfers ?? 0 }, 100_000),
    ]);
    expect(d.s.splits.getSplits(id)[0].CategoryID).toBeNull();
  });

  it('a line to an on-budget account drops a category it carries (no failure on replay)', async () => {
    const id = await addParent(d, 100_000);
    await d.s.splits.upsertSplits(id, [
      line({ TransferAccountID: d.eur, CategoryID: d.rent }, 100_000),
    ]);
    expect(d.s.splits.getSplits(id)[0]).toMatchObject({
      CategoryID: null,
      TransferAccountID: d.eur,
    });
  });

  it('A: an off-budget account joining the budget clears the category of lines to it', async () => {
    const id = await addParent(d, 100_000);
    await d.s.splits.upsertSplits(id, [
      line({ TransferAccountID: d.savings, CategoryID: d.rent }, 100_000),
    ]);
    const savings = d.s.accounts.getAccount(d.savings);
    await d.s.accounts.updateAccount(
      d.savings,
      savings.Name,
      savings.Type,
      savings.Currency,
      undefined,
      true
    );
    expect(d.s.splits.getSplits(id)[0].CategoryID).toBeNull();
    expect(activity()).toBe(0);
    // A re-save and a copy of the old lines do not fail.
    await d.s.splits.upsertSplits(id, [
      line({ TransferAccountID: d.savings, CategoryID: d.rent }, 100_000),
    ]);
    expect(d.s.splits.getSplits(id)[0].CategoryID).toBeNull();
  });

  it('a restore of a categorized line whose target joined the budget drops the category', async () => {
    const id = await addParent(d, 100_000);
    await d.s.splits.upsertSplits(id, [
      line({ TransferAccountID: d.savings, CategoryID: d.rent }, 100_000),
    ]);
    const snapshot = d.s.transactions.captureRestoreSnapshot([id]);
    const savings = d.s.accounts.getAccount(d.savings);
    await d.s.accounts.updateAccount(
      d.savings,
      savings.Name,
      savings.Type,
      savings.Currency,
      undefined,
      true
    );
    d.s.transactions.restoreTransactions(snapshot, { replace: true });
    expect(d.s.splits.getSplits(id)[0]).toMatchObject({
      CategoryID: null,
      TransferAccountID: d.savings,
    });
    expect(activity()).toBe(0);
  });

  it('B: either order of a categorized save and the on-budget switch ends the same', async () => {
    const run = async (saveFirst: boolean) => {
      const dev = await device(0.9);
      const id = await addParent(dev, 100_000);
      const save = () =>
        dev.s.splits.upsertSplits(id, [
          line({ TransferAccountID: dev.savings, CategoryID: dev.rent }, 100_000),
        ]);
      const flip = async () => {
        const account = dev.s.accounts.getAccount(dev.savings);
        await dev.s.accounts.updateAccount(
          dev.savings,
          account.Name,
          account.Type,
          account.Currency,
          undefined,
          true
        );
      };
      if (saveFirst) {
        await save();
        await flip();
      } else {
        await flip();
        await save();
      }
      return rows(
        dev,
        'SELECT CategoryID, TransferAccountID, OutflowConverted FROM transaction_splits'
      );
    };
    expect(await run(true)).toEqual(await run(false));
  });
});

describe('split mirror rows in the register', () => {
  it('name the parent account as the other side and carry their budget rate', async () => {
    const d = await device(0.9);
    const id = await addParent(d, 200_000);
    await d.s.splits.upsertSplits(id, [
      line({ TransferAccountID: d.savings, CategoryID: d.rent }, 100_000),
      line({ TransferAccountID: d.eur, Mirror: RECEIVED }, 50_000),
      line({ TransferAccountID: d.mortgage, CategoryID: d.rent }, 50_000),
    ]);
    const [inEur] = d.s.transactions
      .getTransactionsByAccount(d.eur)
      .filter((row) => row.TransferID?.startsWith('split_transfer_'));
    // Not "Savings", the account of the first sibling mirror.
    expect(inEur.TransferAccountName).toBe('Checking');
    // The line's 50.00 USD for the 91.23 EUR entered.
    expect(inEur.ExchangeRate).toBeCloseTo(50 / 91.23, 8);
    const [inMortgage] = d.s.transactions
      .getTransactionsByAccount(d.mortgage)
      .filter((row) => row.TransferID?.startsWith('split_transfer_'));
    expect(inMortgage.TransferAccountName).toBe('Checking');
    expect(inMortgage.ExchangeRate).toBeCloseTo(1 / 0.9, 8);
    const [inSavings] = d.s.transactions
      .getTransactionsByAccount(d.savings)
      .filter((row) => row.TransferID?.startsWith('split_transfer_'));
    expect(inSavings.TransferAccountName).toBe('Checking');
    expect(inSavings.ExchangeRate).toBeNull();
  });
});
