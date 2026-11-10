/**
 * SQL questions keep their stored chart settings (ChartConfiguration: type,
 * x, y, group, aggregate). This adapter turns a query result plus those
 * settings into what QuestionVisualization draws, aggregating rows on this
 * device exactly like the chart viewer that came before it: rows that share
 * an x value (and group) fold into one value with the chart's aggregate.
 */
import type { ChartConfiguration } from '@budgero/core/browser';
import type {
  QuestionColumn,
  ResolvedStacking,
  ResolvedVisualization,
} from '@features/reports/lib/question';
import type { QueryResult } from '@shared/lib/sql/report-query-executor';

export type SqlAggregate = ChartConfiguration['aggregateFunction'];

export interface SqlChartView {
  result: QueryResult;
  columns: QuestionColumn[];
  visualization: ResolvedVisualization;
  stacking: ResolvedStacking;
}

/** Column keys of the adapted result (fixed, so they never clash with SQL names). */
const X = 'x';
const GROUP = 'series';
const VALUE = 'value';

/** A cell as a number, the way the old viewer read it ("1,234.50 €" → 1234.5). */
export function sqlNumber(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'bigint') return Number(value);
  if (value === null || value === undefined) return 0;
  const parsed = parseFloat(String(value).replace(/[^0-9+\-.]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Folds numbers with the chart's aggregate (COUNT counts rows). */
export function aggregateSql(values: number[], aggregate: SqlAggregate): number {
  if (values.length === 0) return 0;
  switch (aggregate) {
    case 'SUM':
      return values.reduce((sum, value) => sum + value, 0);
    case 'COUNT':
      return values.length;
    case 'AVG':
      return values.reduce((sum, value) => sum + value, 0) / values.length;
    case 'MAX':
      return Math.max(...values);
    case 'MIN':
      return Math.min(...values);
  }
}

function isStrictNumeric(value: unknown): boolean {
  if (typeof value === 'number') return Number.isFinite(value);
  return typeof value === 'string' && /^[-+]?(?:\d+\.?\d*|\.\d+)$/.test(value.trim());
}

const breakoutColumn = (key: string, name: string, bucket?: 'month' | 'day'): QuestionColumn => ({
  key,
  kind: 'breakout',
  // Text values show as written; ISO months / days read as dates ("May 2026").
  breakout: bucket ? { field: 'date', bucket } : { field: 'memo' },
  name,
});

/** 'month' / 'day' when every x value is an ISO month ("2026-05") / day. */
function dateBucketOf(values: unknown[]): 'month' | 'day' | undefined {
  if (values.length === 0) return undefined;
  if (values.every((value) => typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value))) {
    return 'month';
  }
  if (values.every((value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value))) {
    return 'day';
  }
  return undefined;
}

const metricColumn = (key: string, name: string): QuestionColumn => ({
  key,
  kind: 'aggregation',
  aggregation: { op: 'custom', name, expression: '' },
  name,
  format: 'number',
});

/** "SUM(amount)", the old viewer's caption; COUNT names no column. */
export function sqlMetricName(
  chart: Pick<ChartConfiguration, 'aggregateFunction' | 'yAxisColumn'>
) {
  return `${chart.aggregateFunction}(${chart.yAxisColumn})`;
}

function withRows(columns: string[], rows: unknown[][], source: QueryResult): QueryResult {
  return { ...source, columns, rows, rowCount: rows.length };
}

/**
 * The view of a result for a stored chart, or null when the chart's columns
 * aren't in the result (the caller shows the plain rows instead).
 */
export function sqlChartView(source: QueryResult, chart: ChartConfiguration): SqlChartView | null {
  const { columns } = source;
  const yIndex = columns.indexOf(chart.yAxisColumn);
  const metric = metricColumn(VALUE, sqlMetricName(chart));

  if (chart.chartType === 'stat') {
    if (yIndex === -1) return null;
    const value = aggregateSql(
      source.rows.map((row) => sqlNumber(row[yIndex])),
      chart.aggregateFunction
    );
    return {
      result: withRows([VALUE], [[value]], source),
      columns: [metric],
      visualization: 'number',
      stacking: 'none',
    };
  }

  const xIndex = columns.indexOf(chart.xAxisColumn);
  if (xIndex === -1 || yIndex === -1) return null;
  const groupIndex =
    chart.groupByColumn && chart.groupByColumn !== '__none__' && chart.chartType !== 'pie'
      ? columns.indexOf(chart.groupByColumn)
      : -1;
  const grouped = groupIndex >= 0;

  // Rows that share an x (and group) value fold into one, in first-seen order.
  const buckets = new Map<string, { x: unknown; group: string; values: number[] }>();
  for (const row of source.rows) {
    const x = row[xIndex] ?? '';
    const group = grouped ? String(row[groupIndex] ?? '') : '';
    const key = `${String(x)}\u0000${group}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { x, group, values: [] };
      buckets.set(key, bucket);
    }
    bucket.values.push(sqlNumber(row[yIndex]));
  }
  const folded = Array.from(buckets.values()).map((bucket) => ({
    x: bucket.x,
    group: bucket.group,
    value: aggregateSql(bucket.values, chart.aggregateFunction),
  }));

  const xBucket =
    chart.chartType === 'pie' ? undefined : dateBucketOf(folded.map((entry) => entry.x));
  const xColumn = breakoutColumn(X, chart.xAxisColumn, xBucket);
  const groupColumn = grouped ? breakoutColumn(GROUP, chart.groupByColumn ?? '') : null;

  if (chart.chartType === 'scatter') {
    // Points need a numeric x; text x values read as a line through the categories.
    const numericX = folded.slice(0, 50).every((entry) => isStrictNumeric(entry.x));
    if (numericX && !grouped) {
      return {
        result: withRows(
          [X, 'x_value', VALUE],
          folded.map((entry) => [String(entry.x), sqlNumber(entry.x), entry.value]),
          source
        ),
        columns: [xColumn, metricColumn('x_value', chart.xAxisColumn), metric],
        visualization: 'scatter',
        stacking: 'none',
      };
    }
  }

  // A grouped table was one column per group: that's a pivot table here.
  const visualization: ResolvedVisualization =
    chart.chartType === 'scatter'
      ? 'line'
      : chart.chartType === 'table' && grouped
        ? 'pivot'
        : chart.chartType;
  const rows = folded.map((entry) =>
    grouped ? [entry.x, entry.group, entry.value] : [entry.x, entry.value]
  );
  const groupCount = grouped ? new Set(folded.map((entry) => entry.group)).size : 0;
  const xCount = new Set(folded.map((entry) => String(entry.x))).size;
  // The old viewer stacked many bar series, and every grouped area chart.
  const stacked =
    grouped &&
    ((visualization === 'bar' && (groupCount > 3 || (xCount > 8 && groupCount > 1))) ||
      visualization === 'area');
  return {
    result: withRows(grouped ? [X, GROUP, VALUE] : [X, VALUE], rows, source),
    columns: groupColumn ? [xColumn, groupColumn, metric] : [xColumn, metric],
    visualization,
    stacking: stacked ? 'stacked' : 'none',
  };
}

/** The plain rows as a table (an SQL question without a chart). */
export function sqlRowsView(source: QueryResult): SqlChartView {
  const numeric = source.columns.map((_, index) =>
    source.rows
      .slice(0, 50)
      .some((row) => typeof row[index] === 'number' || typeof row[index] === 'bigint')
  );
  return {
    result: source,
    columns: source.columns.map((name, index): QuestionColumn => ({
      key: name,
      kind: 'field',
      field: 'memo',
      name,
      format: numeric[index] ? 'number' : 'text',
    })),
    visualization: 'table',
    stacking: 'none',
  };
}
