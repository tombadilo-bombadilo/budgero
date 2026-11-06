import { describe, expect, it } from 'vitest';
import { isReadOnlyQuery } from '@shared/lib/sql/read-only';
import {
  BUILDER_TEMPLATES,
  buildSavedBuilderQuery,
  compileReportSpec,
  createDefaultSpec,
  normalizeSpec,
  parseBuilderHeader,
  serializeBuilderHeader,
  sqlString,
  stripBuilderHeader,
  type BuilderDimension,
  type BuilderMeasure,
} from './report-builder';

const BUDGET = 7;

function compile(overrides: Parameters<typeof createDefaultSpec>[0] = {}) {
  return compileReportSpec(createDefaultSpec(overrides), { budgetId: BUDGET, chartId: 'c1' });
}

describe('compileReportSpec', () => {
  it('produces a read-only query over transactions_analytics scoped to the budget', () => {
    const { sql } = compile();
    expect(isReadOnlyQuery(sql)).toBe(true);
    expect(sql.startsWith('WITH lines AS (')).toBe(true);
    // Both halves of the split expansion are scoped.
    expect(sql.match(/t\.budget_id = 7/g)).toHaveLength(2);
    expect(sql).toContain('FROM transactions_analytics t');
    expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|ATTACH|COPY)\b/i);
  });

  it('rejects a missing or invalid budget id', () => {
    expect(() => compileReportSpec(createDefaultSpec(), { budgetId: 0 })).toThrow();
    expect(() => compileReportSpec(createDefaultSpec(), { budgetId: 1.5 })).toThrow();
    expect(() => compileReportSpec(createDefaultSpec(), { budgetId: Number.NaN })).toThrow();
  });

  it('expands split transactions into their split lines', () => {
    const { sql } = compile({ groupBy: 'category' });
    expect(sql).toContain('NOT t.has_splits');
    expect(sql).toContain('JOIN transaction_splits s ON s."TransactionID" = t.transaction_id');
    expect(sql).toContain('s."CategoryID" AS category_id');
    expect(sql).toContain(`COALESCE(s."TransferAccountID", 0) <> 0`);
  });

  it('excludes transfers and off-budget accounts by default', () => {
    const { sql } = compile();
    expect(sql).toContain('NOT is_transfer');
    expect(sql).toContain(`COALESCE(category_group_name, '') <> 'Transfers'`);
    expect(sql.match(/t\.account_on_budget = 1/g)).toHaveLength(2);
  });

  it('includes transfers and off-budget accounts when toggled', () => {
    const { sql } = compile({ includeTransfers: true, includeOffBudget: true });
    expect(sql).not.toContain('NOT is_transfer');
    expect(sql).not.toContain('account_on_budget');
  });

  it.each<[BuilderMeasure, string, string | null]>([
    ['spending', 'SUM(outflow - inflow)', `NOT (COALESCE(category_group_name, '') = 'Income')`],
    ['income', 'SUM(inflow - outflow)', `AND COALESCE(category_group_name, '') = 'Income'`],
    ['net', 'SUM(inflow - outflow)', null],
    ['count', 'COUNT(DISTINCT transaction_id)', null],
    [
      'average',
      'NULLIF(COUNT(DISTINCT transaction_id), 0)',
      `NOT (COALESCE(category_group_name, '') = 'Income')`,
    ],
    [
      'incomeVsSpending',
      'CASE WHEN is_income THEN inflow - outflow ELSE outflow - inflow END',
      null,
    ],
  ])('measure %s', (measure, valueFragment, filterFragment) => {
    const { sql } = compile({ measure });
    expect(sql).toContain(valueFragment);
    if (filterFragment) expect(sql).toContain(filterFragment);
    if (measure === 'net' || measure === 'count') {
      expect(sql).not.toContain(`NOT (COALESCE(category_group_name, '') = 'Income')`);
    }
  });

  it('income vs spending emits Income / Spending series and never a pie or stat', () => {
    const { sql, chart } = compile({ measure: 'incomeVsSpending', groupBy: 'month' });
    expect(sql).toContain(`THEN 'Income' ELSE 'Spending' END AS series`);
    expect(chart.groupByColumn).toBe('series');
    expect(normalizeSpec({ measure: 'incomeVsSpending', chartType: 'pie' }).chartType).toBe('bar');
    expect(normalizeSpec({ measure: 'incomeVsSpending', splitBy: 'account' }).splitBy).toBeNull();
  });

  it.each<[BuilderDimension, string]>([
    ['month', 'SUBSTR(month, 1, 7) AS label'],
    ['week', 'week AS label'],
    ['quarter', `SUBSTR(quarter, 1, 4) || '-Q'`],
    ['year', 'SUBSTR(year, 1, 4) AS label'],
    ['category', `COALESCE(NULLIF(TRIM(category_name), ''), 'Uncategorized') AS label`],
    ['categoryGroup', `COALESCE(NULLIF(TRIM(category_group_name), ''), 'Uncategorized') AS label`],
    ['payee', `COALESCE(NULLIF(TRIM(payee_name), ''), 'No payee') AS label`],
    ['account', 'TRIM(account_name)'],
    ['label', `COALESCE(NULLIF(TRIM(label_name), ''), 'No label') AS label`],
  ])('group by %s', (groupBy, fragment) => {
    const { sql, chart } = compile({ groupBy });
    expect(sql).toContain(fragment);
    expect(chart.xAxisColumn).toBe('label');
    expect(chart.yAxisColumn).toBe('value');
    expect(chart.groupByColumn).toBeUndefined();
  });

  it('sorts time group-bys chronologically without a limit', () => {
    const { sql } = compile({ groupBy: 'month', sort: 'valueDesc', limit: 5 });
    expect(sql).toMatch(/ORDER BY agg\.label$/);
    expect(sql).not.toMatch(/LIMIT/);
  });

  it('applies Top N and value sort to categorical group-bys', () => {
    const desc = compile({ groupBy: 'payee', limit: 10, sort: 'valueDesc' }).sql;
    expect(desc).toContain('ORDER BY total DESC, label\nLIMIT 10');
    expect(desc).toMatch(/ORDER BY totals\.total DESC, agg\.label$/);

    const asc = compile({ groupBy: 'payee', limit: 3, sort: 'valueAsc' }).sql;
    expect(asc).toContain('ORDER BY total ASC, label\nLIMIT 3');

    const byLabel = compile({ groupBy: 'payee', limit: null, sort: 'label' }).sql;
    expect(byLabel).not.toContain('LIMIT');
    expect(byLabel).toMatch(/ORDER BY agg\.label$/);
  });

  it('adds a series column when split by is set', () => {
    const { sql, chart } = compile({ groupBy: 'month', splitBy: 'categoryGroup' });
    expect(sql).toContain(
      `COALESCE(NULLIF(TRIM(category_group_name), ''), 'Uncategorized') AS series`
    );
    expect(sql).toContain('GROUP BY label, series');
    expect(sql).toMatch(/ORDER BY agg\.label, agg\.series$/);
    expect(chart.groupByColumn).toBe('series');
  });

  it('drops split by when it equals group by or the chart is a pie / stat', () => {
    expect(createDefaultSpec({ groupBy: 'month', splitBy: 'month' }).splitBy).toBeNull();
    expect(createDefaultSpec({ splitBy: 'month', chartType: 'pie' }).splitBy).toBeNull();
    expect(createDefaultSpec({ splitBy: 'month', chartType: 'stat' }).splitBy).toBeNull();
  });

  it('compiles stat charts to a single value', () => {
    const { sql, chart } = compile({ chartType: 'stat', measure: 'count' });
    expect(sql).toMatch(/SELECT COUNT\(DISTINCT transaction_id\) AS value\nFROM base$/);
    expect(chart).toMatchObject({ chartType: 'stat', xAxisColumn: 'value', yAxisColumn: 'value' });
  });

  it('filters by ids and escaped payee names', () => {
    const { sql } = compile({
      filters: {
        accountIds: [1, 2],
        categoryIds: [3],
        categoryGroupIds: [4],
        labelIds: [5],
        payees: ["O'Brien's", 'Café'],
      },
    });
    expect(sql).toContain('account_id IN (1, 2)');
    expect(sql).toContain('category_id IN (3)');
    expect(sql).toContain('category_group_id IN (4)');
    expect(sql).toContain('label_id IN (5)');
    expect(sql).toContain(`IN ('o''brien''s', 'café')`);
  });

  it('drops non-numeric ids from untrusted specs', () => {
    const spec = normalizeSpec({
      filters: { accountIds: ['1; DROP TABLE x', 2, -3, 4.5, '6'], payees: [1, ' a '] },
    });
    expect(spec.filters.accountIds).toEqual([2, 6]);
    expect(spec.filters.payees).toEqual(['a']);
  });

  it('escapes injected label text', () => {
    const { sql } = compileReportSpec(createDefaultSpec({ groupBy: 'payee' }), {
      budgetId: BUDGET,
      labels: {
        uncategorized: 'x',
        noPayee: "Kein'); DROP TABLE t; --",
        noLabel: 'y',
        noAccount: 'z',
        income: 'i',
        spending: 's',
      },
    });
    expect(sql).toContain(`'Kein''); DROP TABLE t; --'`);
  });

  it('builds relative date presets and validated custom ranges', () => {
    expect(compile({ dateRange: { preset: 'last12Months' } }).sql).toContain(
      `date >= strftime(DATE_TRUNC('month', CURRENT_DATE) - INTERVAL 11 MONTH, '%Y-%m-%d')`
    );
    expect(compile({ dateRange: { preset: 'thisMonth' } }).sql).toContain(
      `date < strftime(DATE_TRUNC('month', CURRENT_DATE) + INTERVAL 1 MONTH, '%Y-%m-%d')`
    );
    expect(compile({ dateRange: { preset: 'yearToDate' } }).sql).toContain(
      `DATE_TRUNC('year', CURRENT_DATE)`
    );
    expect(compile({ dateRange: { preset: 'allTime' } }).sql).not.toMatch(/\bdate [<>]=?/);

    const custom = compile({
      dateRange: { preset: 'custom', from: '2026-03-01', to: '2026-01-01' },
    });
    expect(custom.sql).toContain(`date >= '2026-01-01'`);
    expect(custom.sql).toContain(`date <= '2026-03-01'`);

    const bad = normalizeSpec({
      dateRange: { preset: 'custom', from: "2026-01-01' OR 1=1 --", to: '2026-02-30' },
    });
    expect(bad.dateRange).toEqual({ preset: 'custom' });
  });

  it('reuses the given chart id and title', () => {
    const { chart } = compileReportSpec(createDefaultSpec(), {
      budgetId: BUDGET,
      chartId: 'keep-me',
      chartTitle: 'Spending',
    });
    expect(chart.id).toBe('keep-me');
    expect(chart.title).toBe('Spending');
  });

  it('compiles every template', () => {
    for (const spec of Object.values(BUILDER_TEMPLATES)) {
      expect(isReadOnlyQuery(compileReportSpec(spec, { budgetId: 1 }).sql)).toBe(true);
    }
  });
});

describe('builder header', () => {
  it('round-trips a spec through the saved query', () => {
    const spec = createDefaultSpec({
      measure: 'net',
      groupBy: 'month',
      splitBy: 'account',
      dateRange: { preset: 'custom', from: '2026-01-01', to: '2026-06-30' },
      filters: {
        accountIds: [1],
        categoryIds: [],
        categoryGroupIds: [],
        payees: ["O'Brien\nX"],
        labelIds: [],
      },
      includeTransfers: true,
      chartType: 'line',
    });
    const { sql } = compileReportSpec(spec, { budgetId: 1 });
    const saved = buildSavedBuilderQuery(spec, sql);

    expect(saved.split('\n')[0]).toBe(serializeBuilderHeader(spec));
    expect(saved.split('\n')[0]).toMatch(/^-- budgero-builder: \{/);
    expect(parseBuilderHeader(saved)).toEqual(spec);
    expect(stripBuilderHeader(saved)).toBe(sql);
    expect(isReadOnlyQuery(saved)).toBe(true);
  });

  it('keeps the header compact', () => {
    const header = serializeBuilderHeader(createDefaultSpec());
    expect(header).not.toContain('filters');
    expect(header).not.toContain('includeTransfers');
  });

  it('returns null for plain SQL and broken headers', () => {
    expect(parseBuilderHeader('SELECT 1')).toBeNull();
    expect(parseBuilderHeader('-- a comment\nSELECT 1')).toBeNull();
    expect(parseBuilderHeader('-- budgero-builder: {not json\nSELECT 1')).toBeNull();
    expect(parseBuilderHeader('-- budgero-builder: [1]\nSELECT 1')).toBeNull();
    expect(parseBuilderHeader('')).toBeNull();
    expect(stripBuilderHeader('SELECT 1')).toBe('SELECT 1');
  });

  it('normalizes unknown values in a stored header', () => {
    const spec = parseBuilderHeader(
      '-- budgero-builder: {"measure":"bogus","groupBy":"month","limit":"9999","chartType":"donut"}\nSELECT 1'
    );
    expect(spec).toMatchObject({
      measure: 'spending',
      groupBy: 'month',
      chartType: 'bar',
      limit: null,
    });
  });
});

describe('sqlString', () => {
  it('doubles quotes', () => {
    expect(sqlString("it's")).toBe("'it''s'");
  });
});
