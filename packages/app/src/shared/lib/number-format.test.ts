import { describe, expect, it } from 'vitest';
import { buildCurrencyLocalizer } from '@shared/store/useUiStore';
import { createMaskedNumberFormatter } from '@shared/lib/privacy/mask-numbers';
import {
  evaluateTextToNumber,
  formatNumberForInput,
  getSeparators,
} from '@shared/ui/calculator-cell/calculator-utils';
import {
  currencyDisplayFor,
  formatOptions,
  numberFormatLike,
  separatorsOf,
  withEditPrecision,
} from './number-format';

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

describe('space thousands, dot decimals format', () => {
  const KEY = '1 096.56 $US';
  const NNBSP = '\u202F';
  // fr-CH puts a no-break space before the symbol.
  const NBSP = '\u00A0';

  it('formats with a narrow no-break space and a dot', () => {
    const localizer = buildCurrencyLocalizer('EUR', KEY)!;
    expect(localizer.format(1000.35)).toBe(`1${NNBSP}000.35${NBSP}€`);
    expect(localizer.format(-1234567.5)).toBe(`-1${NNBSP}234${NNBSP}567.50${NBSP}€`);
    expect(localizer.format(12.3)).toBe(`12.30${NBSP}€`);
    const parts = localizer.formatToParts(1096.56);
    expect(parts.find((p) => p.type === 'group')?.value).toBe(NNBSP);
    expect(parts.find((p) => p.type === 'decimal')?.value).toBe('.');
  });

  it('keeps the separators in derived, edit, masked and crypto formatters', () => {
    const localizer = buildCurrencyLocalizer('USD', KEY)!;
    expect(withEditPrecision(localizer).format(1234.567)).toBe(`1${NNBSP}234.567${NBSP}$US`);
    expect(numberFormatLike(localizer, { maximumFractionDigits: 2 }).format(12345.6)).toBe(
      `12${NNBSP}345.6`
    );
    expect(
      numberFormatLike(localizer, { notation: 'compact', maximumFractionDigits: 1 }).format(1234567)
    ).not.toContain(',');
    const masked = createMaskedNumberFormatter(localizer, false);
    expect(separatorsOf(masked)).toEqual({ group: NNBSP, decimal: '.' });
    const btc = buildCurrencyLocalizer('BTC', KEY)!;
    expect(separatorsOf(btc)).toEqual({ group: NNBSP, decimal: '.' });
    expect(btc.format(12_345_678.9)).not.toMatch(/[',]/);
  });

  it('leaves the existing formats untouched', () => {
    expect(buildCurrencyLocalizer('EUR', '1 096,56 $US')!.format(1000.35)).toBe(
      new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(1000.35)
    );
    expect(buildCurrencyLocalizer('USD', '$1,096.56')!.format(1000.35)).toBe('$1,000.35');
    for (const option of formatOptions) {
      if (option.key !== KEY) expect(option.settings.separators).toBeUndefined();
    }
  });

  it('parses what it displays in amount fields', () => {
    const localizer = buildCurrencyLocalizer('EUR', KEY)!;
    const { groupSep, decimalSep } = getSeparators(localizer);
    expect(groupSep).toBe(NNBSP);
    expect(decimalSep).toBe('.');
    for (const typed of ['1 000.35', `1${NNBSP}000.35`, '1\u00A0000.35', '1000.35']) {
      expect(evaluateTextToNumber(typed, groupSep, decimalSep)).toBe(1000.35);
    }
    expect(evaluateTextToNumber('1 000.35 + 1 000', groupSep, decimalSep)).toBe(2000.35);
    expect(evaluateTextToNumber('-1 000.35', groupSep, decimalSep)).toBe(-1000.35);
    expect(formatNumberForInput(1000.35, localizer, groupSep, decimalSep)).toBe(`1${NNBSP}000.35`);
  });
});
