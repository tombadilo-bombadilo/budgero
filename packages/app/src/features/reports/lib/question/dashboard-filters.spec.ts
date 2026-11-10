import { describe, expect, it } from 'vitest';
import { compileQuestion } from './compile';
import {
  applyDashboardFilters,
  hasDashboardFilters,
  normalizeDashboardFilters,
} from './dashboard-filters';
import { MAX_FILTERS, normalizeQuestion } from './spec';

describe('normalizeDashboardFilters', () => {
  it('keeps valid presets, ranges and ids; drops junk', () => {
    expect(normalizeDashboardFilters(null)).toEqual({});
    expect(normalizeDashboardFilters([1, 2])).toEqual({});
    expect(
      normalizeDashboardFilters({
        date: { preset: 'custom', from: '2026-03-01', to: '2026-01-01' },
        accounts: [3, '4', -1, 3, 'x'],
        categoryGroups: [],
        extra: true,
      })
    ).toEqual({
      date: { preset: 'custom', from: '2026-01-01', to: '2026-03-01' },
      accounts: [3, 4],
    });
    expect(normalizeDashboardFilters({ date: { preset: 'custom', from: '2026-02-30' } })).toEqual(
      {}
    );
    expect(normalizeDashboardFilters({ date: { preset: 'forever' } })).toEqual({});
    expect(hasDashboardFilters({})).toBe(false);
    expect(hasDashboardFilters({ accounts: [1] })).toBe(true);
  });
});

describe('applyDashboardFilters', () => {
  const transactions = normalizeQuestion({
    source: 'transactions',
    aggregations: [{ op: 'spending' }],
    breakouts: [{ field: 'category' }],
    filters: [
      { field: 'is_transfer', op: 'is', values: [false] },
      { field: 'date', op: 'previous', amount: 12, unit: 'month', values: [] },
      { field: 'account', op: 'is', values: [9] },
    ],
  });

  it('replaces the question date range and narrows by accounts and groups', () => {
    const { spec, applied, ignored } = applyDashboardFilters(transactions, {
      date: { preset: 'lastYear' },
      accounts: [1, 2],
      categoryGroups: [5],
    });
    expect(applied).toEqual(['date', 'accounts', 'categoryGroups']);
    expect(ignored).toEqual([]);
    // Dashboard filters first, then the question's own (its date range replaced).
    expect(spec.filters).toEqual([
      {
        field: 'date',
        op: 'previous',
        values: [],
        unit: 'year',
        amount: 1,
        includeCurrent: false,
      },
      { field: 'account', op: 'is', values: [1, 2] },
      { field: 'category_group', op: 'is', values: [5] },
      { field: 'is_transfer', op: 'is', values: [false] },
      { field: 'account', op: 'is', values: [9] },
    ]);
    const { sql } = compileQuestion(spec, { budgetId: 1 });
    expect(sql).toContain('account_id IN (9)');
    expect(sql).toContain('account_id IN (1, 2)');
    expect(sql).toContain('category_group_id IN (5)');
  });

  it('applies only the fields a source has', () => {
    const budget = normalizeQuestion({
      source: 'budget',
      aggregations: [{ op: 'sum', field: 'assigned' }],
      breakouts: [{ field: 'month' }],
    });
    const result = applyDashboardFilters(budget, {
      date: { preset: 'custom', from: '2026-01-01', to: '2026-06-30' },
      accounts: [1],
      categoryGroups: [2],
    });
    expect(result.applied).toEqual(['date', 'categoryGroups']);
    expect(result.ignored).toEqual(['accounts']);
    expect(result.spec.filters[0]).toEqual({
      field: 'month',
      op: 'between',
      values: ['2026-01-01', '2026-06-30'],
    });

    const accounts = normalizeQuestion({
      source: 'accounts',
      aggregations: [{ op: 'sum', field: 'balance' }],
      breakouts: [{ field: 'account_type' }],
    });
    const forAccounts = applyDashboardFilters(accounts, {
      date: { preset: 'thisMonth' },
      accounts: [1],
    });
    expect(forAccounts.applied).toEqual(['accounts']);
    expect(forAccounts.ignored).toEqual(['date']);
  });

  it('applies dashboard filters to a question at the filter limit', () => {
    const full = normalizeQuestion({
      source: 'transactions',
      aggregations: [{ op: 'count' }],
      filters: Array.from({ length: MAX_FILTERS }, (_, index) => ({
        field: 'amount',
        op: 'isNot',
        values: [index + 1000],
      })),
    });
    expect(full.filters).toHaveLength(MAX_FILTERS);
    const { spec, applied } = applyDashboardFilters(full, {
      date: { preset: 'thisMonth' },
      accounts: [101],
      categoryGroups: [3],
    });
    expect(applied).toEqual(['date', 'accounts', 'categoryGroups']);
    expect(spec.filters).toHaveLength(MAX_FILTERS + 3);
    // Stable when compiled (compile normalizes again).
    const { sql } = compileQuestion(spec, { budgetId: 1, today: '2026-11-06' });
    expect(sql).toContain('account_id IN (101)');
    expect(sql).toContain('category_group_id IN (3)');
    expect(sql).toContain('NOT IN (1029)');
  });

  it('ANDs an account filter with the question own account filter', () => {
    const { spec } = applyDashboardFilters(transactions, { accounts: [101] });
    const accounts = spec.filters.filter((filter) => filter.field === 'account');
    expect(accounts).toEqual([
      { field: 'account', op: 'is', values: [101] },
      { field: 'account', op: 'is', values: [9] },
    ]);
  });

  it('keeps date-part filters when the dashboard sets the date', () => {
    const weekends = normalizeQuestion({
      source: 'transactions',
      aggregations: [{ op: 'count' }],
      filters: [
        { field: 'date', op: 'is', values: [6, 7], part: 'dayOfWeek' },
        { field: 'date', op: 'current', unit: 'year', values: [] },
      ],
    });
    const { spec } = applyDashboardFilters(weekends, { date: { preset: 'thisMonth' } });
    expect(spec.filters).toEqual([
      { field: 'date', op: 'current', values: [], unit: 'month' },
      { field: 'date', op: 'is', values: [6, 7], part: 'dayOfWeek' },
    ]);
  });

  it('leaves the question untouched without filters', () => {
    expect(applyDashboardFilters(transactions, {}).spec).toEqual(transactions);
  });
});
