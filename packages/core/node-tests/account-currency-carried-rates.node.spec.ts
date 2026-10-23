import { describe, expect, it } from 'vitest';
import { NodeSqlJsAdapter, ServiceManager } from '../src';
import { getLocalDateString } from '../src/utils/date';

async function setup() {
  const adapter = await NodeSqlJsAdapter.create();
  const manager = new ServiceManager();
  await manager.initialize(adapter);
  const services = manager.getServices();
  const budgetId = await services.budgets.createBudget({
    name: 'Carried rates',
    display_currency: 'USD',
    badge_icon: 'dollar',
    number_format: '123,456.78',
    create_default_categories: true,
  });
  const today = getLocalDateString();
  await services.currency.saveRate('USD', 'EUR', 0.5, today, budgetId);
  await services.currency.saveRate('EUR', 'USD', 2, today, budgetId);
  const account = await services.accounts.createAccount(
    'Cash',
    budgetId,
    'checking',
    'USD',
    10_000
  );
  return { services, budgetId, account, today };
}

describe('account currency change with carried rates', () => {
  it('prepares every rate the change reads, and nothing when the currency stays', async () => {
    const { services, account, today } = await setup();
    expect(await services.accounts.prepareCurrencyChange(account.ID, 'USD')).toBeNull();
    expect(await services.accounts.prepareCurrencyChange(account.ID, 'EUR')).toEqual([
      ['USD', 'EUR', today, 0.5],
      ['EUR', 'USD', today, 2],
    ]);
    expect(await services.accounts.prepareCurrencyChange(account.ID, 'EUR', 'reinterpret')).toEqual(
      [['EUR', 'USD', today, 2]]
    );
  });

  it('converts with the carried rates, not the local cache', async () => {
    const { services, account, today } = await setup();
    await services.accounts.updateAccount(
      account.ID,
      account.Name,
      account.Type,
      'EUR',
      undefined,
      undefined,
      'convert',
      [['USD', 'EUR', today, 0.25], ['EUR', 'USD', today, 4], ['bad']]
    );
    const updated = services.accounts.getAccount(account.ID);
    expect(updated.BalanceNative).toBe(2_500);
    expect(updated.BalanceConverted).toBe(10_000);
  });
});
