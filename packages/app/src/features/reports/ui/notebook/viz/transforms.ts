/**
 * Pure result → chart-data transforms for the notebook visualizations
 * (pivot, waterfall, sankey, calendar heatmap, number with trend, scatter,
 * bar sort / top N, row-chart auto pick). No React, no formatting: views
 * format the raw values they get back.
 */
import {
  visualizationBlocker,
  type DisplaySort,
  type QuestionColumn,
  type QuestionSpec,
  type ResolvedVisualization,
} from '@features/reports/lib/question';
import { resultsToCsv } from '@shared/lib/sql/csv';
import type { QueryResult } from '@shared/lib/sql/report-query-executor';
import { OTHER_SERIES_ID, type ChartModel } from '../chart-model';

/** Raw value standing for the folded "Other" bucket (x value, pivot / sankey node). */
export const OTHER_VALUE = OTHER_SERIES_ID;

export function isOther(value: unknown): boolean {
  return value === OTHER_VALUE;
}

function toNumber(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function columnIndex(result: QueryResult): Map<string, number> {
  return new Map(result.columns.map((name, position) => [name, position]));
}

function isDateColumn(column: QuestionColumn | undefined | null): boolean {
  return column?.kind === 'breakout' && column.breakout.bucket !== undefined;
}

/** Date parts and numeric bins: categories with a natural numeric order. */
function isNumberOrderedColumn(column: QuestionColumn | undefined | null): boolean {
  return (
    column?.kind === 'breakout' &&
    (column.breakout.part !== undefined || column.breakout.bin !== undefined)
  );
}

const keyOf = (value: unknown) => String(value ?? '');

/**
 * The metrics a chart plots: "previous period" / "% change" columns derive
 * from a metric and never stand in for one.
 */
function baseMetrics(columns: QuestionColumn[]): QuestionColumn[] {
  return columns.filter((column) => column.kind === 'aggregation' && !column.derived);
}

/** Position of a grouping's hidden id column (`<key>__key`); undefined for dates or when absent. */
function hiddenKeyIndex(index: Map<string, number>, column: QuestionColumn): number | undefined {
  return isDateColumn(column) ? undefined : index.get(`${column.key}__key`);
}

/**
 * Identity of a grouping value in a row: hidden id plus label when the result
 * has ids (two same-named categories stay apart), else the label.
 */
function identityOf(row: unknown[], valueIndex: number, keyIndex: number | undefined): string {
  const value = keyOf(row[valueIndex]);
  return keyIndex === undefined ? value : `${keyOf(row[keyIndex])}\u0000${value}`;
}

// ---------------------------------------------------------------------------
// Bar / row: sort categories, keep the top N
// ---------------------------------------------------------------------------

export interface CategoryDisplayModel extends ChartModel {
  /** Categories folded into the "Other" x value, 0 when none. */
  otherXCount: number;
}

/**
 * Sorts category x values by their total across series and folds everything
 * past the N largest (by absolute total) into one "Other" x value. Date axes
 * are left alone (they always read left to right).
 */
export function applyCategoryDisplay(
  model: ChartModel,
  options: { sort?: DisplaySort; topN?: number }
): CategoryDisplayModel {
  if (!model.x || isDateColumn(model.x) || model.series.length === 0) {
    return { ...model, otherXCount: 0 };
  }
  const totals = model.xValues.map((_, index) =>
    model.series.reduce((sum, series) => sum + (series.values[index] ?? 0), 0)
  );
  let order = model.xValues.map((_, index) => index);
  if (options.sort) {
    const sign = options.sort === 'asc' ? 1 : -1;
    order = [...order].sort((a, b) => sign * (totals[a] - totals[b]));
  }
  let otherXCount = 0;
  let folded: number[] = [];
  if (options.topN && order.length > options.topN) {
    const ranked = [...order].sort((a, b) => Math.abs(totals[b]) - Math.abs(totals[a]));
    const keep = new Set(ranked.slice(0, options.topN));
    folded = order.filter((index) => !keep.has(index));
    order = order.filter((index) => keep.has(index));
    otherXCount = folded.length;
  }
  const xValues = order.map((index) => model.xValues[index]);
  // Keys move with their values, or a click would drill into another category.
  const xKeys = order.map((index) => model.xKeys[index]);
  if (otherXCount > 0) {
    xValues.push(OTHER_VALUE);
    xKeys.push(undefined);
  }
  const series = model.series.map((entry) => {
    const values = order.map((index) => entry.values[index] ?? 0);
    if (otherXCount > 0) {
      values.push(folded.reduce((sum, index) => sum + (entry.values[index] ?? 0), 0));
    }
    return { ...entry, values };
  });
  return { ...model, xValues, xKeys, series, otherXCount };
}

/** Horizontal bars read better for many or long category names. */
export function preferRowChart(labels: string[]): boolean {
  if (labels.length > 12) return true;
  return labels.some((label) => label.length > 16);
}

/**
 * The auto choice once rows are in: an auto bar chart becomes a row chart
 * when its categories are many or long. Explicit choices are kept.
 */
export function refineAutoVisualization(
  spec: QuestionSpec,
  visualization: ResolvedVisualization,
  result: QueryResult,
  columns: QuestionColumn[]
): ResolvedVisualization {
  if (spec.visualization !== 'auto' || visualization !== 'bar') return visualization;
  if (visualizationBlocker(spec, 'row')) return visualization;
  const first = columns.find((column) => column.kind === 'breakout');
  const position = first ? columnIndex(result).get(first.key) : undefined;
  if (position === undefined) return visualization;
  const labels = new Set(result.rows.map((row) => keyOf(row[position])));
  return preferRowChart(Array.from(labels)) ? 'row' : visualization;
}

// ---------------------------------------------------------------------------
// Pivot table
// ---------------------------------------------------------------------------

export interface PivotHeader {
  /** Identity of the value (hidden id + label when the result has ids). */
  key: string;
  value: unknown;
  /** Hidden id / raw key of the value (drill-through); undefined when the result has none. */
  id?: unknown;
  total: number;
}

export interface Pivot {
  rowColumn: QuestionColumn;
  colColumn: QuestionColumn;
  metric: QuestionColumn;
  rows: PivotHeader[];
  cols: PivotHeader[];
  /** `cells[rowKey][colKey]`; missing = no rows for that pair. */
  cells: Record<string, Record<string, number>>;
  grandTotal: number;
}

/** Rows = first grouping, columns = second grouping, cells = first metric. */
export function buildPivot(result: QueryResult, columns: QuestionColumn[]): Pivot | null {
  const breakouts = columns.filter((column) => column.kind === 'breakout');
  const [metric] = baseMetrics(columns);
  const [rowColumn, colColumn] = breakouts;
  if (!rowColumn || !colColumn || !metric) return null;
  const index = columnIndex(result);
  const rowIndex = index.get(rowColumn.key);
  const colIndex = index.get(colColumn.key);
  const metricIndex = index.get(metric.key);
  if (rowIndex === undefined || colIndex === undefined || metricIndex === undefined) return null;
  const rowIdIndex = hiddenKeyIndex(index, rowColumn);
  const colIdIndex = hiddenKeyIndex(index, colColumn);
  const header = (
    row: unknown[],
    valueIndex: number,
    idIndex: number | undefined,
    key: string
  ) => ({
    key,
    value: row[valueIndex],
    ...(idIndex !== undefined ? { id: row[idIndex] } : {}),
    total: 0,
  });

  const rows = new Map<string, PivotHeader>();
  const cols = new Map<string, PivotHeader>();
  const cells: Pivot['cells'] = {};
  let grandTotal = 0;
  for (const row of result.rows) {
    const rowKey = identityOf(row, rowIndex, rowIdIndex);
    const colKey = identityOf(row, colIndex, colIdIndex);
    const value = toNumber(row[metricIndex]);
    if (!rows.has(rowKey)) rows.set(rowKey, header(row, rowIndex, rowIdIndex, rowKey));
    if (!cols.has(colKey)) cols.set(colKey, header(row, colIndex, colIdIndex, colKey));
    rows.get(rowKey)!.total += value;
    cols.get(colKey)!.total += value;
    cells[rowKey] ??= {};
    cells[rowKey][colKey] = (cells[rowKey][colKey] ?? 0) + value;
    grandTotal += value;
  }
  const byKey = (a: PivotHeader, b: PivotHeader) => a.key.localeCompare(b.key);
  const byTotal = (a: PivotHeader, b: PivotHeader) => b.total - a.total;
  const byNumber = (a: PivotHeader, b: PivotHeader) => toNumber(a.value) - toNumber(b.value);
  const orderOf = (column: QuestionColumn) =>
    isDateColumn(column) ? byKey : isNumberOrderedColumn(column) ? byNumber : null;
  const rowList = Array.from(rows.values());
  const colList = Array.from(cols.values());
  return {
    rowColumn,
    colColumn,
    metric,
    // Date groupings read in time order; categories by size.
    rows: rowList.sort(orderOf(rowColumn) ?? (() => 0)),
    cols: colList.sort(orderOf(colColumn) ?? byTotal),
    cells,
    grandTotal,
  };
}

export interface PivotSort {
  /** 'label' = row header, 'total' = row total, otherwise a column key. */
  by: 'label' | 'total' | { column: string };
  direction: 'asc' | 'desc';
}

/** Rows ordered by label, total or one column's values. */
export function sortPivotRows(
  pivot: Pivot,
  sort: PivotSort | null,
  label: (value: unknown) => string = keyOf
): PivotHeader[] {
  if (!sort) return pivot.rows;
  const sign = sort.direction === 'asc' ? 1 : -1;
  const { by } = sort;
  const valueOf = (row: PivotHeader): number =>
    by === 'total' ? row.total : by === 'label' ? 0 : (pivot.cells[row.key]?.[by.column] ?? 0);
  return [...pivot.rows].sort((a, b) => {
    if (by === 'label') {
      // Date buckets sort by their ISO key, everything else by its shown label.
      const left = isDateColumn(pivot.rowColumn) ? a.key : label(a.value);
      const right = isDateColumn(pivot.rowColumn) ? b.key : label(b.value);
      return sign * left.localeCompare(right);
    }
    return sign * (valueOf(a) - valueOf(b));
  });
}

/**
 * The pivot as a table for the CSV writer: header row, one line per row with
 * its total, a totals line. Numbers stay raw; labels come from `labels`.
 */
export function pivotToTable(
  pivot: Pivot,
  rows: PivotHeader[],
  labels: {
    corner: string;
    total: string;
    row: (value: unknown) => string;
    col: (value: unknown) => string;
  }
): { columns: string[]; rows: unknown[][] } {
  return {
    columns: [labels.corner, ...pivot.cols.map((col) => labels.col(col.value)), labels.total],
    rows: [
      ...rows.map((row) => [
        labels.row(row.value),
        ...pivot.cols.map((col) => {
          const value = pivot.cells[row.key]?.[col.key];
          return value === undefined ? null : round(value);
        }),
        round(row.total),
      ]),
      [labels.total, ...pivot.cols.map((col) => round(col.total)), round(pivot.grandTotal)],
    ],
  };
}

/** The pivot as CSV (see pivotToTable). */
export function pivotToCsv(
  pivot: Pivot,
  rows: PivotHeader[],
  labels: Parameters<typeof pivotToTable>[2]
): string {
  const table = pivotToTable(pivot, rows, labels);
  return resultsToCsv(table.columns, table.rows);
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

// ---------------------------------------------------------------------------
// Waterfall
// ---------------------------------------------------------------------------

export interface WaterfallStep {
  /** Raw grouping value, or OTHER_VALUE. */
  value: unknown;
  amount: number;
  /** Running total before / after this step. */
  start: number;
  end: number;
}

export interface Waterfall {
  steps: WaterfallStep[];
  total: number;
  otherCount: number;
}

/**
 * Start (0) → one step per grouping value → total. Dates keep time order;
 * categories go positive (income) largest first, then negative (spending)
 * largest first, so the bars climb and then fall. Past `topN` steps the
 * smallest fold into "Other", just before the total.
 */
export function buildWaterfall(model: ChartModel, topN?: number): Waterfall {
  const series = model.series[0];
  if (!model.x || !series) return { steps: [], total: 0, otherCount: 0 };
  let entries = model.xValues.map((value, index) => ({ value, amount: series.values[index] ?? 0 }));
  entries = entries.filter((entry) => entry.amount !== 0);
  let otherCount = 0;
  let otherAmount = 0;
  if (topN && entries.length > topN) {
    const ranked = [...entries].sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
    const keep = new Set(ranked.slice(0, topN));
    const folded = entries.filter((entry) => !keep.has(entry));
    otherCount = folded.length;
    otherAmount = folded.reduce((sum, entry) => sum + entry.amount, 0);
    entries = entries.filter((entry) => keep.has(entry));
  }
  if (!isDateColumn(model.x) && !isNumberOrderedColumn(model.x)) {
    entries = [
      ...entries.filter((entry) => entry.amount > 0).sort((a, b) => b.amount - a.amount),
      ...entries.filter((entry) => entry.amount < 0).sort((a, b) => a.amount - b.amount),
    ];
  }
  if (otherCount > 0) entries.push({ value: OTHER_VALUE, amount: otherAmount });
  let running = 0;
  const steps = entries.map((entry) => {
    const start = running;
    running += entry.amount;
    return { value: entry.value, amount: entry.amount, start, end: running };
  });
  return { steps, total: running, otherCount };
}

// ---------------------------------------------------------------------------
// Sankey
// ---------------------------------------------------------------------------

export interface SankeyNode {
  /** Unique across both levels (`0:` / `1:` prefix). */
  id: string;
  level: 0 | 1;
  /** Raw grouping value, or OTHER_VALUE. */
  value: unknown;
  /** Hidden id / raw key of the value; undefined when the result has none. */
  key?: unknown;
  total: number;
}

export interface SankeyLink {
  source: string;
  target: string;
  value: number;
}

export interface SankeyData {
  from: QuestionColumn;
  to: QuestionColumn;
  metric: QuestionColumn;
  nodes: SankeyNode[];
  links: SankeyLink[];
  /** Values folded into "Other" per level. */
  otherCounts: [number, number];
}

export const DEFAULT_SANKEY_TOP_N = 10;

/**
 * First grouping → second grouping, weighted by the first metric's absolute
 * value. Each side keeps its `topN` largest values; the rest become "Other".
 */
export function buildSankey(
  result: QueryResult,
  columns: QuestionColumn[],
  topN = DEFAULT_SANKEY_TOP_N
): SankeyData | null {
  const breakouts = columns.filter((column) => column.kind === 'breakout');
  const [metric] = baseMetrics(columns);
  const [from, to] = breakouts;
  if (!from || !to || !metric) return null;
  const index = columnIndex(result);
  const fromIndex = index.get(from.key);
  const toIndex = index.get(to.key);
  const metricIndex = index.get(metric.key);
  if (fromIndex === undefined || toIndex === undefined || metricIndex === undefined) return null;
  const fromIdIndex = hiddenKeyIndex(index, from);
  const toIdIndex = hiddenKeyIndex(index, to);

  interface End {
    value: unknown;
    identity: string;
    key?: unknown;
  }
  const end = (row: unknown[], valueIndex: number, idIndex: number | undefined): End => ({
    value: row[valueIndex],
    identity: identityOf(row, valueIndex, idIndex),
    ...(idIndex !== undefined ? { key: row[idIndex] } : {}),
  });
  const raw = result.rows
    .map((row) => ({
      from: end(row, fromIndex, fromIdIndex),
      to: end(row, toIndex, toIdIndex),
      value: Math.abs(toNumber(row[metricIndex])),
    }))
    .filter((entry) => entry.value > 0);

  const keepTop = (pick: (entry: (typeof raw)[number]) => End) => {
    const totals = new Map<string, number>();
    for (const entry of raw) {
      const key = pick(entry).identity;
      totals.set(key, (totals.get(key) ?? 0) + entry.value);
    }
    const ranked = Array.from(totals.entries()).sort((a, b) => b[1] - a[1]);
    return {
      keep: new Set(ranked.slice(0, topN).map(([key]) => key)),
      folded: Math.max(0, ranked.length - topN),
    };
  };
  const left = keepTop((entry) => entry.from);
  const right = keepTop((entry) => entry.to);

  const nodes = new Map<string, SankeyNode>();
  const links = new Map<string, SankeyLink>();
  const node = (level: 0 | 1, side: End, kept: Set<string>, amount: number) => {
    const folded = !kept.has(side.identity);
    const id = `${level}:${folded ? OTHER_VALUE : side.identity}`;
    const existing = nodes.get(id);
    if (existing) existing.total += amount;
    else if (folded) nodes.set(id, { id, level, value: OTHER_VALUE, total: amount });
    else {
      nodes.set(id, {
        id,
        level,
        value: side.value,
        ...(side.key !== undefined ? { key: side.key } : {}),
        total: amount,
      });
    }
    return id;
  };
  for (const entry of raw) {
    const source = node(0, entry.from, left.keep, entry.value);
    const target = node(1, entry.to, right.keep, entry.value);
    const key = `${source}\u0000${target}`;
    const link = links.get(key);
    if (link) link.value += entry.value;
    else links.set(key, { source, target, value: entry.value });
  }
  const ordered = Array.from(nodes.values()).sort(
    (a, b) =>
      a.level - b.level || Number(isOther(a.value)) - Number(isOther(b.value)) || b.total - a.total
  );
  return {
    from,
    to,
    metric,
    nodes: ordered,
    links: Array.from(links.values()),
    otherCounts: [left.folded, right.folded],
  };
}

// ---------------------------------------------------------------------------
// Calendar heatmap
// ---------------------------------------------------------------------------

export interface CalendarYear {
  year: number;
  /** [ISO day, value] for days with rows. */
  days: [string, number][];
  min: number;
  max: number;
  total: number;
}

/** Daily values (first metric) per calendar year, newest year first. */
export function buildCalendar(result: QueryResult, columns: QuestionColumn[]): CalendarYear[] {
  const day = columns.find((column) => column.kind === 'breakout');
  const [metric] = baseMetrics(columns);
  if (!day || !metric) return [];
  const index = columnIndex(result);
  const dayIndex = index.get(day.key);
  const metricIndex = index.get(metric.key);
  if (dayIndex === undefined || metricIndex === undefined) return [];

  const byDay = new Map<string, number>();
  for (const row of result.rows) {
    const iso = keyOf(row[dayIndex]);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) continue;
    byDay.set(iso, (byDay.get(iso) ?? 0) + toNumber(row[metricIndex]));
  }
  const years = new Map<number, CalendarYear>();
  for (const [iso, value] of Array.from(byDay.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
    const year = Number(iso.slice(0, 4));
    let entry = years.get(year);
    if (!entry) {
      entry = { year, days: [], min: value, max: value, total: 0 };
      years.set(year, entry);
    }
    entry.days.push([iso, value]);
    entry.min = Math.min(entry.min, value);
    entry.max = Math.max(entry.max, value);
    entry.total += value;
  }
  return Array.from(years.values()).sort((a, b) => b.year - a.year);
}

// ---------------------------------------------------------------------------
// Number with trend
// ---------------------------------------------------------------------------

export interface TrendPoint {
  /** Raw date bucket. */
  x: unknown;
  value: number;
}

export interface TrendData {
  metric: QuestionColumn;
  /** Date buckets in time order; empty without a date grouping. */
  points: TrendPoint[];
  current: number;
  /** Previous bucket's value; null when there is none. */
  previous: number | null;
  /** The bucket `current` belongs to (null without a date grouping). */
  currentX: unknown;
  previousX: unknown;
}

/** A metric's latest bucket vs the one before (date grouping) or its single value. */
export function buildTrend(
  result: QueryResult,
  metric: QuestionColumn,
  model: ChartModel
): TrendData | null {
  if (metric.kind !== 'aggregation') return null;
  const series = model.series.find((entry) => entry.metric.key === metric.key);
  if (model.x && series && series.values.length > 0) {
    const points = model.xValues.map((x, position) => ({ x, value: series.values[position] }));
    const last = points[points.length - 1];
    const before = points.length > 1 ? points[points.length - 2] : null;
    return {
      metric,
      points,
      current: last.value,
      previous: before?.value ?? null,
      currentX: last.x,
      previousX: before?.x ?? null,
    };
  }
  const index = columnIndex(result).get(metric.key);
  if (index === undefined || result.rows.length === 0) return null;
  return {
    metric,
    points: [],
    current: toNumber(result.rows[0][index]),
    previous: null,
    currentX: null,
    previousX: null,
  };
}

/** Change from `previous` to `current`; ratio is null when previous is 0. */
export function trendChange(
  current: number,
  previous: number
): { delta: number; ratio: number | null } {
  const delta = current - previous;
  return { delta, ratio: previous === 0 ? null : delta / Math.abs(previous) };
}

// ---------------------------------------------------------------------------
// Scatter
// ---------------------------------------------------------------------------

export interface ScatterPoint {
  /** Raw grouping values of the row (first, and second when present). */
  labels: unknown[];
  x: number;
  y: number;
}

export interface ScatterData {
  groupings: QuestionColumn[];
  xMetric: QuestionColumn;
  yMetric: QuestionColumn;
  points: ScatterPoint[];
}

/** One point per result row: first metric across, second metric up. */
export function buildScatter(result: QueryResult, columns: QuestionColumn[]): ScatterData | null {
  const groupings = columns.filter((column) => column.kind === 'breakout');
  const [xMetric, yMetric] = baseMetrics(columns);
  if (!xMetric || !yMetric) return null;
  const index = columnIndex(result);
  const xIndex = index.get(xMetric.key);
  const yIndex = index.get(yMetric.key);
  if (xIndex === undefined || yIndex === undefined) return null;
  const groupIndexes = groupings.map((column) => index.get(column.key) ?? -1);
  return {
    groupings,
    xMetric,
    yMetric,
    points: result.rows.map((row) => ({
      labels: groupIndexes.map((position) => row[position]),
      x: toNumber(row[xIndex]),
      y: toNumber(row[yIndex]),
    })),
  };
}
