import { describe, it, expect } from 'vitest';
import { CurrencyParser } from '../src';

describe('CurrencyParser', () => {
  const parser = new CurrencyParser();

  it('removes various currency symbols', () => {
    const samples = [
      'RSD 1.234,56',
      'USD 1,234.56',
      '€1.234,56',
      '$1,234.56',
      'Дин. 1.234,56',
      'Din. 1,234.56',
      '₹ 12,345.67',
      "1'234.56",
    ];

    for (const s of samples) {
      const cleaned = parser.removeCurrencySymbols(s);
      expect(cleaned).not.toMatch(/[€$₹]|RSD|USD|Дин\.|Din\./);
      expect(typeof cleaned).toBe('string');
      expect(cleaned.length).toBeGreaterThan(0);
    }
  });

  it('parses amounts across formats (explicit)', () => {
    expect(parser.parseYNABAmountAdvanced('1,234.56', '123,456.78')).toBeCloseTo(1234.56, 6);
    expect(parser.parseYNABAmountAdvanced('1.234,56', '123.456,78')).toBeCloseTo(1234.56, 6);
    expect(parser.parseYNABAmountAdvanced("1'234.56", "123'456.78")).toBeCloseTo(1234.56, 6);
    expect(parser.parseYNABAmountAdvanced('1 234.56', '123 456.78')).toBeCloseTo(1234.56, 6);
    expect(parser.parseYNABAmountAdvanced('1 234,56', '123 456,78')).toBeCloseTo(1234.56, 6);
    expect(parser.parseYNABAmountAdvanced('1,23,456.78', '1,23,456.78')).toBeCloseTo(123456.78, 6);
  });

  it('auto-detects format when unknown', () => {
    // Dot thousands, no decimals
    expect(parser.parseYNABAmountAdvanced('1.234.567', '')).toBe(1234567);
    // Comma thousands, dot decimal
    expect(parser.parseYNABAmountAdvanced('12,345.67', '')).toBeCloseTo(12345.67, 6);
    // Comma decimal only
    expect(parser.parseYNABAmountAdvanced('123,45', '')).toBeCloseTo(123.45, 6);
  });

  it('handles negative amounts', () => {
    expect(parser.parseYNABAmountAdvanced('-1,234.56', '123,456.78')).toBeCloseTo(-1234.56, 6);
    expect(parser.parseYNABAmountAdvanced('-€1.234,56', '123.456,78')).toBeCloseTo(-1234.56, 6);
  });
});
