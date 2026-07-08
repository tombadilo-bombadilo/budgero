import { describe, expect, it } from 'vitest';
import { formatMaskedAmount, maskFormattedIfEnabled, maskNumericDigits } from './mask-numbers';

describe('mask-numbers', () => {
  it('masks digits and removes separators inside masked numeric spans', () => {
    expect(maskNumericDigits('$1,234.56')).toBe('$******');
  });

  it('preserves non-digit characters including sign', () => {
    expect(maskNumericDigits('-€1,200.05')).toBe('-€******');
  });

  it('leaves strings without digits unchanged', () => {
    expect(maskNumericDigits('No amount')).toBe('No amount');
  });

  it('conditionally masks formatted content', () => {
    expect(maskFormattedIfEnabled('$123.45', true)).toBe('$*****');
    expect(maskFormattedIfEnabled('$123.45', false)).toBe('$123.45');
  });

  it('masks formatter output when enabled', () => {
    const formatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
    expect(formatMaskedAmount(formatter, 1234.56, true)).toBe('$******');
    expect(formatMaskedAmount(formatter, 1234.56, false)).toBe('$1,234.56');
  });

  it('normalizes negative zero formatter output', () => {
    const formatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
    expect(formatMaskedAmount(formatter, -0, false)).toBe('$0.00');
  });

  it('normalizes tiny negative residuals that round to zero', () => {
    const formatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
    expect(formatMaskedAmount(formatter, -0.004, false)).toBe('$0.00');
  });
});
