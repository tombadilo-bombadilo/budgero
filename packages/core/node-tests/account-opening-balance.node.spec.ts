import { describe, it, expect } from 'vitest';
import { NodeSqlJsAdapter, ServiceManager, DatabaseAdapter, fromDecimal } from '../src';

/**
 * Opening-balance behavior at account creation, across account categories.
 *
 * Regression: liability accounts (credit cards especially) created with a
 * plain signed balance — the onboarding path, which sends no debt_total /
 * paid_so_far metadata — used to silently open at 0 because the liability
 * branch only honored debt metadata. A negative CC balance must open the
 * account in debt.
 */
describe('AccountService.createAccount — opening balance', () => {
  async function setup() {
    const adapter = await NodeSqlJsAdapter.create();
    const sm = new ServiceManager();
    await sm.initialize(adapter as DatabaseAdapter);
    const services = sm.getServices();
    const budgetId = await services.budgets.createBudget({
      name: 'OpeningBalance',
      display_currency: 'USD',
      badge_icon: 'dollar',
      number_format: '123,456.78',
      create_default_categories: false,
    });
    return { services, budgetId };
  }

  it('opens a credit card in debt from a negative plain balance (onboarding path)', async () => {
    const { services, budgetId } = await setup();
    const acc = await services.accounts.createAccount(
      'Chase',
      budgetId,
      'Credit',
      'USD',
      fromDecimal(-500), // user owes $500, no debt metadata
      {},
      true
    );

    const balances = services.accounts.listAccounts(budgetId);
    const chase = balances.find((a) => a.ID === acc.ID)!;
    expect(chase.Balance).toBe(fromDecimal(-500));
  });

  it('opens a credit card with a positive credit balance from a positive plain balance', async () => {
    const { services, budgetId } = await setup();
    const acc = await services.accounts.createAccount(
      'Overpaid',
      budgetId,
      'Credit',
      'USD',
      fromDecimal(120),
      {},
      true
    );

    const chase = services.accounts.listAccounts(budgetId).find((a) => a.ID === acc.ID)!;
    expect(chase.Balance).toBe(fromDecimal(120));
  });

  it('still opens a standard checking account from a positive balance', async () => {
    const { services, budgetId } = await setup();
    const acc = await services.accounts.createAccount(
      'Everyday',
      budgetId,
      'Checking',
      'USD',
      fromDecimal(1000),
      {},
      true
    );

    const everyday = services.accounts.listAccounts(budgetId).find((a) => a.ID === acc.ID)!;
    expect(everyday.Balance).toBe(fromDecimal(1000));
  });

  it('does not double-count when debt_total metadata is supplied (dialog path)', async () => {
    const { services, budgetId } = await setup();
    // Dialog-style loan: debt via metadata (in milliunits, as the dialog
    // sends it), plain balance is the "paid so far".
    const acc = await services.accounts.createAccount(
      'Car Loan',
      budgetId,
      'Loan',
      'USD',
      fromDecimal(2000), // paid so far
      { liability: true, debt_total: fromDecimal(10_000), paid_so_far: fromDecimal(2000) },
      true
    );

    // remaining debt = -(10000 - 2000) = -8000, driven by metadata only.
    const loan = services.accounts.listAccounts(budgetId).find((a) => a.ID === acc.ID)!;
    expect(loan.Balance).toBe(fromDecimal(-8000));
  });

  it('leaves a liability at zero when no balance and no debt metadata are given', async () => {
    const { services, budgetId } = await setup();
    const acc = await services.accounts.createAccount(
      'Empty CC',
      budgetId,
      'Credit',
      'USD',
      0,
      {},
      true
    );
    const cc = services.accounts.listAccounts(budgetId).find((a) => a.ID === acc.ID)!;
    expect(cc.Balance).toBe(0);
  });
});
