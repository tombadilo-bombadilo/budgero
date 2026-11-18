import { beforeEach, describe, expect, it } from 'vitest';
import { NodeSqlJsAdapter, ServiceManager, type Services } from '../src';
import { asMilli } from '../src/money';
import type { SplitInput } from '../src/services/transactions/split-service';

/**
 * Split transfer lines to an account in another currency carry the exact
 * amount the other account received (issue #148). The mirror is written with
 * exactly those amounts on every device (whatever rate it has cached), is
 * pinned, and keeps them when the parent changes, like a cross-currency
 * transfer leg edit keeps the partner leg. Lines to off-budget accounts may
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

/** 100.00 USD sent, 91.23 EUR received, worth 99.50 USD in the budget. */
const RECEIVED = {
  InflowNative: m(91_230),
  OutflowNative: m(0),
  InflowConverted: m(99_500),
  OutflowConverted: m(0),
};

describe('split transfer lines with an entered received amount', () => {
  let d: Device;

  beforeEach(async () => {
    d = await device(0.9);
  });

  it('writes the carried amounts exactly and pins the mirror, on every device', async () => {
    const other = await device(0.5);
    for (const dev of [d, other]) {
      const id = await addParent(dev, 150_000);
      await dev.s.splits.upsertSplits(id, [
        line({ CategoryID: dev.rent }, 50_000),
        line({ TransferAccountID: dev.eur, Mirror: RECEIVED }, 100_000),
      ]);
      const [mirror] = mirrorsOf(dev, id);
      expect(mirror).toMatchObject({ ...RECEIVED, AccountID: dev.eur, TransferRateOverride: 1 });
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

  it('a parent date or amount change keeps a pinned mirror and converts an unpinned one', async () => {
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
    const [kept] = mirrorsOf(d, pinned);
    expect(kept).toMatchObject({ ...RECEIVED, Date: '2026-03-12', TransferRateOverride: 1 });
    const [moved] = mirrorsOf(d, plain);
    expect(moved.InflowNative).toBe(96_000);
    expect(moved.TransferRateOverride).toBe(0);
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
      OutflowConverted: 99_500,
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
    expect(stored).toMatchObject({ Mirror: RECEIVED, MirrorPinned: true, MirrorReconciled: false });

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

  it('a line to an on-budget account still refuses a category', async () => {
    const id = await addParent(d, 100_000);
    await expect(
      d.s.splits.upsertSplits(id, [line({ TransferAccountID: d.eur, CategoryID: d.rent }, 100_000)])
    ).rejects.toThrow(/exclusively/);
  });
});
