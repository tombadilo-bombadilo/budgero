// Repro for GitHub issue #68: a credit card refund that becomes category
// available, later spent from cash (or moved out), is booked as a cash
// overspend and pulled from Ready to Assign in monthly mode.
import { describe, it, expect } from 'vitest';
import { NodeSqlJsAdapter, ServiceManager, DatabaseAdapter, asMilli } from '../src';

async function setup(mode: 'monthly' | 'cumulative') {
  const adapter = await NodeSqlJsAdapter.create();
  const sm = new ServiceManager();
  await sm.initialize(adapter as DatabaseAdapter);
  const services = sm.getServices();
  const budgetId = await services.budgets.createBudget({
    name: 'Issue68',
    display_currency: 'USD',
    badge_icon: 'dollar',
    number_format: '123,456.78',
    create_default_categories: true,
  });
  const cats = services.categories.getAllCategories(budgetId);
  const incomeId = cats.find((c: { Name: string }) => c.Name === 'Income')!.ID;
  const group = services.categories.addCategoryGroup('Spending', budgetId);
  const shopping = services.categories.addCategory(group, budgetId, 'Shopping');
  const other = services.categories.addCategory(group, budgetId, 'Other');
  const checking = await services.accounts.createAccount(
    'Checking',
    budgetId,
    'checking',
    'USD',
    asMilli(0)
  );
  const card = await services.accounts.createAccount('Card', budgetId, 'credit', 'USD', asMilli(0));
  if (mode === 'monthly') services.budgets.updateRtaMode(budgetId, 'monthly');
  await services.transactions.addTransaction(
    asMilli(1000),
    asMilli(0),
    checking.ID,
    incomeId,
    budgetId,
    '2024-01-01',
    'pay'
  );
  return { services, budgetId, shopping, other, checking, card };
}

const row = (s: any, m: string, b: number, id: number) =>
  s.monthlyBudgets.getMonthlyBudget(m, b).find((r: { CategoryID: number }) => r.CategoryID === id);
const avail = (s: any, m: string, b: number, id: number) => row(s, m, b, id)?.Available ?? 0;
const ccPay = (s: any, m: string, b: number) =>
  s.monthlyBudgets
    .getMonthlyBudget(m, b)
    .find((r: { CategoryGroup: string }) => r.CategoryGroup === 'Credit Card Payments')
    ?.Available ?? 0;
const bal = (s: any, b: number) =>
  s.accounts
    .listAccounts(b)
    .reduce(
      (sum: number, a: any) =>
        sum + (a.OnBudget ? (a.BalanceConverted ?? a.BalanceNative ?? 0) : 0),
      0
    );

function snapshot(s: any, b: number, ids: { shopping: number; other: number }, m: string) {
  const rta = s.monthlyBudgets.getReadyToAssign(b, m);
  const shop = avail(s, m, b, ids.shopping);
  const oth = avail(s, m, b, ids.other);
  const pay = ccPay(s, m, b);
  // cashNow = all-time on-budget balance (only meaningful for the last month).
  const out = { m, rta, shop, oth, pay, envelopes: rta + shop + oth + pay, cashNow: bal(s, b) };
  console.log(JSON.stringify(out));
  return out;
}

describe('issue #68: card refund later spent from cash', () => {
  for (const mode of ['monthly', 'cumulative'] as const) {
    it(`[${mode}] A: refund with no prior card debt, spent from checking next month`, async () => {
      const ctx = await setup(mode);
      const { services: s, budgetId: b, shopping, card, checking } = ctx;
      // Jan: $100 refund lands on the card, categorized Shopping.
      await s.transactions.addTransaction(
        asMilli(100),
        asMilli(0),
        card.ID,
        shopping,
        b,
        '2024-01-15',
        'refund'
      );
      // Feb: $100 spent from checking in Shopping.
      await s.transactions.addTransaction(
        asMilli(0),
        asMilli(100),
        checking.ID,
        shopping,
        b,
        '2024-02-10',
        'buy'
      );
      snapshot(s, b, ctx, '2024-01');
      snapshot(s, b, ctx, '2024-02');
      const mar = snapshot(s, b, ctx, '2024-03');
      expect(avail(s, '2024-01', b, shopping)).toBe(asMilli(100));
      expect(avail(s, '2024-02', b, shopping)).toBe(asMilli(0));
      // Checking 900 + card +100 = 1000 of on-budget money, nothing overspent.
      expect(mar.cashNow).toBe(asMilli(1000));
      expect(mar.rta).toBe(asMilli(1000));
    });

    it(`[${mode}] B: funded card purchase, refunded next month, then spent from checking`, async () => {
      const ctx = await setup(mode);
      const { services: s, budgetId: b, shopping, card, checking } = ctx;
      s.monthlyBudgets.upsertMonthlyAssignment(shopping, asMilli(100), '2024-01', b);
      await s.transactions.addTransaction(
        asMilli(0),
        asMilli(100),
        card.ID,
        shopping,
        b,
        '2024-01-10',
        'buy'
      );
      await s.transactions.addTransaction(
        asMilli(100),
        asMilli(0),
        card.ID,
        shopping,
        b,
        '2024-02-10',
        'refund'
      );
      await s.transactions.addTransaction(
        asMilli(0),
        asMilli(100),
        checking.ID,
        shopping,
        b,
        '2024-03-10',
        'buy again'
      );
      snapshot(s, b, ctx, '2024-01');
      snapshot(s, b, ctx, '2024-02');
      snapshot(s, b, ctx, '2024-03');
      const apr = snapshot(s, b, ctx, '2024-04');
      expect(avail(s, '2024-02', b, shopping)).toBe(asMilli(100));
      expect(avail(s, '2024-03', b, shopping)).toBe(asMilli(0));
      // Checking 900, card 0. 100 assigned + 100 spent -> RTA 900.
      expect(apr.cashNow).toBe(asMilli(900));
      expect(apr.rta).toBe(asMilli(900));
    });

    it(`[${mode}] C: refund moved to another category by negative assignment`, async () => {
      const ctx = await setup(mode);
      const { services: s, budgetId: b, shopping, other, card } = ctx;
      await s.transactions.addTransaction(
        asMilli(100),
        asMilli(0),
        card.ID,
        shopping,
        b,
        '2024-01-15',
        'refund'
      );
      s.monthlyBudgets.upsertMonthlyAssignment(shopping, asMilli(-100), '2024-02', b);
      s.monthlyBudgets.upsertMonthlyAssignment(other, asMilli(100), '2024-02', b);
      snapshot(s, b, ctx, '2024-02');
      const mar = snapshot(s, b, ctx, '2024-03');
      expect(avail(s, '2024-03', b, other)).toBe(asMilli(100));
      // 1100 money (checking 1000 + card +100) = RTA 1000 + Other 100.
      expect(mar.rta).toBe(asMilli(1000));
    });
  }

  it('[monthly] D: funded purchase refunded next month, then moved out by negative assignment', async () => {
    const ctx = await setup('monthly');
    const { services: s, budgetId: b, shopping, other, card } = ctx;
    s.monthlyBudgets.upsertMonthlyAssignment(shopping, asMilli(100), '2024-01', b);
    await s.transactions.addTransaction(
      asMilli(0),
      asMilli(100),
      card.ID,
      shopping,
      b,
      '2024-01-10',
      'buy'
    );
    await s.transactions.addTransaction(
      asMilli(100),
      asMilli(0),
      card.ID,
      shopping,
      b,
      '2024-02-10',
      'refund'
    );
    s.monthlyBudgets.upsertMonthlyAssignment(shopping, asMilli(-100), '2024-03', b);
    s.monthlyBudgets.upsertMonthlyAssignment(other, asMilli(100), '2024-03', b);
    snapshot(s, b, ctx, '2024-03');
    const apr = snapshot(s, b, ctx, '2024-04');
    // Checking 1000, card 0: RTA 900 + Other 100.
    expect(apr.cashNow).toBe(asMilli(1000));
    expect(apr.rta).toBe(asMilli(900));
  });

  it('[monthly] B: refund moves the CC Payment balance back to the category', async () => {
    const ctx = await setup('monthly');
    const { services: s, budgetId: b, shopping, card } = ctx;
    s.monthlyBudgets.upsertMonthlyAssignment(shopping, asMilli(100), '2024-01', b);
    await s.transactions.addTransaction(
      asMilli(0),
      asMilli(100),
      card.ID,
      shopping,
      b,
      '2024-01-10',
      'buy'
    );
    await s.transactions.addTransaction(
      asMilli(100),
      asMilli(0),
      card.ID,
      shopping,
      b,
      '2024-02-10',
      'refund'
    );
    expect(ccPay(s, '2024-01', b)).toBe(asMilli(100));
    expect(ccPay(s, '2024-02', b)).toBe(asMilli(0));
  });

  // Side finding: cumulative mode used to leave CC Payment at 100 after the
  // refund although the card owes 0, so envelopes exceeded cash by 100.
  it('[cumulative] side: refund does not reduce CC Payment available', async () => {
    const ctx = await setup('cumulative');
    const { services: s, budgetId: b, shopping, card } = ctx;
    s.monthlyBudgets.upsertMonthlyAssignment(shopping, asMilli(100), '2024-01', b);
    await s.transactions.addTransaction(
      asMilli(0),
      asMilli(100),
      card.ID,
      shopping,
      b,
      '2024-01-10',
      'buy'
    );
    await s.transactions.addTransaction(
      asMilli(100),
      asMilli(0),
      card.ID,
      shopping,
      b,
      '2024-02-10',
      'refund'
    );
    expect(ccPay(s, '2024-02', b)).toBe(asMilli(0));
  });

  it('[monthly] control: refund of an UNFUNDED credit overspend is not cash', async () => {
    const ctx = await setup('monthly');
    const { services: s, budgetId: b, shopping, card, checking } = ctx;
    // Jan: unfunded $50 card purchase (credit overspend, never hits RTA).
    await s.transactions.addTransaction(
      asMilli(0),
      asMilli(50),
      card.ID,
      shopping,
      b,
      '2024-01-10',
      'buy'
    );
    // Feb: refunded; Shopping shows +50 but the card simply returns to 0.
    await s.transactions.addTransaction(
      asMilli(50),
      asMilli(0),
      card.ID,
      shopping,
      b,
      '2024-02-10',
      'refund'
    );
    await s.transactions.addTransaction(
      asMilli(0),
      asMilli(50),
      checking.ID,
      shopping,
      b,
      '2024-03-10',
      'buy'
    );
    snapshot(s, b, ctx, '2024-02');
    const apr = snapshot(s, b, ctx, '2024-04');
    // Money: checking 950 + card 0. Current behaviour books the March spend
    // as cash overspend, which is what keeps envelopes == cash here.
    expect(apr.cashNow).toBe(asMilli(950));
    expect(apr.rta).toBe(asMilli(950));
  });
});
