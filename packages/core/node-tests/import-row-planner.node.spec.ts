import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { detectColumnMapping, parseDelimitedText } from '../src/services/import/parsing.js';
import {
  planImportRows,
  summarizeImportPlan,
  type ImportRowParseConfig,
} from '../src/services/import/row-planner.js';
import {
  createImportNameMaps,
  resolveImportCategoryId,
} from '../src/services/import/category-resolver.js';
import type { ColumnMapping } from '../src/services/import/types.js';

const FIXTURE_DIR = path.join(__dirname, 'test-data', 'import-fixtures');

function loadRows(name: string): Record<string, string>[] {
  const text = readFileSync(path.join(FIXTURE_DIR, name), 'utf8');
  return parseDelimitedText(text).rows;
}

const US: ImportRowParseConfig = {
  thousandSeparator: ',',
  decimalSeparator: '.',
  dateFormat: 'MM/DD/YYYY',
};

const UK: ImportRowParseConfig = {
  thousandSeparator: ',',
  decimalSeparator: '.',
  dateFormat: 'DD/MM/YYYY',
};

/**
 * Regression coverage for the customer report: "I'm told all transactions were
 * uploaded, but only about 10 come into the system." The import loop used to
 * collapse every unreadable amount to 0 and skip it with no error, so rows with
 * empty / garbage amounts — or a Debit/Credit column the user never mapped —
 * vanished while the UI still reported the full row count.
 */
describe('import row planner — silent drops are now surfaced (single Amount column)', () => {
  const mapping: ColumnMapping = {
    date: 'Date',
    amount: 'Amount',
    category: 'Category',
    payee: 'Payee',
  };

  it('classifies every row of a real, messy US bank export', () => {
    const rows = loadRows('us-bank-mixed.csv');
    const plans = planImportRows(rows, mapping, US);

    // 12 data rows: 8 import, 3 have an unreadable amount, 1 has no amount.
    expect(summarizeImportPlan(plans)).toEqual({
      total: 12,
      ready: 8,
      errored: 3,
      skippedEmpty: 1,
    });
  });

  it('treats "$0.00" as a real (zero) amount instead of dropping it', () => {
    const rows = loadRows('us-bank-mixed.csv');
    const plans = planImportRows(rows, mapping, US);

    const fee = plans.find((p) => rows[p.index].Description === 'MONTHLY SERVICE FEE');
    expect(fee?.status).toBe('ready');
    expect(fee?.inflow).toBe(0);
    expect(fee?.outflow).toBe(0);
    expect(fee?.errors).toEqual([]);
  });

  it('surfaces unparseable amounts ("Pending", "N/A", "--") as errors, not silent skips', () => {
    const rows = loadRows('us-bank-mixed.csv');
    const plans = planImportRows(rows, mapping, US);

    const pending = plans.find((p) => rows[p.index].Description === 'CARD AUTHORIZATION');
    expect(pending?.status).toBe('error');
    expect(pending?.errors).toContain('Could not parse amount "Pending"');

    const reversal = plans.find((p) => rows[p.index].Description === 'REVERSAL');
    expect(reversal?.status).toBe('error');
    expect(reversal?.errors).toContain('Could not parse amount "N/A"');
  });

  it('flags an empty amount cell as a skip with a reason', () => {
    const rows = loadRows('us-bank-mixed.csv');
    const plans = planImportRows(rows, mapping, US);

    const pending = plans.find((p) => rows[p.index].Description === 'PENDING PURCHASE');
    expect(pending?.status).toBe('skipped-empty');
    expect(pending?.errors).toContain('No amount value — row will be skipped');
  });

  it('parses thousands separators inside quoted fields', () => {
    const rows = loadRows('us-bank-mixed.csv');
    const plans = planImportRows(rows, mapping, US);

    const ach = plans.find((p) => rows[p.index].Description === 'ACH PAYMENT');
    expect(ach?.status).toBe('ready');
    expect(ach?.outflow).toBe(1800000); // "1,800.00" parsed to integer milliunits
  });
});

/**
 * The most faithful reproduction of "uploaded 28, only ~10 landed": a UK-style
 * export with separate "Paid Out" / "Paid In" columns where the auto-detector
 * maps neither, so the user maps only one of them.
 */
describe('import row planner — partially mapped Debit/Credit columns', () => {
  it('auto-detect does NOT map "Paid Out" / "Paid In" columns (root of the mis-map)', () => {
    const rows = loadRows('uk-bank-paid-in-out.csv');
    const headers = Object.keys(rows[0]);
    const detected = detectColumnMapping(headers);

    expect(detected.date).toBe('Date');
    expect(detected.inflow).toBeUndefined();
    expect(detected.outflow).toBeUndefined();
    expect(detected.amount).toBeUndefined();
  });

  it('imports all 28 rows when BOTH columns are mapped', () => {
    const rows = loadRows('uk-bank-paid-in-out.csv');
    const mapping: ColumnMapping = {
      date: 'Date',
      inflow: 'Paid In',
      outflow: 'Paid Out',
      payee: 'Description',
    };
    expect(summarizeImportPlan(planImportRows(rows, mapping, UK))).toMatchObject({
      total: 28,
      ready: 28,
    });
  });

  it('reproduces the bug: mapping only "Paid In" imports just the 10 deposits', () => {
    const rows = loadRows('uk-bank-paid-in-out.csv');
    const mapping: ColumnMapping = {
      date: 'Date',
      inflow: 'Paid In', // user forgot to map "Paid Out"
      payee: 'Description',
    };
    const summary = summarizeImportPlan(planImportRows(rows, mapping, UK));
    // 28 rows uploaded, only 10 import — exactly the customer's symptom — but
    // now the other 18 are reported as skipped instead of vanishing silently.
    expect(summary).toEqual({ total: 28, ready: 10, errored: 0, skippedEmpty: 18 });
  });

  it('mapping only "Paid Out" imports just the 18 spends', () => {
    const rows = loadRows('uk-bank-paid-in-out.csv');
    const mapping: ColumnMapping = {
      date: 'Date',
      outflow: 'Paid Out',
      payee: 'Description',
    };
    expect(summarizeImportPlan(planImportRows(rows, mapping, UK))).toMatchObject({
      ready: 18,
      skippedEmpty: 10,
    });
  });
});

/**
 * The other three hypothesised failure modes (invalid dates, missing payees,
 * unknown categories) do NOT drop rows — these tests pin that down so the real
 * culprit (amounts) stays isolated.
 */
describe('import row planner — invalid dates and missing payees do NOT drop rows', () => {
  const mapping: ColumnMapping = {
    date: 'Date',
    amount: 'Amount',
    category: 'Category',
    payee: 'Payee',
  };

  it('imports every row regardless of date/payee problems', () => {
    const rows = loadRows('messy-dates-categories.csv');
    const plans = planImportRows(rows, mapping, US);
    expect(summarizeImportPlan(plans)).toMatchObject({ total: 6, ready: 6 });
  });

  it('falls back to a valid date (not a drop) for an unparseable date', () => {
    const rows = loadRows('messy-dates-categories.csv');
    const plans = planImportRows(rows, mapping, US);

    const badDate = plans.find((p) => rows[p.index].Payee === 'Grocery Store');
    expect(badDate?.status).toBe('ready');
    expect(badDate?.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('warns (but still imports) when the date cell is empty', () => {
    const rows = loadRows('messy-dates-categories.csv');
    const plans = planImportRows(rows, mapping, US);

    const noDate = plans.find((p) => rows[p.index].Payee === 'No Date Payee');
    expect(noDate?.status).toBe('ready');
    expect(noDate?.errors).toContain('No date found — using today');
  });

  it('imports rows with a missing payee as an empty payee', () => {
    const rows = loadRows('messy-dates-categories.csv');
    const plans = planImportRows(rows, mapping, US);

    const noPayee = plans.find((p) => rows[p.index].Category === 'Dining');
    expect(noPayee?.status).toBe('ready');
    expect(noPayee?.payee).toBe('');
  });
});

describe('import category resolver — unknown categories are created, never dropped', () => {
  it('auto-creates novel categories from a real CSV and always returns an id', async () => {
    const rows = loadRows('messy-dates-categories.csv');
    const { categoryIdByName, categoryGroupIdByName } = createImportNameMaps({
      categories: [
        { ID: 1, Name: 'Income' },
        { ID: 2, Name: 'Uncategorized' },
      ],
      categoryGroups: [],
    });

    let nextId = 100;
    const addCategoryGroup = vi.fn(async () => 50);
    const addCategory = vi.fn(async () => (nextId += 1));

    const resolved: number[] = [];
    for (const row of rows) {
      resolved.push(
        await resolveImportCategoryId({
          columnCategory: 'Category',
          row,
          inflow: row.Category === 'Income' ? 50 : 0,
          incomeId: 1,
          uncategorizedId: 2,
          selectedBudgetId: 7,
          categoryIdByName,
          categoryGroupIdByName,
          addCategoryGroup,
          addCategory,
        })
      );
    }

    // Every row resolved to a real category id — none were dropped.
    expect(resolved).toHaveLength(rows.length);
    expect(resolved.every((id) => typeof id === 'number' && id > 0)).toBe(true);
    // Novel names (Veterinarian, Groceries, Shopping, Dining, Home Improvement)
    // were created; "Income" reused the existing category.
    expect(addCategory).toHaveBeenCalledTimes(5);
  });
});
