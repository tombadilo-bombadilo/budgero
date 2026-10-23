import { describe, it, expect } from 'vitest';
import { NodeSqlJsAdapter, ServiceManager, DatabaseAdapter, asMilli } from '../src';

/**
 * Issue #69: a card-to-card balance transfer (outflow on Card B, inflow on
 * Card A, same TransferID) moves debt but no cash. Ready to Assign and the
 * CC Payment categories should not treat it as a payment of Card A.
 */
type Mode = 'cumulative' | 'monthly';

async function setup(mode: Mode, debtVia: 'purchase' | 'opening') {
  const adapter = await NodeSqlJsAdapter.create();
  const sm = new ServiceManager();
  await sm.initialize(adapter as DatabaseAdapter);
  const s = sm.getServices();
  const budgetId = await s.budgets.createBudget({
    name: 'BT',
    display_currency: 'USD',
    badge_icon: 'dollar',
    number_format: '123,456.78',
    create_default_categories: true,
  });
  if (mode === 'monthly') s.budgets.updateRtaMode(budgetId, 'monthly');
  const cats = s.categories.getAllCategories(budgetId);
  const incomeId = cats.find((c: { Name: string }) => c.Name === 'Income')!.ID;
  const group = s.categories.addCategoryGroup('Spending', budgetId);
  const food = s.categories.addCategory(group, budgetId, 'Food');

  const checking = await s.accounts.createAccount('Checking', budgetId, 'checking', 'USD', 0);
  await s.transactions.addTransaction(
    asMilli(2000),
    0,
    checking.ID,
    incomeId,
    budgetId,
    '2024-01-05',
    'pay'
  );
  const cardA = await s.accounts.createAccount(
    'Card A',
    budgetId,
    'credit',
    'USD',
    debtVia === 'opening' ? asMilli(-1000) : 0,
    undefined,
    undefined,
    'Initial Balance',
    '2024-01-01'
  );
  const cardB = await s.accounts.createAccount('Card B', budgetId, 'credit', 'USD', 0);
  if (debtVia === 'purchase') {
    // Unfunded $1,000 purchase on Card A in January: credit overspend -> debt.
    await s.transactions.addTransaction(
      0,
      asMilli(1000),
      cardA.ID,
      food,
      budgetId,
      '2024-01-10',
      'tv'
    );
  }
  const payCat = (id: number) =>
    JSON.parse((s.accounts.getAccount(id).Metadata as string) || '{}')
      .cc_payment_category_id as number;
  return { s, budgetId, cardA, cardB, payA: payCat(cardA.ID), payB: payCat(cardB.ID) };
}

async function balanceTransfer(
  s: any,
  budgetId: number,
  fromCard: number,
  toCard: number,
  amount: number
) {
  const transfersCat = s.categories
    .getAllCategories(budgetId)
    .find((c: { Name: string }) => c.Name === 'Transfers')?.ID;
  // Card B takes on the debt (outflow), Card A's debt goes down (inflow).
  await s.transactions.addTransaction(
    0,
    amount,
    fromCard,
    transfersCat,
    budgetId,
    '2024-02-10',
    'balance transfer',
    'bt-69'
  );
  await s.transactions.addTransaction(
    amount,
    0,
    toCard,
    transfersCat,
    budgetId,
    '2024-02-10',
    'balance transfer',
    'bt-69'
  );
}

function avail(s: any, month: string, budgetId: number, categoryId: number): number {
  return (
    s.monthlyBudgets
      .getMonthlyBudget(month, budgetId)
      .find((r: { CategoryID: number }) => r.CategoryID === categoryId)?.Available ?? 0
  );
}

describe('Issue #69: card-to-card balance transfer', () => {
  for (const mode of ['cumulative', 'monthly'] as Mode[]) {
    for (const debtVia of ['purchase', 'opening'] as const) {
      it(`leaves RTA and CC Payment categories alone (${mode}, debt via ${debtVia})`, async () => {
        const { s, budgetId, cardA, cardB, payA, payB } = await setup(mode, debtVia);
        const before = {
          rtaFeb: s.monthlyBudgets.getReadyToAssign(budgetId, '2024-02'),
          rtaMar: s.monthlyBudgets.getReadyToAssign(budgetId, '2024-03'),
          payAFeb: avail(s, '2024-02', budgetId, payA),
          payBFeb: avail(s, '2024-02', budgetId, payB),
        };
        await balanceTransfer(s, budgetId, cardB.ID, cardA.ID, asMilli(1000));
        const after = {
          rtaFeb: s.monthlyBudgets.getReadyToAssign(budgetId, '2024-02'),
          rtaMar: s.monthlyBudgets.getReadyToAssign(budgetId, '2024-03'),
          payAFeb: avail(s, '2024-02', budgetId, payA),
          payBFeb: avail(s, '2024-02', budgetId, payB),
          payAMar: avail(s, '2024-03', budgetId, payA),
        };
        console.log(`[#69 ${mode}/${debtVia}]`, JSON.stringify({ before, after }));
        expect(after.rtaFeb).toBe(before.rtaFeb);
        expect(after.rtaMar).toBe(before.rtaMar);
        expect(after.payAFeb).toBe(before.payAFeb);
        expect(after.payBFeb).toBe(before.payBFeb);
      });
    }
  }
});
