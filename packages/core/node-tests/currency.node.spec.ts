import { describe, it, expect, vi } from 'vitest';
import { NodeSqlJsAdapter, ServiceManager, DatabaseAdapter } from '../src';

describe('CurrencyService', () => {
  it('uses reciprocal local and manual rates; convertAmount falls back to manual', async () => {
    const adapter = await NodeSqlJsAdapter.create();
    const sm = new ServiceManager();
    await sm.initialize(adapter as DatabaseAdapter);
    const { budgets, currency } = sm.getServices();

    const bId = await budgets.createBudget({
      name: 'C',
      display_currency: 'USD',
      badge_icon: 'dollar',
      number_format: '123,456.78',
      create_default_categories: true,
    });

    const month = '2024-01';

    // Save direct rate USD->EUR and test reciprocal via getLocalRate
    await currency.saveRate('USD', 'EUR', 0.8, month, bId);
    const eurusd = await currency.getLocalRate('EUR', 'USD', month, bId);
    expect(eurusd).toBeCloseTo(1 / 0.8, 6);

    // Manual reciprocal retrieval
    await currency.saveManualRate('EUR', 'USD', 1.5, bId);
    const usdeurManual = await currency.getManualRate('USD', 'EUR', bId);
    expect(usdeurManual).toBeCloseTo(1 / 1.5, 6);

    // convertAmount prefers getOrFetchRate; mock it to return null so manual is used
    const spy = vi.spyOn(currency, 'getOrFetchRate').mockResolvedValue(null);
    const conv = await currency.convertAmount(10, 'EUR', 'USD', month, bId);
    expect(conv).toBeCloseTo(15, 6);
    spy.mockRestore();
  });
});
