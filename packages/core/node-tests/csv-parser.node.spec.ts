import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { CurrencyParser } from '../src';
import { parseDelimitedText } from '../src/services/import/parsing.js';

const FIXTURE_DIR = path.join(__dirname, 'test-data', 'import-fixtures');

function loadFixture(name: string): string {
  return readFileSync(path.join(FIXTURE_DIR, name), 'utf8');
}

describe('German bank CSV (Sparkasse-style export)', () => {
  const currencyParser = new CurrencyParser();
  // Format string that matches what the UI exposes for German banks:
  // dot thousands, comma decimal (e.g. "1.234,56").
  const EUROPEAN_FORMAT = '123.456,78';
  // 4 metadata rows precede the header. The blank separator line is filtered
  // out by parseDelimitedText before the skip count is applied, so 4 — not 5.
  const SKIP_ROWS = 4;

  it('parses the fixture with semicolon delimiter and metadata skipped', () => {
    const csv = loadFixture('sample-german-bank.csv');
    const { headers, rows } = parseDelimitedText(csv, SKIP_ROWS);

    expect(headers).toContain('Buchungstag');
    expect(headers).toContain('Betrag');
    expect(headers).toContain('Verwendungszweck');
    expect(rows).toHaveLength(19);
    expect(rows[0].Buchungstag).toBe('01.03.2024');
    expect(rows[0].Betrag).toBe('-1.250,00');
  });

  it('parses German-formatted amounts correctly when European format is selected', () => {
    const csv = loadFixture('sample-german-bank.csv');
    const { rows } = parseDelimitedText(csv, SKIP_ROWS);

    const amounts = rows.map((r) =>
      currencyParser.parseYNABAmountAdvanced(r.Betrag, EUROPEAN_FORMAT)
    );

    // Spot-check representative rows: small cents, thousands separator, inflow.
    expect(amounts[0]).toBeCloseTo(-1250.0, 2); // "-1.250,00" rent
    expect(amounts[1]).toBeCloseTo(-42.17, 2); // "-42,17" REWE
    expect(amounts[2]).toBeCloseTo(-3.8, 2); // "-3,80" bakery
    expect(amounts[3]).toBeCloseTo(2847.55, 2); // "2.847,55" salary
    expect(amounts[8]).toBeCloseTo(1024.73, 2); // "1.024,73" tax refund
    expect(amounts[14]).toBeCloseTo(-1.99, 2); // "-1,99" Amazon

    // No row should be off by orders of magnitude (the Julia bug).
    for (const a of amounts) {
      expect(Math.abs(a)).toBeLessThan(10_000);
    }

    // Net change matches the difference between opening (closing - net = 0)
    // and the actual closing balance line in the fixture (3.247,82). We
    // don't have the opening balance in the file, so just sanity-check the
    // sum is in the right ballpark — a few thousand EUR, not millions.
    const net = amounts.reduce((s, a) => s + a, 0);
    expect(net).toBeGreaterThan(-2000);
    expect(net).toBeLessThan(3000);
  });

  it('reproduces the customer bug when US format is selected (regression guard)', () => {
    // This documents what Julia hit: defaults of "1,234.56" (US) treat the
    // dot in "1.250,00" as the decimal separator, so the parser reads it as
    // 1.250 and then chokes on the trailing ",00" or strips it. The point of
    // this test is to make sure that *with the wrong preset* we get garbage,
    // so that whenever we wire up auto-detect we can flip this to the
    // correct expected values.
    const csv = loadFixture('sample-german-bank.csv');
    const { rows } = parseDelimitedText(csv, SKIP_ROWS);
    const US_FORMAT = '123,456.78';

    const rent = currencyParser.parseYNABAmountAdvanced(rows[0].Betrag, US_FORMAT);
    const salary = currencyParser.parseYNABAmountAdvanced(rows[3].Betrag, US_FORMAT);

    // With the wrong preset, the rent amount is NOT -1250.00. The exact
    // wrong value depends on the parser internals; what matters is that it
    // diverges from the truth by a large factor.
    expect(Math.abs(rent + 1250)).toBeGreaterThan(1);
    expect(Math.abs(salary - 2847.55)).toBeGreaterThan(1);
  });
});
