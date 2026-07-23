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

describe('CurrencyService custom date-range rates', () => {
  it('derives the reverse direction automatically (EUR→RON answers RON→EUR)', async () => {
    const adapter = await NodeSqlJsAdapter.create();
    const sm = new ServiceManager();
    await sm.initialize(adapter as DatabaseAdapter);
    const { budgets, currency } = sm.getServices();

    const bId = await budgets.createBudget({
      name: 'CR',
      display_currency: 'RON',
      badge_icon: 'dollar',
      number_format: '123,456.78',
      create_default_categories: true,
    });

    await currency.addCustomRate('EUR', 'RON', 5.2374, '2026-07-01', '2026-07-31', bId);

    // Direct direction.
    expect(currency.getCustomRate('EUR', 'RON', '2026-07-06', bId)).toBeCloseTo(5.2374, 6);
    // Reverse direction is derived — users never need to enter it.
    expect(currency.getCustomRate('RON', 'EUR', '2026-07-06', bId)).toBeCloseTo(1 / 5.2374, 6);
    // Outside the date range: no custom rate either way.
    expect(currency.getCustomRate('RON', 'EUR', '2026-08-02', bId)).toBeNull();

    // The full resolution chain (what transaction conversion uses) agrees.
    const resolved = await currency.resolveRate('RON', 'EUR', '2026-07-06', '2026-07', bId);
    expect(resolved).toBeCloseTo(1 / 5.2374, 6);
  });
});

describe('CurrencyService addCustomRate alsoReverse', () => {
  it('stores both directions as explicit rows when requested', async () => {
    const adapter = await NodeSqlJsAdapter.create();
    const sm = new ServiceManager();
    await sm.initialize(adapter as DatabaseAdapter);
    const { budgets, currency } = sm.getServices();

    const bId = await budgets.createBudget({
      name: 'CR2',
      display_currency: 'RON',
      badge_icon: 'dollar',
      number_format: '123,456.78',
      create_default_categories: true,
    });

    const result = await currency.addCustomRate(
      'EUR',
      'RON',
      5.2374,
      '2026-07-01',
      null,
      bId,
      true
    );
    expect(result.reverseId).not.toBeNull();

    const rows = currency.getCustomRatesForBudget(bId);
    expect(rows).toHaveLength(2);
    const reverse = rows.find((row) => row.FromCurrency === 'RON');
    expect(reverse?.ToCurrency).toBe('EUR');
    expect(reverse?.Rate).toBeCloseTo(1 / 5.2374, 8);
  });
});
