/**
 * Budget snapshot (P19): unit tests of the pure model, and one test per
 * correctness risk listed in docs/audits/2026-10-performance.md ("P19 design",
 * risks 1-14), plus the hook lifecycle (export, restore, missing hooks,
 * transactions, malformed rows) on both sql.js adapters.
 *
 * Every integration check reads through the snapshot with verify on (each read
 * is also recomputed fully and compared), asserts that the snapshot was used,
 * and compares against a read with the snapshot switched off.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import initSqlJs from 'sql.js';
import path from 'node:path';
import {
  NodeSqlJsAdapter,
  ServiceManager,
  asMilli,
  configureBudgetSnapshot,
  getBudgetSnapshotStore,
  type DatabaseAdapter,
  type Services,
} from '../src';
import { WebDatabaseAdapter } from '../src/database/web-adapter.js';
import {
  addCreditLine,
  availableThrough,
  ccSpendingAt,
  emptyTxMonth,
  foldMonthly,
  fromMonthIndex,
  rollforwardAt,
  toMonthIndex,
  type BudgetData,
} from '../src/services/monthly-budgets/snapshot/model.js';
import { firstDifference } from '../src/services/monthly-budgets/snapshot/compare.js';

// ------------------------------------------------------------------ pure model

describe('snapshot model (pure)', () => {
  it('indexes months and rejects anything else', () => {
    expect(toMonthIndex('2026-10')).toBe(2026 * 12 + 9);
    expect(fromMonthIndex(toMonthIndex('2026-01'))).toBe('2026-01');
    expect(fromMonthIndex(toMonthIndex('1999-12') + 1)).toBe('2000-01');
    for (const bad of ['2026-13', '2026-00', '2026-1', '26-10', '', null, 202610, '2026-10-01'])
      expect(toMonthIndex(bad)).toBe(-1);
  });

  const data = (): BudgetData => ({ tx: new Map(), assigned: new Map() });
  const m = (s: string) => toMonthIndex(s);

  it('sums assigned + activity through a month', () => {
    const d = data();
    d.assigned.set(m('2026-01'), new Map([[1, 100]]));
    d.assigned.set(m('2026-03'), new Map([[1, 50]]));
    const jan = emptyTxMonth();
    jan.nonCredit.set(1, -30);
    addCreditLine(jan, 9, 1, -20);
    d.tx.set(m('2026-01'), jan);
    expect(availableThrough(d, m('2025-12')).get(1)).toBeUndefined();
    expect(availableThrough(d, m('2026-02')).get(1)).toBe(50);
    expect(availableThrough(d, m('2026-03')).get(1)).toBe(100);
  });

  it('orders CC spending pairs like the full query (month-M pairs first)', () => {
    const d = data();
    const jan = emptyTxMonth();
    jan.ccSpend.set(5, new Map([[2, { total: 10, count: 1 }]]));
    jan.ccSpend.set(4, new Map([[3, { total: 7, count: 1 }]]));
    const feb = emptyTxMonth();
    feb.ccSpend.set(5, new Map([[3, { total: 4, count: 2 }]]));
    d.tx.set(m('2026-01'), jan);
    d.tx.set(m('2026-02'), feb);
    const r = ccSpendingAt(d, m('2026-02'), () => true);
    expect([...r.keys()]).toEqual([5, 4]);
    expect([...r.get(5)!]).toEqual([
      [3, { current: 4, prior: 0 }],
      [2, { current: 0, prior: 10 }],
    ]);
    expect(ccSpendingAt(d, m('2026-02'), (c) => c !== 5).has(5)).toBe(false);
  });

  const meta = (groups: [number, string][], cards: [number, number][] = []) => ({
    groupOf: new Map(groups),
    cardToPaymentCat: new Map(cards),
  });

  it('floors overspend and charges cash overspend the month after (monthly fold)', () => {
    const d = data();
    d.assigned.set(m('2026-01'), new Map([[1, 100]]));
    const jan = emptyTxMonth();
    jan.nonCredit.set(1, -150);
    d.tx.set(m('2026-01'), jan);
    d.assigned.set(m('2026-03'), new Map([[1, 20]]));
    const fold = foldMonthly(d, meta([[1, 'Food']]));
    const names = new Map([[1, { name: 'Food', groupName: 'G' }]]);
    expect(rollforwardAt(fold, m('2026-01'), names).availableByCategory.get(1)).toBe(-50);
    // floored to 0 in February, +20 in March
    expect(rollforwardAt(fold, m('2026-02'), names).availableByCategory.get(1)).toBe(0);
    expect(rollforwardAt(fold, m('2026-03'), names).availableByCategory.get(1)).toBe(20);
    const later = rollforwardAt(fold, m('2027-06'), names);
    expect(later.availableByCategory.get(1)).toBe(20);
    expect(later.priorCashOverspendDetails).toEqual([
      { categoryId: 1, categoryName: 'Food', categoryGroupName: 'G', month: '2026-01', amount: 50 },
    ]);
    expect(rollforwardAt(fold, m('2026-01'), names).priorCashOverspendDetails).toEqual([]);
    // before the first month: nothing present
    expect(rollforwardAt(fold, m('2025-06'), names).availableByCategory.size).toBe(0);
  });

  it('funds credit purchases in ledger order and records the unfunded rest as debt', () => {
    const d = data();
    d.assigned.set(m('2026-01'), new Map([[1, 30]]));
    const jan = emptyTxMonth();
    addCreditLine(jan, 7, 1, -20); // card 7 (payment category 70)
    addCreditLine(jan, 8, 1, -25); // card 8 (payment category 80)
    jan.cardPayments.set(7, 5);
    d.tx.set(m('2026-01'), jan);
    const fold = foldMonthly(
      d,
      meta(
        [
          [1, 'Food'],
          [70, 'Credit Card Payments'],
          [80, 'Credit Card Payments'],
        ],
        [
          [7, 70],
          [8, 80],
        ]
      )
    );
    const r = rollforwardAt(fold, m('2026-01'), new Map());
    expect(r.currentFundingByPaymentCategory.get(70)).toEqual(new Map([[1, 20]]));
    expect(r.currentFundingByPaymentCategory.get(80)).toEqual(new Map([[1, 10]]));
    expect(r.debtBreakdownByPaymentCat.get(80)).toEqual([
      { categoryId: 1, month: '2026-01', amount: 15 },
    ]);
    expect(r.paymentCalculationByCategory.get(70)).toEqual({
      previousAvailable: 0,
      funded: 20,
      payments: 5,
      refunds: 0,
    });
    expect(r.paymentAvailableByCategory.get(70)).toBe(15);
    expect(r.availableByCategory.get(1)).toBe(-15);
  });

  it('treats months without data as identities (gaps fold like contiguous months)', () => {
    const build = (gap: boolean) => {
      const d = data();
      d.assigned.set(m('2026-01'), new Map([[1, 10]]));
      const t = emptyTxMonth();
      t.nonCredit.set(1, -40);
      d.tx.set(m(gap ? '2026-06' : '2026-02'), t);
      return foldMonthly(d, meta([[1, 'Food']]));
    };
    const names = new Map();
    const a = rollforwardAt(build(true), m('2026-06'), names);
    const b = rollforwardAt(build(false), m('2026-02'), names);
    expect(a.availableByCategory.get(1)).toBe(b.availableByCategory.get(1));
    expect(a.priorCashOverspend).toBe(0);
  });

  it('runs the card balance through cash vs credit (positive card balance is cash)', () => {
    const d = data();
    const jan = emptyTxMonth();
    addCreditLine(jan, 7, 2, 100); // a refund/credit leaves the card +100
    addCreditLine(jan, 7, 1, -150); // 100 of this is cash, 50 credit
    d.tx.set(m('2026-01'), jan);
    const fold = foldMonthly(
      d,
      meta(
        [
          [1, 'Food'],
          [2, 'Food'],
        ],
        [[7, 70]]
      )
    );
    expect(fold.creditCash.get(m('2026-01'))!.get(1)).toBe(-100);
    expect(fold.creditCash.get(m('2026-01'))!.get(2)).toBe(100); // the inflow itself is cash
  });

  it('compares results deeply, in order', () => {
    expect(firstDifference({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBeNull();
    expect(firstDifference({ a: [1, { b: 2 }] }, { a: [1, { b: 3 }] })).toContain('/a/1/b');
    expect(
      firstDifference(
        new Map([
          [1, 2],
          [3, 4],
        ]),
        new Map([
          [3, 4],
          [1, 2],
        ])
      )
    ).not.toBeNull();
    expect(firstDifference({ a: undefined }, {})).toBeNull();
    expect(firstDifference([1], [1, 2])).toContain('length');
  });
});

// ------------------------------------------------------------------ integration helpers

interface Ctx {
  adapter: DatabaseAdapter;
  s: Services;
  budgetId: number;
  chk: number;
  sav: number;
  savOff: number;
  card: number;
  card2: number;
  food: number;
  rent: number;
  fun: number;
  income: number;
  transfers: number;
  group: number;
  group2: number;
}

async function setup(adapter?: DatabaseAdapter): Promise<Ctx> {
  const a = adapter ?? (await NodeSqlJsAdapter.create());
  const sm = new ServiceManager();
  await sm.initialize(a);
  const s = sm.getServices();
  const budgetId = await s.budgets.createBudget({
    name: 'Snap',
    display_currency: 'USD',
    badge_icon: 'dollar',
    number_format: '123,456.78',
    create_default_categories: false,
  });
  const mk = async (name: string, type: string, bal: number, onBudget?: boolean) =>
    (
      await s.accounts.createAccount(
        name,
        budgetId,
        type,
        'USD',
        asMilli(bal),
        undefined,
        onBudget,
        'Initial Balance',
        '2026-01-01'
      )
    ).ID;
  const chk = await mk('Checking', 'checking', 1_000_000);
  const sav = await mk('Savings', 'savings', 500_000, true);
  const savOff = await mk('Tracking', 'savings', 2_000_000, false);
  const card = await mk('Card', 'credit', 0);
  const card2 = await mk('Card 2', 'credit', 0);
  const group = s.categories.addCategoryGroup('Living', budgetId);
  const group2 = s.categories.addCategoryGroup('Fun', budgetId);
  const food = s.categories.addCategory(group, budgetId, 'Food');
  const rent = s.categories.addCategory(group, budgetId, 'Rent');
  const fun = s.categories.addCategory(group2, budgetId, 'Fun');
  const cats = s.categories.getAllCategories(budgetId);
  const income = (
    a
      .prepare(
        "SELECT c.ID FROM categories c JOIN category_groups cg ON cg.ID = c.CategoryGroupID WHERE cg.Name = 'Income' AND c.BudgetID = ?"
      )
      .get(budgetId) as { ID: number }
  ).ID;
  const transfers = cats.find((c) => c.Name === 'Transfers')!.ID;
  return {
    adapter: a,
    s,
    budgetId,
    chk,
    sav,
    savOff,
    card,
    card2,
    food,
    rent,
    fun,
    income,
    transfers,
    group,
    group2,
  };
}

const MONTHS = ['2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05'];
const MONTHS_WIDE = [...MONTHS, '2026-09', '2026-10', '2026-11', '2026-12', '2027-03', '2031-01'];

function reads(c: Ctx, months: string[], budgetId = c.budgetId) {
  const out: Record<string, unknown> = {};
  for (const mode of ['cumulative', 'monthly']) {
    c.adapter.exec(`UPDATE budgets SET RtaMode='${mode}' WHERE ID=${budgetId}`);
    for (const m of months) out[`${mode}/${m}`] = c.s.monthlyBudgets.getMonthlyBudget(m, budgetId);
    out[`${mode}/rtaMap`] = c.s.monthlyBudgets.getReadyToAssignBreakdownMap(budgetId, months);
    for (const m of months)
      out[`${mode}/rta/${m}`] = c.s.monthlyBudgets.getReadyToAssignBreakdown(budgetId, m);
    out[`${mode}/rta`] = c.s.monthlyBudgets.getReadyToAssignBreakdown(budgetId);
  }
  c.adapter.exec(`UPDATE budgets SET RtaMode='cumulative' WHERE ID=${budgetId}`);
  return out;
}

/** Snapshot reads (verify on, snapshot used) equal reads with the snapshot off. */
function expectMatches(c: Ctx, months = MONTHS, budgetId = c.budgetId) {
  const store = getBudgetSnapshotStore(c.adapter)!;
  expect(store).not.toBeNull();
  const fallbacks = store.stats.fallbacks;
  const viaSnapshot = reads(c, months, budgetId);
  expect(store.stats.fallbacks, 'every read used the snapshot').toBe(fallbacks);
  expect(store.healthy).toBe(true);
  configureBudgetSnapshot({ enabled: false });
  try {
    const full = reads(c, months, budgetId);
    expect(firstDifference(full, viaSnapshot)).toBeNull();
  } finally {
    configureBudgetSnapshot({ enabled: true });
  }
  return viaSnapshot;
}

const spend = (c: Ctx, account: number, category: number, amount: number, date: string) =>
  c.s.transactions.addTransaction(
    asMilli(0),
    asMilli(amount),
    account,
    category,
    c.budgetId,
    date,
    'spend',
    '',
    'Shop'
  );
const earn = (c: Ctx, account: number, category: number, amount: number, date: string) =>
  c.s.transactions.addTransaction(
    asMilli(amount),
    asMilli(0),
    account,
    category,
    c.budgetId,
    date,
    'in',
    '',
    'Shop'
  );
async function transfer(
  c: Ctx,
  from: number,
  to: number,
  amount: number,
  date: string,
  tid: string
) {
  await c.s.transactions.addTransaction(
    asMilli(0),
    asMilli(amount),
    from,
    c.transfers,
    c.budgetId,
    date,
    'x',
    tid
  );
  await c.s.transactions.addTransaction(
    asMilli(amount),
    asMilli(0),
    to,
    c.transfers,
    c.budgetId,
    date,
    'x',
    tid
  );
}
const assign = (c: Ctx, category: number, amount: number, month: string) =>
  c.s.monthlyBudgets.upsertMonthlyAssignment(category, asMilli(amount), month, c.budgetId);
const paymentCategoryOf = (c: Ctx, card: number) =>
  JSON.parse(c.s.accounts.getAccount(card).Metadata || '{}').cc_payment_category_id as number;

// ------------------------------------------------------------------ the 14 risks

describe('budget snapshot edge cases', () => {
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 3, 15, 12, 0, 0)); // 2026-04-15
    configureBudgetSnapshot({ enabled: true, verify: true });
  });
  afterAll(() => {
    configureBudgetSnapshot({ enabled: undefined, verify: undefined });
    vi.useRealTimers();
  });

  it('1. monthly floors: a back-dated change re-folds every later month', async () => {
    const c = await setup();
    assign(c, c.food, 100_000, '2026-01');
    await spend(c, c.chk, c.food, 150_000, '2026-01-10'); // overspent in January
    assign(c, c.food, 40_000, '2026-03');
    expectMatches(c);
    const builds = getBudgetSnapshotStore(c.adapter)!.stats.builds;
    // back-date a fix into January: February and March change through the floor
    assign(c, c.food, 200_000, '2026-01');
    const after = expectMatches(c);
    const march = (after['monthly/2026-03'] as { CategoryID: number; Available: number }[]).find(
      (r) => r.CategoryID === c.food
    )!;
    expect(march.Available).toBe(90_000);
    expect(getBudgetSnapshotStore(c.adapter)!.stats.builds).toBe(builds); // incremental, no rebuild
  });

  it('2. split parents: adding and clearing splits flips which rows count', async () => {
    const c = await setup();
    await spend(c, c.chk, c.food, 60_000, '2026-02-03');
    const id = (
      c.adapter.prepare("SELECT MAX(ID) id FROM transactions WHERE Memo='spend'").get() as {
        id: number;
      }
    ).id;
    expectMatches(c);
    await c.s.splits.upsertSplits(id, [
      {
        CategoryID: c.rent,
        InflowConverted: asMilli(0),
        OutflowConverted: asMilli(20_000),
        OrderIndex: 0,
      },
      {
        CategoryID: c.fun,
        InflowConverted: asMilli(0),
        OutflowConverted: asMilli(40_000),
        OrderIndex: 1,
      },
    ]);
    expectMatches(c);
    // a split-line write alone (no parent write) still dirties the parent's month
    c.adapter.exec(
      `UPDATE transaction_splits SET CategoryID = ${c.food} WHERE TransactionID = ${id} AND OrderIndex = 1`
    );
    expectMatches(c);
    await c.s.splits.clearSplits(id);
    expectMatches(c);
  });

  it('3. split-transfer mirrors move with the parent date', async () => {
    const c = await setup();
    await spend(c, c.chk, c.food, 80_000, '2026-01-20');
    const id = (
      c.adapter.prepare("SELECT MAX(ID) id FROM transactions WHERE Memo='spend'").get() as {
        id: number;
      }
    ).id;
    await c.s.splits.upsertSplits(id, [
      {
        CategoryID: c.food,
        InflowConverted: asMilli(0),
        OutflowConverted: asMilli(30_000),
        OrderIndex: 0,
      },
      {
        TransferAccountID: c.savOff,
        InflowConverted: asMilli(0),
        OutflowConverted: asMilli(50_000),
        OrderIndex: 1,
      },
    ]);
    expectMatches(c);
    await c.s.transactions.updateTransactionColumn(id, 'Date', '2026-03-05');
    expectMatches(c);
  });

  it('4. card cash/credit split follows the running balance (back-dated card inflow)', async () => {
    const c = await setup();
    assign(c, c.food, 50_000, '2026-02');
    await spend(c, c.card, c.food, 70_000, '2026-02-10');
    await spend(c, c.card, c.food, 30_000, '2026-03-10');
    expectMatches(c);
    // a January refund on the card makes later purchases partly cash
    await earn(c, c.card, c.rent, 90_000, '2026-01-05');
    const r = expectMatches(c);
    const feb = (r['monthly/2026-02'] as { CategoryID: number; CashActivity: number }[]).find(
      (x) => x.CategoryID === c.food
    )!;
    expect(feb.CashActivity).toBe(-70_000);
  });

  it('5. CC funding follows purchase order and refunds cancel the same card first', async () => {
    const c = await setup();
    assign(c, c.food, 50_000, '2026-02');
    await spend(c, c.card, c.food, 40_000, '2026-02-01');
    await spend(c, c.card2, c.food, 40_000, '2026-02-02');
    await earn(c, c.card, c.food, 15_000, '2026-02-03'); // refund on card 1
    expectMatches(c);
    // reorder by moving the second purchase before the first
    const id = (
      c.adapter
        .prepare('SELECT ID FROM transactions WHERE AccountID=? AND OutflowConverted=40000')
        .get(c.card2) as { ID: number }
    ).ID;
    await c.s.transactions.updateTransactionColumn(id, 'Date', '2026-02-01');
    expectMatches(c);
  });

  it('6. cumulative CC payment rows use all-time funding and payments', async () => {
    const c = await setup();
    const pc = paymentCategoryOf(c, c.card);
    assign(c, c.food, 30_000, '2026-01');
    await spend(c, c.card, c.food, 50_000, '2026-01-10');
    assign(c, c.food, 30_000, '2026-02');
    await transfer(c, c.chk, c.card, 20_000, '2026-02-15', 'pay1');
    assign(c, pc, 5_000, '2026-03');
    const r = expectMatches(c);
    const row = (
      r['cumulative/2026-03'] as { CategoryID: number; Available: number; totalFunded: number }[]
    ).find((x) => x.CategoryID === pc)!;
    expect(row.totalFunded).toBe(50_000);
    expect(row.Available).toBe(5_000 + 50_000 - 20_000);
  });

  it('7. cumulative RTA is day-bounded: future-dated rows of the current month and midnight rollover', async () => {
    const c = await setup();
    const incomeCat = c.income;
    await earn(c, c.chk, incomeCat, 300_000, '2026-04-10');
    await earn(c, c.chk, incomeCat, 700_000, '2026-04-20'); // after "today"
    await earn(c, c.chk, incomeCat, 50_000, '2026-03-31');
    await transfer(c, c.chk, c.savOff, 10_000, '2026-04-25', 'later');
    const before = expectMatches(c);
    // the clock moves past midnight into the next month: no write, no invalidation
    vi.setSystemTime(new Date(2026, 4, 1, 0, 1, 0));
    try {
      const after = expectMatches(c);
      expect((after['cumulative/rta'] as { income: number }).income).toBe(
        (before['cumulative/rta'] as { income: number }).income + 700_000
      );
    } finally {
      vi.setSystemTime(new Date(2026, 3, 15, 12, 0, 0));
    }
  });

  it('8. off-budget transfer detection follows the partner leg', async () => {
    const c = await setup();
    await transfer(c, c.chk, c.savOff, 40_000, '2026-02-10', 'off1');
    await transfer(c, c.savOff, c.chk, 15_000, '2026-03-10', 'in1');
    expectMatches(c);
    // move the partner leg to another month, then to an on-budget account
    const partner = (
      c.adapter
        .prepare("SELECT ID FROM transactions WHERE TransferID='off1' AND AccountID=?")
        .get(c.savOff) as { ID: number }
    ).ID;
    c.adapter.exec(`UPDATE transactions SET Date='2026-04-02' WHERE ID=${partner}`);
    expectMatches(c);
    c.adapter.exec(`UPDATE transactions SET AccountID=${c.sav} WHERE ID=${partner}`);
    expectMatches(c);
    c.adapter.exec(`DELETE FROM transactions WHERE ID=${partner}`);
    expectMatches(c);
    // excluded from Ready to Assign
    c.adapter.exec(`UPDATE transactions SET ExcludeFromReadyToAssign = 1 WHERE TransferID='in1'`);
    expectMatches(c);
  });

  it('9. account budget status / type / CC link and category groups', async () => {
    const c = await setup();
    assign(c, c.food, 80_000, '2026-02');
    await spend(c, c.sav, c.food, 30_000, '2026-02-02');
    await spend(c, c.card, c.fun, 25_000, '2026-02-03');
    await transfer(c, c.chk, c.savOff, 10_000, '2026-02-05', 'x1');
    expectMatches(c);
    const store = getBudgetSnapshotStore(c.adapter)!;
    let builds = store.stats.builds;
    await c.s.accounts.updateAccount(c.sav, '', '', '', undefined, false); // off budget
    expectMatches(c);
    expect(store.stats.builds).toBeGreaterThan(builds);
    await c.s.accounts.updateAccount(c.savOff, '', 'investment', ''); // type change
    expectMatches(c);
    // CC link moved to the other card's payment category
    const pc2 = paymentCategoryOf(c, c.card2);
    c.adapter.exec(
      `UPDATE accounts SET Metadata='${JSON.stringify({ cc_payment_category_id: pc2 })}' WHERE ID=${c.card}`
    );
    expectMatches(c);
    // category moves and group renames re-fold without SQL
    builds = store.stats.builds;
    c.s.categories.moveCategoryToNewGroup(c.group2, c.food);
    expectMatches(c);
    // a rename into a system group name (not allowed through the service; raw SQL)
    c.adapter.exec(`UPDATE category_groups SET Name = 'Income' WHERE ID = ${c.group2}`);
    expectMatches(c);
    c.adapter.exec(`UPDATE category_groups SET Name = 'Fun again' WHERE ID = ${c.group2}`);
    c.s.categories.updateCategoryName(c.fun, 'Renamed');
    expectMatches(c);
    expect(store.stats.builds).toBe(builds);
    // unchanged account edits fire nothing
    await c.s.accounts.updateAccount(c.chk, 'Checking renamed', '', '');
    expectMatches(c);
    expect(store.stats.builds).toBe(builds);
  });

  it('10. FX: rate edits rewrite converted amounts, revaluations count', async () => {
    const c = await setup();
    const eur = (
      await c.s.accounts.createAccount(
        'EUR',
        c.budgetId,
        'checking',
        'EUR',
        asMilli(100_000),
        undefined,
        true,
        'Initial Balance',
        '2026-01-01'
      )
    ).ID;
    await spend(c, eur, c.food, 20_000, '2026-02-02');
    await spend(c, eur, c.rent, 30_000, '2026-03-02');
    expectMatches(c);
    await c.s.currency.addCustomRate('EUR', 'USD', 1.25, '2026-01-01', '2026-02-28', c.budgetId);
    expectMatches(c);
    const id = (
      c.adapter
        .prepare('SELECT ID FROM transactions WHERE AccountID=? AND OutflowNative=30000')
        .get(eur) as { ID: number }
    ).ID;
    await c.s.transactions.updateTransactionColumn(id, 'ExchangeRate', 1.4, true);
    expectMatches(c);
    await c.s.currency.revalueAccounts(c.budgetId);
    expectMatches(c);
  });

  it('11. multi-budget: snapshots are keyed by budget', async () => {
    const c = await setup();
    const b2 = await c.s.budgets.createBudget({
      name: 'Other',
      display_currency: 'USD',
      badge_icon: 'dollar',
      number_format: '123,456.78',
      create_default_categories: true,
    });
    const chk2 = (
      await c.s.accounts.createAccount('Other Checking', b2, 'checking', 'USD', asMilli(50_000))
    ).ID;
    const cat2 = c.s.categories.addCategory(c.s.categories.addCategoryGroup('G2', b2), b2, 'C2');
    assign(c, c.food, 10_000, '2026-02');
    await spend(c, c.chk, c.food, 5_000, '2026-02-02');
    expectMatches(c);
    expectMatches(c, MONTHS, b2);
    const before = reads(c, MONTHS);
    await c.s.transactions.addTransaction(
      asMilli(0),
      asMilli(7_000),
      chk2,
      cat2,
      b2,
      '2026-02-03',
      'b2'
    );
    c.s.monthlyBudgets.upsertMonthlyAssignment(cat2, asMilli(9_000), '2026-02', b2);
    expect(firstDifference(before, expectMatches(c))).toBeNull(); // budget 1 untouched
    expectMatches(c, MONTHS, b2);
    c.s.budgets.deleteBudget(b2);
    expectMatches(c);
  });

  it('12. restore / replace invalidates; export keeps the snapshot and re-installs the hooks', async () => {
    const c = await setup();
    assign(c, c.food, 10_000, '2026-02');
    await spend(c, c.chk, c.food, 5_000, '2026-02-02');
    expectMatches(c);
    const store = getBudgetSnapshotStore(c.adapter)!;
    const builds = store.stats.builds;
    const exported = await c.adapter.backup();
    expect(store.healthy).toBe(true);
    await spend(c, c.chk, c.food, 1_000, '2026-02-03'); // a write right after the export is seen
    expectMatches(c);
    expect(store.stats.builds).toBe(builds);
    await c.adapter.restore(exported);
    expectMatches(c);
    expect(store.stats.builds).toBeGreaterThan(builds);
    // hooks dropped behind the store's back -> invalidate all, reinstall
    for (const r of c.adapter
      .prepare("SELECT name FROM sqlite_temp_master WHERE type='trigger'")
      .all() as { name: string }[])
      c.adapter.exec(`DROP TRIGGER temp.${r.name}`);
    await spend(c, c.chk, c.food, 2_000, '2026-02-04'); // not seen by any trigger
    const inv = store.stats.invalidations;
    expectMatches(c);
    expect(store.stats.invalidations).toBeGreaterThan(inv);
    await c.adapter.restoreAndMigrate(exported);
    expectMatches(c);
  });

  it('13. months beyond the stored range carry forward; future rows extend it', async () => {
    const c = await setup();
    assign(c, c.food, 10_000, '2026-02');
    await spend(c, c.card, c.food, 25_000, '2026-02-02');
    expectMatches(c, MONTHS_WIDE);
    assign(c, c.rent, 33_000, '2027-01');
    await spend(c, c.chk, c.rent, 3_000, '2026-12-24');
    expectMatches(c, MONTHS_WIDE);
  });

  it('14. raw SQL writes (undo/redo, replayed and pushed ops) are tracked', async () => {
    const c = await setup();
    assign(c, c.food, 10_000, '2026-02');
    await spend(c, c.chk, c.food, 5_000, '2026-02-02');
    expectMatches(c);
    c.adapter.exec(
      `INSERT INTO transactions (CategoryID, AccountID, Date, InflowConverted, OutflowConverted, BudgetID)
       VALUES (${c.rent}, ${c.card}, '2026-03-03', 0, 12000, ${c.budgetId})`
    );
    c.adapter.exec(`UPDATE assignments SET Month='2026-04' WHERE CategoryID=${c.food}`);
    c.adapter.exec(
      `UPDATE transactions SET BudgetID=BudgetID, OutflowConverted=OutflowConverted+1 WHERE CategoryID=${c.food}`
    );
    expectMatches(c);
    c.adapter.exec(`DELETE FROM assignments WHERE CategoryID=${c.food}`);
    expectMatches(c);
    // category delete cascades (FK) through the triggers too
    c.s.categories.deleteCategory(c.rent);
    expectMatches(c);
  });

  it('never uses or refreshes the snapshot inside a transaction; rollbacks leave it correct', async () => {
    const c = await setup();
    assign(c, c.food, 10_000, '2026-02');
    expectMatches(c);
    const store = getBudgetSnapshotStore(c.adapter)!;
    const before = reads(c, MONTHS);
    expect(() =>
      c.adapter.transaction(() => {
        c.adapter.exec(`UPDATE assignments SET Amount = 99999 WHERE CategoryID = ${c.food}`);
        const fallbacks = store.stats.fallbacks;
        c.s.monthlyBudgets.getMonthlyBudget('2026-02', c.budgetId); // full path, sees the write
        expect(store.stats.fallbacks).toBe(fallbacks + 1);
        throw new Error('rollback');
      })
    ).toThrow('rollback');
    expect(firstDifference(before, expectMatches(c))).toBeNull();
  });

  it('falls back to the full queries for rows the snapshot cannot index', async () => {
    const c = await setup();
    await spend(c, c.chk, c.food, 5_000, '2026-02-02');
    expectMatches(c);
    c.adapter.exec(`UPDATE transactions SET Date='2026-02-31x' WHERE Memo='spend'`); // DATE() is NULL
    const store = getBudgetSnapshotStore(c.adapter)!;
    const fallbacks = store.stats.fallbacks;
    c.s.monthlyBudgets.getMonthlyBudget('2026-02', c.budgetId);
    expect(store.stats.fallbacks).toBe(fallbacks + 1);
    c.adapter.exec(`UPDATE transactions SET Date='2026-02-28' WHERE Memo='spend'`);
    expectMatches(c);
    // a malformed requested month uses the full queries too
    c.s.monthlyBudgets.getMonthlyBudget('2026-2', c.budgetId);
    expect(store.stats.fallbacks).toBeGreaterThan(fallbacks + 1);
  });

  it('is off with BUDGERO_SNAPSHOT=0 semantics (enabled: false)', async () => {
    const c = await setup();
    configureBudgetSnapshot({ enabled: false });
    try {
      c.s.monthlyBudgets.getMonthlyBudget('2026-02', c.budgetId);
      expect(getBudgetSnapshotStore(c.adapter)).toBeNull();
    } finally {
      configureBudgetSnapshot({ enabled: true });
    }
  });
});

// ------------------------------------------------------------------ web adapter hooks

describe('budget snapshot on the web adapter', () => {
  afterEach(() => vi.unstubAllGlobals());
  beforeAll(() => configureBudgetSnapshot({ enabled: true, verify: true }));
  afterAll(() => configureBudgetSnapshot({ enabled: undefined, verify: undefined }));

  it('re-installs hooks after export / forceSave and invalidates on replaceDatabase', async () => {
    vi.stubGlobal('navigator', {
      storage: {
        getDirectory: async () => ({
          getFileHandle: async () => ({
            createWritable: async () => ({
              write: async () => undefined,
              close: async () => undefined,
              abort: async () => undefined,
            }),
          }),
        }),
      },
    });
    const SQL = await initSqlJs({
      locateFile: (file) => path.join(process.cwd(), 'node_modules', 'sql.js', 'dist', file),
    });
    const node = await NodeSqlJsAdapter.create();
    const bytes = node.backup();
    node.close();
    const web = Object.assign(Object.create(WebDatabaseAdapter.prototype) as WebDatabaseAdapter, {
      dbFilename: 'snapshot-test.db',
      db: new SQL.Database(bytes),
      SQL,
      fkCheckCounter: 0,
      fkSuspended: false,
    });
    const c = await setup(web);
    assign(c, c.food, 10_000, '2026-02');
    await spend(c, c.card, c.food, 5_000, '2026-02-02');
    expectMatches(c);
    const store = getBudgetSnapshotStore(web)!;
    const builds = store.stats.builds;
    await web.forceSave();
    await web.saveToOPFSPublic();
    await spend(c, c.chk, c.food, 1_000, '2026-02-03');
    expectMatches(c);
    expect(store.stats.builds).toBe(builds);
    await web.restore(web.backup());
    expectMatches(c);
    expect(store.stats.builds).toBeGreaterThan(builds);
    await web.restoreAndMigrate(web.backup());
    expectMatches(c);
  });
});
