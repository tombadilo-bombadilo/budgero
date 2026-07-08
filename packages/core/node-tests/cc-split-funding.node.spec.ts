import { describe, it, expect } from 'vitest';
import { NodeSqlJsAdapter, ServiceManager, DatabaseAdapter } from '../src';

/**
 * Regression: CC spending recorded as a SPLIT transaction must fund the
 * CC Payment category exactly like non-split CC spending does.
 * Previously getCCSpendingByCategoryAndAccount only read the transactions
 * table, so split CC purchases showed "Funded from spending: 0".
 */
describe('CC Payment funding with split transactions', () => {
  async function setup() {
    const adapter = await NodeSqlJsAdapter.create();
    const sm = new ServiceManager();
    await sm.initialize(adapter as DatabaseAdapter);
    const services = sm.getServices();
    const budgetId = await services.budgets.createBudget({
      name: 'CC Splits',
      display_currency: 'USD',
      badge_icon: 'dollar',
      number_format: '123,456.78',
      create_default_categories: false,
    });
    return { services, budgetId };
  }

  it('funds the CC Payment category from budgeted split spending on the card', async () => {
    const { services, budgetId } = await setup();
    const { accounts, categories, monthlyBudgets, transactions, splits } = services;

    const cc = await accounts.createAccount('Visa', budgetId, 'credit', 'USD', 0);
    const ccMeta = JSON.parse((accounts.getAccount(cc.ID).Metadata as string) || '{}');
    const ccPaymentCategoryId = ccMeta.cc_payment_category_id as number;
    expect(ccPaymentCategoryId).toBeTruthy();

    const groupId = categories.addCategoryGroup('TEST', budgetId);
    const cat1 = categories.addCategory(groupId, budgetId, 'test 1');
    const cat2 = categories.addCategory(groupId, budgetId, 'test 2');

    const month = '2026-06';
    monthlyBudgets.upsertMonthlyAssignment(cat1, 5, month, budgetId);
    monthlyBudgets.upsertMonthlyAssignment(cat2, 5, month, budgetId);

    // One $10 split purchase on the credit card: $5 to each category
    const parentId = await transactions.addTransaction(
      0,
      10,
      cc.ID,
      cat1,
      budgetId,
      '2026-06-10',
      'Split purchase'
    );
    await splits.upsertSplits(parentId, [
      { CategoryID: cat1, Memo: '', Inflow: 0, Outflow: 5, OrderIndex: 0 },
      { CategoryID: cat2, Memo: '', Inflow: 0, Outflow: 5, OrderIndex: 1 },
    ]);

    const rows = monthlyBudgets.getMonthlyBudget(month, budgetId);
    const ccRow = rows.find((r) => r.CategoryID === ccPaymentCategoryId);
    expect(ccRow).toBeTruthy();

    // Both categories were fully budgeted, so the full $10 moves to the CC envelope
    expect(ccRow?.totalFunded).toBeCloseTo(10, 2);
    expect(ccRow?.Available).toBeCloseTo(10, 2);

    // Funding breakdown attributes both split lines
    const breakdownCategories = (ccRow?.fundingBreakdown || []).map((f) => f.categoryId).sort();
    expect(breakdownCategories).toEqual([cat1, cat2].sort());
  });

  it('matches non-split behavior: only budgeted spending funds the envelope', async () => {
    const { services, budgetId } = await setup();
    const { accounts, categories, monthlyBudgets, transactions, splits } = services;

    const cc = await accounts.createAccount('Amex', budgetId, 'credit', 'USD', 0);
    const ccMeta = JSON.parse((accounts.getAccount(cc.ID).Metadata as string) || '{}');
    const ccPaymentCategoryId = ccMeta.cc_payment_category_id as number;

    const groupId = categories.addCategoryGroup('Stuff', budgetId);
    const funded = categories.addCategory(groupId, budgetId, 'Funded');
    const unfunded = categories.addCategory(groupId, budgetId, 'Unfunded');

    const month = '2026-06';
    // Only one of the two split targets has budget behind it
    monthlyBudgets.upsertMonthlyAssignment(funded, 20, month, budgetId);

    const parentId = await transactions.addTransaction(
      0,
      30,
      cc.ID,
      funded,
      budgetId,
      '2026-06-11',
      'Mixed split'
    );
    await splits.upsertSplits(parentId, [
      { CategoryID: funded, Memo: '', Inflow: 0, Outflow: 20, OrderIndex: 0 },
      { CategoryID: unfunded, Memo: '', Inflow: 0, Outflow: 10, OrderIndex: 1 },
    ]);

    const rows = monthlyBudgets.getMonthlyBudget(month, budgetId);
    const ccRow = rows.find((r) => r.CategoryID === ccPaymentCategoryId);

    // $20 budgeted spending funds the envelope; the $10 unbudgeted line is CC debt
    expect(ccRow?.totalFunded).toBeCloseTo(20, 2);
    expect(ccRow?.Available).toBeCloseTo(20, 2);
  });
});
