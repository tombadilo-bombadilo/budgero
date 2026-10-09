import { describe, expect, it } from 'vitest';
import { buildCurrencyLocalizer } from '@shared/store/useUiStore';
import { currencyDisplayFor, formatOptions } from './number-format';

describe('currencyDisplayFor', () => {
  it('shows Hungarian forints as Ft and leaves other currencies alone', () => {
    expect(currencyDisplayFor('HUF')).toBe('narrowSymbol');
    expect(currencyDisplayFor('USD')).toBe('symbol');
    expect(currencyDisplayFor(undefined)).toBe('symbol');
  });

  it('formats HUF with Ft in every budget number format', () => {
    for (const option of formatOptions) {
      const formatted = buildCurrencyLocalizer('HUF', option.key)!.format(1096.56);
      expect(formatted).toContain('Ft');
      expect(formatted).not.toContain('HUF');
    }
    expect(buildCurrencyLocalizer('EUR', '$1,096.56')!.format(1)).toBe('€1.00');
  });
});
