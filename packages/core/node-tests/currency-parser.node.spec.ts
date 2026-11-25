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

  it.each([
    ['1\u202f234,56 €', '1 096,56 $US', 1234.56],
    ['1\u00a0234,56 €', '1 096,56 $US', 1234.56],
    ['kr 1 234,56', '1 096,56 $US', 1234.56],
    ["1'234.56", '$1,096.56', 1234.56],
    ['CHF 1’234.56', '$1,096.56', 1234.56],
    ['CHF1’234.56', '$1,096.56', 1234.56],
    ['1,234', '$1,096.56', 1234],
    ['1.234', '1.096,56 $', 1234],
    ['1,234', '1 096,56 $US', 1.234],
    ['1\u202f234.56 €', '1 096.56 $US', 1234.56],
    ['1 234.56', '1 096.56 $US', 1234.56],
    ['1 234', '1 096.56 $US', 1234],
    ['-1 234.5', '1 096.56 $US', -1234.5],
    ['KWD 1,234.567', '123,456.78', 1234.567],
    ['KWD 1.234,567', '123.456,78', 1234.567],
    ['KWD 0.001', '123,456.78', 0.001],
    ['−CHF 1’234.56', '$1,096.56', -1234.56],
    ['(kr 1 234,56)', '1 096,56 $US', -1234.56],
    ['1\u202f234,56 €-', '1 096,56 $US', -1234.56],
    ['-1.00', '$1,096.56', -1],
    ['1,234/56', '123,456/78', 1234.56],
    ['-1 234-56', '123 456-78', -1234.56],
    ['.50', '$1,096.56', 0.5],
    [',50', '1 096,56 $US', 0.5],
    ['-.50', '', -0.5],
    [',50', '', 0.5],
    ['.005', '123,456.78', 0.005],
    ['R$ 1.234,56', '1.096,56 $', 1234.56],
    ['NT$1,234.56', '$1,096.56', 1234.56],
    ['S$1,234.56', '$1,096.56', 1234.56],
    // Display preset that does not match the export falls back to auto-detection
    ['$0.00', '1.096,56 $', 0],
    ['$1,234.56', '1.096,56 $', 1234.56],
    ['-$100.00', '1.096,56 $', -100],
  ])('parses the complete amount %s using display preset %s', (amount, format, expected) => {
    expect(parser.parseYNABAmountAdvanced(amount, format)).toBe(expected);
  });

  it.each([
    'garbage',
    'CHF',
    '12oops',
    '1.25 trailing text',
    '1,234,56',
    '--12',
    'NaN',
    'Infinity',
  ])('rejects an unparseable nonempty amount %s', (amount) => {
    expect(() => parser.parseYNABAmountAdvanced(amount, '$1,096.56')).toThrow(
      /Unable to parse YNAB amount/
    );
  });

  it.each(['', ' ', '\u202f'])('treats an empty amount cell as zero: %s', (amount) => {
    expect(parser.parseYNABAmountAdvanced(amount, '$1,096.56')).toBe(0);
  });
});
