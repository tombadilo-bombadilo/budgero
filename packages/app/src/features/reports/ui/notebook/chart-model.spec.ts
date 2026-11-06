import { describe, expect, it } from 'vitest';
import { normalizeQuestion, questionColumns } from '@features/reports/lib/question';
import { buildChartModel, MAX_SERIES, OTHER_SERIES_ID } from './chart-model';

const result = (columns: string[], rows: unknown[][]) => ({
  columns,
  rows,
  rowCount: rows.length,
  executionTime: 1,
});

describe('buildChartModel', () => {
  it('one series per metric, time axis in chronological order', () => {
    const spec = normalizeQuestion({
      source: 'transactions',
      aggregations: [{ op: 'income' }, { op: 'spending' }],
      breakouts: [{ field: 'date', bucket: 'month' }],
    });
    const model = buildChartModel(
      result(
        ['month', 'income', 'spending'],
        [
          ['2026-02', 0, 110],
          ['2026-01', 3000, 50],
        ]
      ),
      questionColumns(spec)
    );
    expect(model.xValues).toEqual(['2026-01', '2026-02']);
    expect(model.seriesColumn).toBeNull();
    expect(model.series.map((series) => [series.id, series.values])).toEqual([
      ['income', [3000, 0]],
      ['spending', [50, 110]],
    ]);
  });

  it('keeps value order for category axes and pivots the second grouping into series', () => {
    const spec = normalizeQuestion({
      source: 'transactions',
      aggregations: [{ op: 'spending' }],
      breakouts: [{ field: 'category' }, { field: 'date', bucket: 'year' }],
    });
    const model = buildChartModel(
      result(
        ['category', 'year', 'spending'],
        [
          ['Rent', '2025', 900],
          ['Rent', '2026', 1000],
          ['Fun', '2026', 40],
        ]
      ),
      questionColumns(spec)
    );
    expect(model.xValues).toEqual(['Rent', 'Fun']);
    expect(model.seriesColumn?.key).toBe('year');
    expect(model.series.map((series) => [series.id, series.values])).toEqual([
      ['2025', [900, 0]],
      ['2026', [1000, 40]],
    ]);
  });

  it(`folds series beyond ${MAX_SERIES} into Other`, () => {
    const spec = normalizeQuestion({
      source: 'transactions',
      aggregations: [{ op: 'count' }],
      breakouts: [{ field: 'date', bucket: 'month' }, { field: 'payee' }],
    });
    const rows = Array.from({ length: 20 }, (_, index) => ['2026-01', `P${index}`, index + 1]);
    const model = buildChartModel(result(['month', 'payee', 'count'], rows), questionColumns(spec));
    expect(model.series).toHaveLength(MAX_SERIES);
    expect(model.otherCount).toBe(20 - (MAX_SERIES - 1));
    const other = model.series.find((series) => series.id === OTHER_SERIES_ID)!;
    // The 9 smallest payees: 1 + 2 + … + 9.
    expect(other.values).toEqual([45]);
  });

  it('returns an empty model for raw rows', () => {
    const spec = normalizeQuestion({ source: 'accounts' });
    const model = buildChartModel(result(['account'], [['Checking']]), questionColumns(spec));
    expect(model.series).toEqual([]);
  });
});
