/**
 * Shapes a question result into chart series: x values from the first
 * grouping, one series per metric — or, with two groupings, one series per
 * value of the second grouping (first metric only).
 */
import type { QuestionColumn } from '@features/reports/lib/question';
import type { QueryResult } from '@shared/lib/sql/report-query-executor';

export const MAX_SERIES = 12;

export interface ChartSeries {
  /** Raw series value (second grouping) or metric key. */
  id: string;
  /** Column the series' value belongs to (for formatting). */
  metric: QuestionColumn;
  /** Raw second-grouping value; null when series are metrics. */
  groupValue: unknown;
  /** Hidden id / raw key of the second-grouping value (drill-through), if the result has one. */
  groupKey?: unknown;
  values: number[];
}

export interface ChartModel {
  x: QuestionColumn | null;
  /** Raw x values in result order. */
  xValues: unknown[];
  /** Hidden ids / raw keys of the x values (`<key>__key` columns), undefined when absent. */
  xKeys: unknown[];
  /** Second grouping column, when series are its values. */
  seriesColumn: QuestionColumn | null;
  series: ChartSeries[];
  /** Series folded into "Other" (beyond MAX_SERIES), 0 when none. */
  otherCount: number;
}

function toNumber(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

export const OTHER_SERIES_ID = '__other__';

/**
 * Identity of a grouping value in a row: its hidden id / raw key when the
 * result has one (so same-name categories stay apart), else its value.
 */
function identity(row: unknown[], valueIndex: number, keyIndex: number | undefined): string {
  const value = String(row[valueIndex] ?? '');
  return keyIndex === undefined ? value : `${String(row[keyIndex] ?? '')}\u0000${value}`;
}

export function buildChartModel(result: QueryResult, columns: QuestionColumn[]): ChartModel {
  const index = new Map(result.columns.map((name, position) => [name, position]));
  const breakouts = columns.filter((column) => column.kind === 'breakout');
  // "% change" columns are on another scale than the metric; tables show them.
  const metrics = columns.filter(
    (column) => column.kind === 'aggregation' && column.derived !== 'change'
  );
  const x = breakouts[0] ?? null;
  const empty: ChartModel = {
    x,
    xValues: [],
    xKeys: [],
    seriesColumn: null,
    series: [],
    otherCount: 0,
  };
  if (!x || metrics.length === 0) return empty;
  const xIndex = index.get(x.key);
  if (xIndex === undefined) return empty;
  const xKeyIndex = index.get(`${x.key}__key`);

  let xKeys: string[] = [];
  const firstValue = new Map<string, unknown>();
  const firstKey = new Map<string, unknown>();
  for (const row of result.rows) {
    const key = identity(row, xIndex, xKeyIndex);
    if (!firstValue.has(key)) {
      firstValue.set(key, row[xIndex]);
      if (xKeyIndex !== undefined) firstKey.set(key, row[xKeyIndex]);
      xKeys.push(key);
    }
  }
  // Time axes always read left to right, whatever the rows are sorted by.
  // Bucket labels (YYYY, YYYY-MM, YYYY-Qn, YYYY-MM-DD) sort as text.
  if (x.kind === 'breakout' && x.breakout.bucket) xKeys = [...xKeys].sort();
  const xValues = xKeys.map((key) => firstValue.get(key));
  const xHidden = xKeys.map((key) => (xKeyIndex === undefined ? undefined : firstKey.get(key)));
  const xPosition = new Map(xKeys.map((key, position) => [key, position]));

  const seriesColumn = breakouts[1] ?? null;
  if (!seriesColumn) {
    const series = metrics.flatMap((metric) => {
      const metricIndex = index.get(metric.key);
      if (metricIndex === undefined) return [];
      const values = new Array<number>(xKeys.length).fill(0);
      for (const row of result.rows) {
        const position = xPosition.get(identity(row, xIndex, xKeyIndex));
        if (position !== undefined) values[position] += toNumber(row[metricIndex]);
      }
      return [{ id: metric.key, metric, groupValue: null, values }];
    });
    return { x, xValues, xKeys: xHidden, seriesColumn: null, series, otherCount: 0 };
  }

  const metric = metrics[0];
  const seriesIndex = index.get(seriesColumn.key);
  const seriesKeyIndex = index.get(`${seriesColumn.key}__key`);
  const metricIndex = index.get(metric.key);
  if (seriesIndex === undefined || metricIndex === undefined) return empty;

  const byGroup = new Map<string, ChartSeries>();
  for (const row of result.rows) {
    const groupKey = identity(row, seriesIndex, seriesKeyIndex);
    let entry = byGroup.get(groupKey);
    if (!entry) {
      entry = {
        id: groupKey,
        metric,
        groupValue: row[seriesIndex],
        ...(seriesKeyIndex !== undefined ? { groupKey: row[seriesKeyIndex] } : {}),
        values: new Array<number>(xKeys.length).fill(0),
      };
      byGroup.set(groupKey, entry);
    }
    const position = xPosition.get(identity(row, xIndex, xKeyIndex));
    if (position !== undefined) entry.values[position] += toNumber(row[metricIndex]);
  }

  let series = Array.from(byGroup.values());
  let otherCount = 0;
  if (series.length > MAX_SERIES) {
    const total = (entry: ChartSeries) => entry.values.reduce((sum, v) => sum + Math.abs(v), 0);
    const ranked = [...series].sort((a, b) => total(b) - total(a));
    const kept = new Set(ranked.slice(0, MAX_SERIES - 1));
    const folded = ranked.slice(MAX_SERIES - 1);
    otherCount = folded.length;
    const other: ChartSeries = {
      id: OTHER_SERIES_ID,
      metric,
      groupValue: null,
      values: xKeys.map((_, position) =>
        folded.reduce((sum, entry) => sum + entry.values[position], 0)
      ),
    };
    series = [...series.filter((entry) => kept.has(entry)), other];
  }
  return { x, xValues, xKeys: xHidden, seriesColumn, series, otherCount };
}
