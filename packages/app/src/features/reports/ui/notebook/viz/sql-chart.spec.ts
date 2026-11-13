import { describe, expect, it } from 'vitest';
import type { ChartConfiguration } from '@budgero/core/browser';
import type { QueryResult } from '@shared/lib/sql/report-query-executor';
import { sqlChartView, sqlNumber, sqlRowsView } from './sql-chart';

const source: QueryResult = {
  columns: ['month', 'category', 'amount'],
  rows: [
    ['2026-01', 'Food', 10],
    ['2026-01', 'Food', 20],
    ['2026-01', 'Rent', '1,000.50'],
    ['2026-02', 'Food', 5],
  ],
  rowCount: 4,
  executionTime: 1,
};

const chart = (patch: Partial<ChartConfiguration>): ChartConfiguration => ({
  id: 'c1',
  chartType: 'bar',
  xAxisColumn: 'month',
  yAxisColumn: 'amount',
  aggregateFunction: 'SUM',
  ...patch,
});

describe('sqlChartView', () => {
  it('folds rows that share an x value with the chart aggregate', () => {
    const sum = sqlChartView(source, chart({}))!;
    expect(sum.visualization).toBe('bar');
    expect(sum.result.columns).toEqual(['x', 'value']);
    expect(sum.result.rows).toEqual([
      ['2026-01', 1030.5],
      ['2026-02', 5],
    ]);
    expect(sum.columns.map((column) => column.name)).toEqual(['month', 'SUM(amount)']);
    // ISO months read as dates; other text stays text.
    expect(sum.columns[0]).toMatchObject({ breakout: { field: 'date', bucket: 'month' } });
    expect(sqlChartView(source, chart({ xAxisColumn: 'category' }))!.columns[0]).toMatchObject({
      breakout: { field: 'memo' },
    });
    const rows = (aggregateFunction: ChartConfiguration['aggregateFunction']) =>
      sqlChartView(source, chart({ aggregateFunction }))!.result.rows.map((row) => row[1]);
    expect(rows('COUNT')).toEqual([3, 1]);
    expect(rows('AVG')).toEqual([1030.5 / 3, 5]);
    expect(rows('MAX')).toEqual([1000.5, 5]);
    expect(rows('MIN')).toEqual([10, 5]);
  });

  it('splits series by the group column and stacks like the old viewer', () => {
    const view = sqlChartView(source, chart({ groupByColumn: 'category' }))!;
    expect(view.result.rows).toEqual([
      ['2026-01', 'Food', 30],
      ['2026-01', 'Rent', 1000.5],
      ['2026-02', 'Food', 5],
    ]);
    expect(view.stacking).toBe('none');
    expect(
      sqlChartView(source, chart({ chartType: 'area', groupByColumn: 'category' }))!.stacking
    ).toBe('stacked');
    // Pies ignore the group; a "__none__" group means none.
    expect(
      sqlChartView(source, chart({ chartType: 'pie', groupByColumn: 'category' }))!.result.columns
    ).toEqual(['x', 'value']);
    expect(sqlChartView(source, chart({ groupByColumn: '__none__' }))!.result.columns).toEqual([
      'x',
      'value',
    ]);
  });

  it('shows a stat as one number and a grouped table as a pivot', () => {
    const stat = sqlChartView(source, chart({ chartType: 'stat', aggregateFunction: 'AVG' }))!;
    expect(stat.visualization).toBe('number');
    expect(stat.result.rows).toEqual([[(10 + 20 + 1000.5 + 5) / 4]]);
    expect(
      sqlChartView(source, chart({ chartType: 'table', groupByColumn: 'category' }))!.visualization
    ).toBe('pivot');
    expect(sqlChartView(source, chart({ chartType: 'table' }))!.visualization).toBe('table');
  });

  it('draws scatter points for a numeric x, else a line', () => {
    const numeric: QueryResult = {
      ...source,
      columns: ['x', 'y'],
      rows: [
        [1, 2],
        [3, 4],
        [1, 6],
      ],
    };
    const points = sqlChartView(
      numeric,
      chart({ chartType: 'scatter', xAxisColumn: 'x', yAxisColumn: 'y' })
    )!;
    expect(points.visualization).toBe('scatter');
    expect(points.result.rows).toEqual([
      ['1', 1, 8],
      ['3', 3, 4],
    ]);
    expect(sqlChartView(source, chart({ chartType: 'scatter' }))!.visualization).toBe('line');
  });

  it('returns null when the chart columns are missing', () => {
    expect(sqlChartView(source, chart({ yAxisColumn: 'nope' }))).toBeNull();
    expect(sqlChartView(source, chart({ chartType: 'stat', yAxisColumn: 'nope' }))).toBeNull();
  });
});

describe('sqlRowsView and sqlNumber', () => {
  it('shows plain rows as a table and reads numbers like the old viewer', () => {
    const view = sqlRowsView(source);
    expect(view.visualization).toBe('table');
    expect(view.columns.map((column) => column.format)).toEqual(['text', 'text', 'number']);
    expect(sqlNumber('1,234.5')).toBe(1234.5);
    expect(sqlNumber(null)).toBe(0);
    expect(sqlNumber(BigInt(1250000))).toBe(1250000);
    expect(sqlNumber('abc')).toBe(0);
  });
});
