import { describe, expect, it } from 'vitest';
import { compileQuestion } from './compile';
import {
  applyDashboardFilters,
  hasDashboardFilters,
  normalizeDashboardFilters,
} from './dashboard-filters';
import { normalizeQuestion } from './spec';

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
    expect(spec.filters).toEqual([
      { field: 'is_transfer', op: 'is', values: [false] },
      { field: 'account', op: 'is', values: [9] },
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

  it('leaves the question untouched without filters', () => {
    expect(applyDashboardFilters(transactions, {}).spec).toEqual(transactions);
  });
});
