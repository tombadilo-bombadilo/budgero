/**
 * Plain-language facts about a result, computed locally from its rows
 * ("Spending in October was 12% more than in September"). Pure: the
 * sentence is put together (and translated) by ResultSummary.
 */
import { bucketRange, type QuestionColumn } from '@features/reports/lib/question';
import type { QueryResult } from '@shared/lib/sql/report-query-executor';
import { buildChartModel, OTHER_SERIES_ID } from '../chart-model';

export type ResultSummary =
  | {
      kind: 'period';
      metric: QuestionColumn;
      x: QuestionColumn;
      /** Last complete bucket and the one compared with. */
      current: { x: unknown; value: number };
      previous: { x: unknown; value: number };
      /** 'lastYear' when the question compares with the same period a year earlier. */
      against: 'previous' | 'lastYear';
      /** The current bucket is still running and was left out. */
      skippedPartial: boolean;
    }
  | {
      kind: 'largest';
      metric: QuestionColumn;
      x: QuestionColumn;
      top: { x: unknown; value: number };
      /** Share of the total, 0–1. */
      share: number;
      count: number;
    }
  | {
      kind: 'largestInPeriod';
      metric: QuestionColumn;
      x: QuestionColumn;
      series: QuestionColumn;
      period: unknown;
      top: { group: unknown; value: number };
      /** The same group's value in the period before, when there is one. */
      before: { period: unknown; value: number } | null;
    };

/** Whether a date bucket value ends before `today` (ISO). */
export function isCompleteBucket(column: QuestionColumn, value: unknown, today: string): boolean {
  if (column.kind !== 'breakout' || !column.breakout.bucket) return true;
  const range = bucketRange(column.breakout.bucket, value);
  return range ? range[1] < today : true;
}

function isTimeColumn(column: QuestionColumn | null): boolean {
  return column?.kind === 'breakout' && column.breakout.bucket !== undefined;
}

/** Index of the last complete bucket (the running one is left out when there is an earlier one). */
function lastCompleteIndex(x: QuestionColumn, xValues: unknown[], today: string) {
  let index = xValues.length - 1;
  let skipped = false;
  if (index > 0 && !isCompleteBucket(x, xValues[index], today)) {
    index -= 1;
    skipped = true;
  }
  return { index, skipped };
}

export function summarizeResult(
  result: QueryResult,
  columns: QuestionColumn[],
  today: string
): ResultSummary | null {
  if (result.rows.length === 0) return null;
  const model = buildChartModel(result, columns);
  const { x } = model;
  if (!x || model.series.length === 0) return null;
  const { metric } = model.series[0];
  // Shares and running totals don't read as plain amounts.
  if (metric.kind !== 'aggregation' || metric.aggregation.modifier) return null;
  // Day against the day before is noise, not a story.
  if (x.kind === 'breakout' && x.breakout.bucket === 'day') return null;

  if (isTimeColumn(x) && !model.seriesColumn) {
    const series = model.series[0];
    const { index, skipped } = lastCompleteIndex(x, model.xValues, today);
    if (index < 0) return null;
    const lastYear = model.series.find(
      (entry) =>
        entry.metric.kind === 'aggregation' &&
        entry.metric.derived === 'previous' &&
        entry.metric.compareTo === 'lastYear' &&
        entry.metric.aggregation === metric.aggregation
    );
    if (lastYear) {
      return {
        kind: 'period',
        metric,
        x,
        current: { x: model.xValues[index], value: series.values[index] },
        previous: { x: null, value: lastYear.values[index] },
        against: 'lastYear',
        skippedPartial: skipped,
      };
    }
    if (index < 1) return null;
    return {
      kind: 'period',
      metric,
      x,
      current: { x: model.xValues[index], value: series.values[index] },
      previous: { x: model.xValues[index - 1], value: series.values[index - 1] },
      against: 'previous',
      skippedPartial: skipped,
    };
  }

  if (!isTimeColumn(x) && !model.seriesColumn) {
    const { values } = model.series[0];
    const total = values.reduce((sum, value) => sum + value, 0);
    // A share of a total only means something when everything points one way.
    if (values.length < 2 || values.some((value) => value < 0) || total <= 0) return null;
    let top = 0;
    values.forEach((value, position) => {
      if (value > values[top]) top = position;
    });
    return {
      kind: 'largest',
      metric,
      x,
      top: { x: model.xValues[top], value: values[top] },
      share: values[top] / total,
      count: values.length,
    };
  }

  if (isTimeColumn(x) && model.seriesColumn) {
    const { index } = lastCompleteIndex(x, model.xValues, today);
    if (index < 0) return null;
    const candidates = model.series.filter((entry) => entry.id !== OTHER_SERIES_ID);
    if (candidates.length < 2) return null;
    let best = candidates[0];
    for (const entry of candidates) {
      if ((entry.values[index] ?? 0) > (best.values[index] ?? 0)) best = entry;
    }
    if ((best.values[index] ?? 0) <= 0) return null;
    return {
      kind: 'largestInPeriod',
      metric,
      x,
      series: model.seriesColumn,
      period: model.xValues[index],
      top: { group: best.groupValue, value: best.values[index] },
      before:
        index > 0 ? { period: model.xValues[index - 1], value: best.values[index - 1] } : null,
    };
  }
  return null;
}

/** Relative change, null when there's nothing to compare with. */
export function changeRatio(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return (current - previous) / Math.abs(previous);
}

/**
 * Whether changes of a metric read as "% more / less" (amounts and counts)
 * or as a plain difference (rates and other computed numbers, where a % of a
 * % confuses).
 */
export function changesAsPercent(metric: QuestionColumn): boolean {
  if (metric.kind !== 'aggregation') return false;
  if (metric.format) return metric.format === 'money';
  return metric.aggregation.op !== 'custom';
}
