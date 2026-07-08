import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  extractTablesFromPageItems,
  mergeExtractedTables,
  type PDFTextItem,
} from '../src/services/import/pdf-table.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Fixture format mirrors what pdfjs-dist's getTextContent gives us after the
 * per-item normalization in `extractPageTextItems`. Captured once via
 * `pdf_test_data/capture-fixture.mjs` so the test suite doesn't need to
 * depend on pdfjs at runtime.
 */
interface Fixture {
  source: string;
  pages: {
    pageNumber: number;
    viewportWidth: number;
    viewportHeight: number;
    items: PDFTextItem[];
  }[];
}

function loadFixture(name: string): PDFTextItem[][] {
  const path = resolve(__dirname, '__fixtures__', name);
  const fixture = JSON.parse(readFileSync(path, 'utf-8')) as Fixture;
  return fixture.pages.map((p) => p.items);
}

/**
 * Helper: run the full extract + merge pipeline (mirrors what
 * `useImportDialogState` does) and return the combined `allRows`.
 */
function parsePdfFixture(name: string) {
  const pagesItems = loadFixture(name);
  const tables = extractTablesFromPageItems(pagesItems);
  const merged = mergeExtractedTables(tables);
  return merged;
}

/**
 * Helper: given a merged table, find the row whose first non-empty cell
 * contains a substring and return the cells of that row. Useful for finding
 * a specific transaction regardless of column alignment drift.
 */
function findRowContaining(rows: string[][], substring: string): string[] | null {
  const needle = substring.toLowerCase();
  for (const row of rows) {
    const joined = row.join(' ').toLowerCase();
    if (joined.includes(needle)) return row;
  }
  return null;
}

describe('pdf-parser CIBC Costco Mastercard statement (user_31_example_2.pdf)', () => {
  // These are the 15 charges + 1 payment transaction the user expects to see
  // from their PDF. We don't assert exact column layout (the parser can't
  // guess which columns the user will map to what) — instead we assert that
  // EVERY one of these rows is represented in the merged table with its
  // date, description keyword, and amount all present.
  const expectedCharges: { date: string; desc: string; amount: string }[] = [
    { date: 'Oct 25', desc: 'Retail and Grocery', amount: '172.54' },
    { date: 'Oct 31', desc: 'COSTCO WHOLESALE W251 CALGARY AB COSTCO', amount: '61.35' },
    { date: 'Oct 31', desc: 'WHOLESALE W251 CALGARY AB COSTCO', amount: '1.58' },
    { date: 'Oct 31', desc: 'WHOLESALE W251 CALGARY AB COSTCO GAS', amount: '20.11' },
    { date: 'Nov 05', desc: 'W251 CALGARY AB COSTCO WHOLESALE W251', amount: '193.13' },
    { date: 'Nov 05', desc: 'CALGARY AB COSTCO WHOLESALE W251', amount: '0.74' },
    { date: 'Nov 05', desc: 'CALGARY AB COSTCO GAS W251 CALGARY AB', amount: '18.17' },
    { date: 'Nov 05', desc: 'WAL-MART #3009 CALGARY AB COSTCO', amount: '64.87' },
    { date: 'Nov 11', desc: 'WHOLESALE W251 CALGARY AB COSTCO', amount: '208.81' },
    { date: 'Nov 11', desc: 'WHOLESALE W251 CALGARY AB FLA*AF6MVOL6G', amount: '1.58' },
    { date: 'Nov 13', desc: 'CALGARY AB COSTCO WHOLESALE W251', amount: '37.01' },
    { date: 'Nov 17', desc: 'CALGARY AB COSTCO WHOLESALE W251', amount: '537.12' },
    { date: 'Nov 17', desc: 'CALGARY AB COSTCO GAS W251 CALGARY AB', amount: '1.04' },
    { date: 'Nov 17', desc: 'COSTCO CANADA LIQUOR 1 CALGARY AB', amount: '14.67' },
    { date: 'Nov 17', desc: 'Retail and Grocery', amount: '10.38' },
  ];

  function loadMergedOrFail(name: string) {
    const merged = parsePdfFixture(name);
    if (!merged) throw new Error(`Fixture ${name} produced no merged table`);
    return merged;
  }

  it('extracts a non-empty merged table', () => {
    const merged = loadMergedOrFail('cibc-example-2.json');
    expect(merged.allRows.length).toBeGreaterThan(0);
  });

  it.each(expectedCharges)('includes charge: $date $desc $amount', ({ date, desc, amount }) => {
    const merged = loadMergedOrFail('cibc-example-2.json');
    const rows = merged.allRows;

    // Look for a row that contains the date, the description keyword, and
    // the amount. Use a partial description match because PDF text items
    // sometimes truncate or wrap.
    const descKeyword = desc.split(/\s+/).find((w) => w.length > 3) ?? desc;
    const matching = rows.find((row) => {
      const joined = row.join(' ');
      return joined.includes(date) && joined.includes(descKeyword) && joined.includes(amount);
    });

    if (!matching) {
      const hint = rows
        .filter((r) => r.join(' ').includes(amount) || r.join(' ').includes(date))
        .slice(0, 5)
        .map((r) => r.join(' | '))
        .join('\n');
      throw new Error(`Row for "${date} ${desc} ${amount}" not found. Candidates:\n${hint}`);
    }

    expect(matching).toBeDefined();
  });

  it('keeps Trans date and Post date in separate columns', () => {
    // CIBC statements show two dates per charge: transaction date (when
    // the card was swiped) and posting date (when it cleared). These must
    // land in distinct columns so the user can map "Date" to one of them
    // without losing the other.
    const merged = loadMergedOrFail('cibc-example-2.json');
    const rows = merged.allRows;

    // Pick a transaction with known, distinct Trans/Post dates from the
    // user's expected data: "Oct 31 / Nov 03 / ... / 61.35"
    const row = findRowContaining(rows, '61.35');
    if (!row) throw new Error('Row containing 61.35 not found');

    const transDateIdx = row.findIndex((c) => c.includes('Oct 31'));
    const postDateIdx = row.findIndex((c) => c.includes('Nov 03'));

    expect(transDateIdx).toBeGreaterThanOrEqual(0);
    expect(postDateIdx).toBeGreaterThanOrEqual(0);
    if (transDateIdx === postDateIdx) {
      throw new Error(
        `Trans date and Post date collapsed into one cell: "${row[transDateIdx]}". Full row: ${JSON.stringify(row)}`
      );
    }
    expect(transDateIdx).not.toBe(postDateIdx);
  });

  it('every amount lands in the same column across transactions', () => {
    // Regression guard: if right-aligned short amounts ("1.58", "1.04")
    // drift into a different column than longer amounts ("172.54",
    // "537.12"), this assertion catches it.
    const merged = loadMergedOrFail('cibc-example-2.json');
    const rows = merged.allRows;

    const amounts = ['172.54', '61.35', '1.58', '20.11', '193.13', '0.74', '537.12', '1.04'];
    const columnIndexByAmount = new Map<string, number>();

    for (const amount of amounts) {
      const row = findRowContaining(rows, amount);
      if (!row) throw new Error(`amount ${amount} missing from parsed rows`);
      const colIdx = row.findIndex((cell) => cell.includes(amount));
      columnIndexByAmount.set(amount, colIdx);
    }

    // All amounts should land in the same column index.
    const distinctColumns = new Set(columnIndexByAmount.values());
    if (distinctColumns.size !== 1) {
      const summary = Array.from(columnIndexByAmount.entries())
        .map(([a, c]) => `${a}→col ${c}`)
        .join(', ');
      throw new Error(`Amounts landed in ${distinctColumns.size} different columns: ${summary}`);
    }
    expect(distinctColumns.size).toBe(1);
  });
});

describe('pdf-parser Yettel statement (yettel.pdf) — regression', () => {
  function loadMergedOrFail(name: string) {
    const merged = parsePdfFixture(name);
    if (!merged) throw new Error(`Fixture ${name} produced no merged table`);
    return merged;
  }

  it('produces a merged table with transactions', () => {
    const merged = loadMergedOrFail('yettel.json');
    expect(merged.allRows.length).toBeGreaterThan(10);
  });

  it('includes a known transaction line', () => {
    const merged = loadMergedOrFail('yettel.json');
    const row = findRowContaining(merged.allRows, 'Google CLOUD');
    if (!row) throw new Error('Google CLOUD transaction missing');
    expect(row).toBeDefined();
  });
});
