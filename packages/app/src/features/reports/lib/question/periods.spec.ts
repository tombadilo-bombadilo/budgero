import { describe, expect, it } from 'vitest';
import { previousPeriodQuestion, trendPeriods } from './periods';
import { normalizeQuestion, type QuestionFilter } from './spec';

const date = (filter: Partial<QuestionFilter>) =>
  ({ field: 'date', values: [], ...filter }) as QuestionFilter;

describe('trendPeriods', () => {
  it('compares this month so far with last month up to the same day', () => {
    expect(trendPeriods(date({ op: 'current', unit: 'month' }), '2026-11-08')).toEqual({
      current: { from: '2026-11-01', to: '2026-11-08' },
      previous: { from: '2026-10-01', to: '2026-10-08' },
    });
  });

  it('handles "last N" with and without the current unit', () => {
    expect(
      trendPeriods(
        date({ op: 'previous', unit: 'month', amount: 3, includeCurrent: true }),
        '2026-03-31'
      )
    ).toEqual({
      current: { from: '2026-01-01', to: '2026-03-31' },
      previous: { from: '2025-10-01', to: '2025-12-31' },
    });
    expect(
      trendPeriods(
        date({ op: 'previous', unit: 'year', amount: 1, includeCurrent: false }),
        '2026-11-08'
      )
    ).toEqual({
      current: { from: '2025-01-01', to: '2025-12-31' },
      previous: { from: '2024-01-01', to: '2024-12-31' },
    });
  });

  it('weeks start on Monday; between ranges shift by their length', () => {
    // 2026-11-08 is a Sunday.
    expect(trendPeriods(date({ op: 'current', unit: 'week' }), '2026-11-08')?.current).toEqual({
      from: '2026-11-02',
      to: '2026-11-08',
    });
    expect(
      trendPeriods(date({ op: 'between', values: ['2026-02-01', '2026-02-28'] }), '2026-11-08')
        ?.previous
    ).toEqual({ from: '2026-01-04', to: '2026-01-31' });
    expect(trendPeriods(date({ op: 'before', values: ['2026-01-01'] }), '2026-11-08')).toBeNull();
  });

  it('re-scopes the question to the previous period, keeping other filters', () => {
    const spec = normalizeQuestion({
      source: 'transactions',
      aggregations: [{ op: 'spending' }],
      filters: [
        { field: 'is_transfer', op: 'is', values: [false] },
        { field: 'date', op: 'current', unit: 'month', values: [] },
      ],
    });
    expect(previousPeriodQuestion(spec, '2026-11-08')?.filters).toEqual([
      { field: 'is_transfer', op: 'is', values: [false] },
      { field: 'date', op: 'between', values: ['2026-10-01', '2026-10-08'] },
    ]);
    expect(previousPeriodQuestion({ ...spec, filters: [] }, '2026-11-08')).toBeNull();
  });
});
