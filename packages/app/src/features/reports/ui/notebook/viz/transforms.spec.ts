import { describe, expect, it } from 'vitest';
import {
  normalizeQuestion,
  questionColumns,
  type QuestionSpec,
} from '@features/reports/lib/question';
import { buildChartModel } from '../chart-model';
import {
  OTHER_VALUE,
  applyCategoryDisplay,
  buildCalendar,
  buildPivot,
  buildSankey,
  buildScatter,
  buildTrend,
  buildWaterfall,
  pivotToCsv,
  preferRowChart,
  refineAutoVisualization,
  sortPivotRows,
  trendChange,
} from './transforms';

const result = (columns: string[], rows: unknown[][]) => ({
  columns,
  rows,
  rowCount: rows.length,
  executionTime: 1,
});
const columnsOf = (spec: Partial<QuestionSpec>) =>
  questionColumns(normalizeQuestion({ source: 'transactions', ...spec }));

const byCategory = columnsOf({ aggregations: [{ op: 'net' }], breakouts: [{ field: 'category' }] });
const categoryRows = result(
  ['category', 'net'],
  [
    ['Salary', 3000],
    ['Rent', -1200],
    ['Food', -400],
    ['Bonus', 500],
    ['Fun', -100],
  ]
);

describe('applyCategoryDisplay', () => {
  it('sorts categories by total and folds past the top N into Other', () => {
    const model = applyCategoryDisplay(buildChartModel(categoryRows, byCategory), {
      sort: 'asc',
      topN: 3,
    });
    expect(model.xValues).toEqual(['Rent', 'Bonus', 'Salary', OTHER_VALUE]);
    expect(model.series[0].values).toEqual([-1200, 500, 3000, -500]);
    expect(model.otherXCount).toBe(2);
  });

  it('leaves date axes alone', () => {
    const columns = columnsOf({ aggregations: [{ op: 'net' }], breakouts: [{ field: 'date' }] });
    const model = applyCategoryDisplay(
      buildChartModel(
        result(
          ['month', 'net'],
          [
            ['2026-01', 1],
            ['2026-02', 5],
          ]
        ),
        columns
      ),
      { sort: 'desc', topN: 1 }
    );
    expect(model.xValues).toEqual(['2026-01', '2026-02']);
  });
});

describe('row chart auto pick', () => {
  it('prefers rows for many or long labels', () => {
    expect(preferRowChart(['Rent', 'Food'])).toBe(false);
    expect(preferRowChart(['A very long category name'])).toBe(true);
    expect(preferRowChart(Array.from({ length: 13 }, (_, i) => `C${i}`))).toBe(true);
  });

  it('only upgrades an auto bar chart', () => {
    const spec = normalizeQuestion({
      source: 'transactions',
      aggregations: [{ op: 'spending' }],
      breakouts: [{ field: 'payee' }],
    });
    const columns = questionColumns(spec);
    const rows = result(['payee', 'spending'], [['Supermarket around the corner', 10]]);
    expect(refineAutoVisualization(spec, 'bar', rows, columns)).toBe('row');
    expect(refineAutoVisualization({ ...spec, visualization: 'bar' }, 'bar', rows, columns)).toBe(
      'bar'
    );
  });
});

describe('buildPivot', () => {
  const columns = columnsOf({
    aggregations: [{ op: 'spending' }],
    breakouts: [{ field: 'date', bucket: 'month' }, { field: 'category_group' }],
  });
  const rows = result(
    ['month', 'category_group', 'spending'],
    [
      ['2026-02', 'Bills', 100],
      ['2026-01', 'Bills', 90],
      ['2026-01', 'Fun', 300],
      ['2026-02', 'Fun', 10],
      ['2026-02', 'Food', 50],
    ]
  );

  it('builds rows, columns, cells and totals', () => {
    const pivot = buildPivot(rows, columns)!;
    expect(pivot.rows.map((row) => row.key)).toEqual(['2026-01', '2026-02']);
    // Category columns by size.
    expect(pivot.cols.map((col) => [col.key, col.total])).toEqual([
      ['Fun', 310],
      ['Bills', 190],
      ['Food', 50],
    ]);
    expect(pivot.cells['2026-01']).toEqual({ Bills: 90, Fun: 300 });
    expect(pivot.rows.map((row) => row.total)).toEqual([390, 160]);
    expect(pivot.grandTotal).toBe(550);
  });

  it('sorts rows by a column, the total or the label', () => {
    const pivot = buildPivot(rows, columns)!;
    const keys = (sort: Parameters<typeof sortPivotRows>[1]) =>
      sortPivotRows(pivot, sort).map((row) => row.key);
    expect(keys({ by: { column: 'Bills' }, direction: 'desc' })).toEqual(['2026-02', '2026-01']);
    expect(keys({ by: 'total', direction: 'asc' })).toEqual(['2026-02', '2026-01']);
    expect(keys({ by: 'label', direction: 'desc' })).toEqual(['2026-02', '2026-01']);
    expect(keys(null)).toEqual(['2026-01', '2026-02']);
  });

  it('exports the pivot as CSV with totals', () => {
    const pivot = buildPivot(rows, columns)!;
    const csv = pivotToCsv(pivot, pivot.rows, {
      corner: 'Month \\ Group',
      total: 'Total',
      row: (value) => `M ${String(value)}`,
      col: (value) => (value === 'Fun' ? 'Fun, games' : String(value)),
    });
    expect(csv.split('\n')).toEqual([
      'Month \\ Group,"Fun, games",Bills,Food,Total',
      'M 2026-01,300,90,,390',
      'M 2026-02,10,100,50,160',
      'Total,310,190,50,550',
    ]);
  });

  it('needs two groupings', () => {
    expect(buildPivot(categoryRows, byCategory)).toBeNull();
  });
});

describe('buildWaterfall', () => {
  it('climbs through income, falls through spending, ends at the total', () => {
    const waterfall = buildWaterfall(buildChartModel(categoryRows, byCategory));
    expect(waterfall.steps.map((step) => [step.value, step.start, step.end])).toEqual([
      ['Salary', 0, 3000],
      ['Bonus', 3000, 3500],
      ['Rent', 3500, 2300],
      ['Food', 2300, 1900],
      ['Fun', 1900, 1800],
    ]);
    expect(waterfall.total).toBe(1800);
  });

  it('folds the smallest steps into Other before the total', () => {
    const waterfall = buildWaterfall(buildChartModel(categoryRows, byCategory), 3);
    // Kept: Salary, Rent, Bonus (largest); Food + Fun fold into Other.
    expect(waterfall.steps.map((step) => [step.value, step.amount])).toEqual([
      ['Salary', 3000],
      ['Bonus', 500],
      ['Rent', -1200],
      [OTHER_VALUE, -500],
    ]);
    expect(waterfall.otherCount).toBe(2);
    expect(waterfall.total).toBe(1800);
  });
});

describe('buildSankey', () => {
  const columns = columnsOf({
    aggregations: [{ op: 'spending' }],
    breakouts: [{ field: 'category_group' }, { field: 'category' }],
  });
  const rows = result(
    ['category_group', 'category', 'spending'],
    [
      ['Bills', 'Rent', 1200],
      ['Bills', 'Power', 80],
      ['Living', 'Food', 400],
      ['Living', 'Bills', 30],
      ['Fun', 'Games', -60],
      ['Fun', 'Zero', 0],
    ]
  );

  it('links groups to categories with unique node ids per side', () => {
    const data = buildSankey(rows, columns)!;
    expect(data.nodes.map((node) => node.id)).toEqual([
      '0:Bills',
      '0:Living',
      '0:Fun',
      '1:Rent',
      '1:Food',
      '1:Power',
      '1:Games',
      '1:Bills',
    ]);
    expect(data.links).toContainEqual({ source: '0:Fun', target: '1:Games', value: 60 });
    expect(data.links).toHaveLength(5);
  });

  it('folds each side past the top N into Other', () => {
    const data = buildSankey(rows, columns, 1)!;
    expect(data.nodes.map((node) => node.id)).toEqual([
      '0:Bills',
      `0:${OTHER_VALUE}`,
      '1:Rent',
      `1:${OTHER_VALUE}`,
    ]);
    expect(data.otherCounts).toEqual([2, 4]);
    expect(data.links).toContainEqual({
      source: `0:${OTHER_VALUE}`,
      target: `1:${OTHER_VALUE}`,
      value: 490,
    });
  });
});

describe('buildCalendar', () => {
  it('groups daily values by year, newest first', () => {
    const columns = columnsOf({
      aggregations: [{ op: 'spending' }],
      breakouts: [{ field: 'date', bucket: 'day' }],
    });
    const years = buildCalendar(
      result(
        ['day', 'spending'],
        [
          ['2025-12-31', 20],
          ['2026-01-02', 5],
          ['2026-01-01', 15],
          ['bad', 99],
        ]
      ),
      columns
    );
    expect(years.map((year) => year.year)).toEqual([2026, 2025]);
    expect(years[0]).toEqual({
      year: 2026,
      days: [
        ['2026-01-01', 15],
        ['2026-01-02', 5],
      ],
      min: 5,
      max: 15,
      total: 20,
    });
  });
});

describe('buildTrend', () => {
  it('compares the latest date bucket with the one before', () => {
    const columns = columnsOf({
      aggregations: [{ op: 'spending' }],
      breakouts: [{ field: 'date', bucket: 'month' }],
    });
    const rows = result(
      ['month', 'spending'],
      [
        ['2026-03', 120],
        ['2026-01', 80],
        ['2026-02', 100],
      ]
    );
    const trend = buildTrend(rows, columns[1], buildChartModel(rows, columns))!;
    expect(trend.points.map((point) => point.x)).toEqual(['2026-01', '2026-02', '2026-03']);
    expect([trend.current, trend.previous, trend.currentX, trend.previousX]).toEqual([
      120,
      100,
      '2026-03',
      '2026-02',
    ]);
    expect(trendChange(120, 100)).toEqual({ delta: 20, ratio: 0.2 });
    expect(trendChange(5, 0)).toEqual({ delta: 5, ratio: null });
  });

  it('falls back to the single value without a date grouping', () => {
    const columns = columnsOf({ aggregations: [{ op: 'spending' }] });
    const rows = result(['spending'], [[42]]);
    expect(buildTrend(rows, columns[0], buildChartModel(rows, columns))).toMatchObject({
      current: 42,
      previous: null,
      points: [],
    });
  });
});

describe('buildScatter', () => {
  it('plots one point per row', () => {
    const columns = columnsOf({
      aggregations: [{ op: 'spending' }, { op: 'count' }],
      breakouts: [{ field: 'payee' }],
    });
    const data = buildScatter(
      result(
        ['payee', 'spending', 'count'],
        [
          ['Shop', 300, 12],
          ['Cafe', 40, 9],
        ]
      ),
      columns
    )!;
    expect(data.points).toEqual([
      { labels: ['Shop'], x: 300, y: 12 },
      { labels: ['Cafe'], x: 40, y: 9 },
    ]);
  });
});
