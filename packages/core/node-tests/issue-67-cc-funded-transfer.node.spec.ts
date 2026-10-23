import { describe, it, expect } from 'vitest';
import { NodeSqlJsAdapter, ServiceManager, DatabaseAdapter, asMilli } from '../src';

/**
 * Issue #67: money moved from a credit card into an on-budget cash-like
 * account (PayPal) is a cash advance. YNAB ("Credit Card Cash Advances"): it
 * raises Ready to Assign ("Inflow from Debt Account") and leaves the CC
 * Payment category alone, so the new debt is uncovered until assigned.
 */
async function setup(mode: 'cumulative' | 'monthly') {
  const adapter = await NodeSqlJsAdapter.create();
  const sm = new ServiceManager();
  await sm.initialize(adapter as DatabaseAdapter);
  const s = sm.getServices();
  const budgetId = await s.budgets.createBudget({
    name: 'Issue67',
    display_currency: 'EUR',
    badge_icon: 'dollar',
    number_format: '123,456.78',
    create_default_categories: true,
  });
  if (mode === 'monthly') s.budgets.updateRtaMode(budgetId, 'monthly');
  const cats = s.categories.getAllCategories(budgetId);
  const incomeId = cats.find((c: { Name: string }) => c.Name === 'Income')!.ID;
  const transfersId = cats.find((c: { Name: string }) => c.Name === 'Transfers')!.ID;
  const group = s.categories.addCategoryGroup('Spending', budgetId);
  const shopping = s.categories.addCategory(group, budgetId, 'Shopping');
  const checking = await s.accounts.createAccount(
    'Checking',
    budgetId,
    'checking',
    'EUR',
    asMilli(0)
  );
  const paypal = await s.accounts.createAccount('PayPal', budgetId, 'checking', 'EUR', asMilli(0));
  const card = await s.accounts.createAccount('Card', budgetId, 'credit', 'EUR', asMilli(0));
  const ccMeta = JSON.parse((s.accounts.getAccount(card.ID).Metadata as string) || '{}');
  const ccPayCat = ccMeta.cc_payment_category_id as number;
  await s.transactions.addTransaction(
    asMilli(1000),
    asMilli(0),
    checking.ID,
    incomeId,
    budgetId,
    '2024-01-05',
    'pay'
  );
  return { s, budgetId, transfersId, shopping, checking, paypal, card, ccPayCat };
}

function snapshot(ctx: Awaited<ReturnType<typeof setup>>) {
  const { s, budgetId, shopping, ccPayCat, checking, paypal, card } = ctx;
  const rows = s.monthlyBudgets.getMonthlyBudget('2024-01', budgetId);
  const av = (id: number) =>
    rows.find((r: { CategoryID: number }) => r.CategoryID === id)?.Available ?? 0;
  const bal = (id: number) => s.accounts.getAccount(id).BalanceNative as number;
  return {
    rta: s.monthlyBudgets.getReadyToAssign(budgetId, '2024-01'),
    shopping: av(shopping),
    ccPayment: av(ccPayCat),
    balances: [bal(checking.ID), bal(paypal.ID), bal(card.ID)],
  };
}

async function cashAdvance(ctx: Awaited<ReturnType<typeof setup>>) {
  const { s, budgetId, transfersId, paypal, card } = ctx;
  await s.transactions.addTransaction(
    asMilli(0),
    asMilli(100),
    card.ID,
    transfersId,
    budgetId,
    '2024-01-10',
    'to paypal',
    'xfer-67'
  );
  await s.transactions.addTransaction(
    asMilli(100),
    asMilli(0),
    paypal.ID,
    transfersId,
    budgetId,
    '2024-01-10',
    'from card',
    'xfer-67'
  );
}

for (const mode of ['cumulative', 'monthly'] as const) {
  describe(`issue #67 (${mode})`, () => {
    it('card -> PayPal cash advance, PayPal purchase, then the card payment is assigned', async () => {
      const ctx = await setup(mode);
      const { s, budgetId, shopping, paypal, ccPayCat } = ctx;
      await cashAdvance(ctx);
      let snap = snapshot(ctx);
      expect(snap.balances).toEqual([1000, 100, -100]);
      expect(snap.rta).toBe(1100);
      expect(snap.ccPayment).toBe(0);
      expect(s.monthlyBudgets.getReadyToAssignBreakdown(budgetId, '2024-01').debtInflows).toBe(100);

      await s.transactions.addTransaction(
        asMilli(0),
        asMilli(100),
        paypal.ID,
        shopping,
        budgetId,
        '2024-01-11',
        'shop'
      );
      s.monthlyBudgets.upsertMonthlyAssignment(shopping, asMilli(100), '2024-01', budgetId);
      snap = snapshot(ctx);
      expect(snap.rta).toBe(1000);
      expect(snap.shopping).toBe(0);
      expect(snap.ccPayment).toBe(0);

      s.monthlyBudgets.upsertMonthlyAssignment(ccPayCat, asMilli(100), '2024-01', budgetId);
      snap = snapshot(ctx);
      expect(snap.rta).toBe(900);
      expect(snap.ccPayment).toBe(100);
    });

    it('paying the card off from checking keeps envelopes equal to cash', async () => {
      const ctx = await setup(mode);
      const { s, budgetId, transfersId, shopping, paypal, card, checking } = ctx;
      await cashAdvance(ctx);
      await s.transactions.addTransaction(
        asMilli(0),
        asMilli(100),
        paypal.ID,
        shopping,
        budgetId,
        '2024-01-11',
        'shop'
      );
      s.monthlyBudgets.upsertMonthlyAssignment(shopping, asMilli(100), '2024-01', budgetId);
      await s.transactions.addTransaction(
        asMilli(0),
        asMilli(100),
        checking.ID,
        transfersId,
        budgetId,
        '2024-01-20',
        'pay card',
        'pay-67'
      );
      await s.transactions.addTransaction(
        asMilli(100),
        asMilli(0),
        card.ID,
        transfersId,
        budgetId,
        '2024-01-20',
        'pay card',
        'pay-67'
      );
      const snap = snapshot(ctx);
      // cash is now 900 (checking 900, paypal 0), card 0: envelopes total 900
      expect(snap.balances).toEqual([900, 0, 0]);
      expect(snap.rta + snap.shopping + snap.ccPayment).toBe(900);
    });

    it('control: same purchase directly on the card', async () => {
      const ctx = await setup(mode);
      const { s, budgetId, shopping, card } = ctx;
      await s.transactions.addTransaction(
        asMilli(0),
        asMilli(100),
        card.ID,
        shopping,
        budgetId,
        '2024-01-11',
        'shop'
      );
      s.monthlyBudgets.upsertMonthlyAssignment(shopping, asMilli(100), '2024-01', budgetId);
      const snap = snapshot(ctx);
      expect(snap.rta).toBe(900);
      expect(snap.shopping).toBe(0);
      expect(snap.ccPayment).toBe(100);
    });
  });
}
