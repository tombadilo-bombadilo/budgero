import { describe, it, expect } from 'vitest';
import { NodeSqlJsAdapter, ServiceManager, DatabaseAdapter } from '../src';

async function setup() {
  const adapter = await NodeSqlJsAdapter.create();
  const sm = new ServiceManager();
  await sm.initialize(adapter as DatabaseAdapter);
  const services = sm.getServices();
  const budgetId = await services.budgets.createBudget({
    name: 'Ordering',
    display_currency: 'USD',
    badge_icon: 'dollar',
    number_format: '123,456.78',
    create_default_categories: true,
  });
  return { services, budgetId };
}

describe('Account ordering', () => {
  it('assigns increasing Position on create and lists in Position order', async () => {
    const { services, budgetId } = await setup();
    const a = await services.accounts.createAccount('Alpha', budgetId, 'checking', 'USD', 0);
    const b = await services.accounts.createAccount('Bravo', budgetId, 'savings', 'USD', 0);
    const c = await services.accounts.createAccount('Charlie', budgetId, 'cash', 'USD', 0);

    const listed = services.accounts.listAccounts(budgetId);
    expect(listed.map((acc) => acc.ID)).toEqual([a.ID, b.ID, c.ID]);
    expect(listed.map((acc) => acc.Position)).toEqual([0, 1, 2]);
  });

  it('reorders accounts by assigning positions in the given order', async () => {
    const { services, budgetId } = await setup();
    const a = await services.accounts.createAccount('Alpha', budgetId, 'checking', 'USD', 0);
    const b = await services.accounts.createAccount('Bravo', budgetId, 'savings', 'USD', 0);
    const c = await services.accounts.createAccount('Charlie', budgetId, 'cash', 'USD', 0);

    services.accounts.reorderAccounts(budgetId, [c.ID, a.ID, b.ID]);

    const listed = services.accounts.listAccounts(budgetId);
    expect(listed.map((acc) => acc.ID)).toEqual([c.ID, a.ID, b.ID]);
  });

  it('keeps on-budget and off-budget orderings independent after partitioning', async () => {
    const { services, budgetId } = await setup();
    // Interleave on/off-budget accounts at creation time.
    const checking = await services.accounts.createAccount(
      'Checking',
      budgetId,
      'checking',
      'USD',
      0
    ); // on
    const asset = await services.accounts.createAccount('Asset', budgetId, 'other asset', 'USD', 0); // off
    const savings = await services.accounts.createAccount('Savings', budgetId, 'savings', 'USD', 0); // on
    const realEstate = await services.accounts.createAccount(
      'House',
      budgetId,
      'real estate',
      'USD',
      0
    ); // off

    // Reorder only the on-budget group: Savings before Checking.
    services.accounts.reorderAccounts(budgetId, [savings.ID, checking.ID]);

    const listed = services.accounts.listAccounts(budgetId);
    const onBudget = listed.filter((acc) => acc.OnBudget).map((acc) => acc.ID);
    const offBudget = listed.filter((acc) => !acc.OnBudget).map((acc) => acc.ID);

    // On-budget reflects the new order; off-budget is untouched.
    expect(onBudget).toEqual([savings.ID, checking.ID]);
    expect(offBudget).toEqual([asset.ID, realEstate.ID]);
  });

  it('places newly created accounts at the end of the order', async () => {
    const { services, budgetId } = await setup();
    const a = await services.accounts.createAccount('Alpha', budgetId, 'checking', 'USD', 0);
    const b = await services.accounts.createAccount('Bravo', budgetId, 'savings', 'USD', 0);
    services.accounts.reorderAccounts(budgetId, [b.ID, a.ID]);

    const c = await services.accounts.createAccount('Charlie', budgetId, 'cash', 'USD', 0);
    const listed = services.accounts.listAccounts(budgetId);
    expect(listed[listed.length - 1].ID).toBe(c.ID);
  });
});
