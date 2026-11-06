/**
 * The notebook question spec: { source, filters[], aggregations[],
 * breakouts[], sort[], limit, visualization }. `normalizeQuestion` turns any
 * untrusted input (a saved header, a half-edited notebook) into a valid spec
 * and never throws.
 */
import {
  DATE_BUCKETS,
  DEFAULT_RAW_COLUMNS,
  PRIMARY_DATE_FIELD,
  QUESTION_SOURCES,
  getField,
  type DateBucket,
  type FieldDef,
  type QuestionSource,
} from './fields';

export const FILTER_OPS = [
  'is',
  'isNot',
  'contains',
  'startsWith',
  'gt',
  'lt',
  'between',
  'isEmpty',
  'notEmpty',
  'previous',
  'current',
  'before',
  'after',
] as const;
export type FilterOp = (typeof FILTER_OPS)[number];

export const RELATIVE_UNITS = ['day', 'week', 'month', 'quarter', 'year'] as const;
export type RelativeUnit = (typeof RELATIVE_UNITS)[number];

export type FilterValue = string | number | boolean;

export interface QuestionFilter {
  field: string;
  op: FilterOp;
  values: FilterValue[];
  /** `previous` filters: how many units back. */
  amount?: number;
  /** `previous` / `current` filters. */
  unit?: RelativeUnit;
  /** `previous` filters: count the current (partial) unit as one of them. */
  includeCurrent?: boolean;
}

export const AGGREGATION_OPS = [
  'count',
  'sum',
  'avg',
  'min',
  'max',
  'distinct',
  'spending',
  'income',
  'net',
  'averageSpending',
] as const;
export type AggregationOp = (typeof AGGREGATION_OPS)[number];

/** Budget-meaning metrics, only on the Transactions source. */
export const FRIENDLY_AGGREGATIONS = ['spending', 'income', 'net', 'averageSpending'] as const;
/** Ops that take a numeric field. */
export const NUMERIC_AGGREGATIONS = ['sum', 'avg', 'min', 'max'] as const;

export interface QuestionAggregation {
  op: AggregationOp;
  field?: string;
}

export interface QuestionBreakout {
  field: string;
  bucket?: DateBucket;
}

export interface QuestionSort {
  /** Output column key (see `questionColumns`). */
  column: string;
  direction: 'asc' | 'desc';
}

export const VISUALIZATIONS = ['auto', 'number', 'line', 'bar', 'area', 'pie', 'table'] as const;
export type Visualization = (typeof VISUALIZATIONS)[number];
export type ResolvedVisualization = Exclude<Visualization, 'auto'>;

/** How bar/area series combine: side by side, stacked, or stacked to 100%. */
export const STACKINGS = ['auto', 'none', 'stacked', 'percent'] as const;
export type Stacking = (typeof STACKINGS)[number];
export type ResolvedStacking = Exclude<Stacking, 'auto'>;

export interface QuestionSpec {
  v: 2;
  source: QuestionSource;
  filters: QuestionFilter[];
  aggregations: QuestionAggregation[];
  breakouts: QuestionBreakout[];
  sort: QuestionSort[];
  limit: number | null;
  /** Raw-mode column picker; null = the source's default columns. */
  columns: string[] | null;
  visualization: Visualization;
  /** Bar/area only; 'auto' stacks a second grouping and keeps several metrics side by side. */
  stacking: Stacking;
}

export const MAX_QUESTION_LIMIT = 10_000;
export const MAX_FILTERS = 30;
export const MAX_AGGREGATIONS = 6;
export const MAX_BREAKOUTS = 3;
const MAX_VALUES = 500;
const MAX_TEXT = 500;

/** Filters a fresh Transactions question starts with (removable chips). */
export function defaultSourceFilters(source: QuestionSource): QuestionFilter[] {
  if (source !== 'transactions') return [];
  return [
    { field: 'is_transfer', op: 'is', values: [false] },
    { field: 'on_budget', op: 'is', values: [true] },
  ];
}

export function createQuestion(
  source: QuestionSource = 'transactions',
  overrides: Partial<Omit<QuestionSpec, 'v' | 'source'>> = {}
): QuestionSpec {
  return normalizeQuestion({
    v: 2,
    source,
    filters: defaultSourceFilters(source),
    aggregations: [],
    breakouts: [],
    sort: [],
    limit: null,
    columns: null,
    visualization: 'auto',
    stacking: 'auto',
    ...overrides,
  });
}

/** Operators offered for a field type. */
export function operatorsFor(field: FieldDef): FilterOp[] {
  switch (field.type) {
    case 'date':
      return ['previous', 'current', 'between', 'before', 'after', 'is', 'isEmpty', 'notEmpty'];
    case 'number':
      return ['is', 'isNot', 'gt', 'lt', 'between', 'isEmpty', 'notEmpty'];
    case 'boolean':
      return ['is'];
    case 'entity':
    case 'text':
      return ['is', 'isNot', 'contains', 'startsWith', 'isEmpty', 'notEmpty'];
  }
}

export function isFriendlyAggregation(op: AggregationOp): boolean {
  return (FRIENDLY_AGGREGATIONS as readonly string[]).includes(op);
}

export function aggregationNeedsField(op: AggregationOp): boolean {
  return (NUMERIC_AGGREGATIONS as readonly string[]).includes(op) || op === 'distinct';
}

// ---------------------------------------------------------------------------
// Value validation
// ---------------------------------------------------------------------------

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (month < 1 || month > 12 || day < 1) return false;
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'boolean' || value === null || value === undefined || value === '') {
    return null;
  }
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function cleanText(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const trimmed = String(value).trim();
  return trimmed.length > 0 && trimmed.length <= MAX_TEXT ? trimmed : null;
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function oneOf<T extends string>(options: readonly T[], value: unknown): T | null {
  return typeof value === 'string' && (options as readonly string[]).includes(value)
    ? (value as T)
    : null;
}

/** Valid filter or null (dropped). */
export function normalizeFilter(source: QuestionSource, input: unknown): QuestionFilter | null {
  const raw = asRecord(input);
  if (!raw) return null;
  const field = typeof raw.field === 'string' ? getField(source, raw.field) : undefined;
  const op = oneOf(FILTER_OPS, raw.op);
  if (!field || !op || !operatorsFor(field).includes(op)) return null;

  const base = { field: field.id, op };
  const rawValues = asArray(raw.values).slice(0, MAX_VALUES);

  if (op === 'isEmpty' || op === 'notEmpty') return { ...base, values: [] };

  if (field.type === 'boolean') {
    const value = rawValues[0];
    return typeof value === 'boolean' ? { ...base, values: [value] } : null;
  }

  if (field.type === 'date') {
    if (op === 'previous' || op === 'current') {
      const unit = oneOf(RELATIVE_UNITS, raw.unit);
      if (!unit) return null;
      if (op === 'current') return { ...base, values: [], unit };
      const amount = toFiniteNumber(raw.amount);
      if (amount === null || amount < 1) return null;
      return {
        ...base,
        values: [],
        unit,
        amount: Math.min(Math.floor(amount), 1000),
        includeCurrent: raw.includeCurrent !== false,
      };
    }
    const dates = rawValues.filter(isValidIsoDate);
    if (op === 'between') {
      if (dates.length < 2) return null;
      const [from, to] = dates[0] <= dates[1] ? [dates[0], dates[1]] : [dates[1], dates[0]];
      return { ...base, values: [from, to] };
    }
    return dates.length > 0 ? { ...base, values: [dates[0]] } : null;
  }

  if (field.type === 'number') {
    const numbers = rawValues.map(toFiniteNumber).filter((value) => value !== null);
    if (op === 'between') {
      if (numbers.length < 2) return null;
      const [low, high] = numbers[0] <= numbers[1] ? numbers : [numbers[1], numbers[0]];
      return { ...base, values: [low, high] };
    }
    if (op === 'gt' || op === 'lt') {
      return numbers.length > 0 ? { ...base, values: [numbers[0]] } : null;
    }
    const values = unique(numbers);
    return values.length > 0 ? { ...base, values } : null;
  }

  // entity / text
  if (op === 'contains' || op === 'startsWith') {
    const value = cleanText(rawValues[0]);
    return value ? { ...base, values: [value] } : null;
  }
  if (field.type === 'entity' && field.idKeyed) {
    const ids = unique(
      rawValues
        .map((value) => toFiniteNumber(value))
        .filter(
          (value): value is number => value !== null && Number.isSafeInteger(value) && value > 0
        )
    );
    return ids.length > 0 ? { ...base, values: ids } : null;
  }
  const names = unique(rawValues.map(cleanText).filter((value): value is string => value !== null));
  return names.length > 0 ? { ...base, values: names } : null;
}

export function normalizeAggregation(
  source: QuestionSource,
  input: unknown
): QuestionAggregation | null {
  const raw = asRecord(input);
  if (!raw) return null;
  const op = oneOf(AGGREGATION_OPS, raw.op);
  if (!op) return null;
  if (isFriendlyAggregation(op)) return source === 'transactions' ? { op } : null;
  if (op === 'count') return { op };
  const field = typeof raw.field === 'string' ? getField(source, raw.field) : undefined;
  if (!field) return null;
  if (op === 'distinct') return { op, field: field.id };
  return field.type === 'number' ? { op, field: field.id } : null;
}

export function normalizeBreakout(source: QuestionSource, input: unknown): QuestionBreakout | null {
  const raw = asRecord(input);
  if (!raw || typeof raw.field !== 'string') return null;
  const field = getField(source, raw.field);
  if (!field || !field.groupable) return null;
  if (field.type !== 'date') return { field: field.id };
  const bucket = oneOf(DATE_BUCKETS, raw.bucket);
  return {
    field: field.id,
    bucket: bucket && field.buckets?.includes(bucket) ? bucket : (field.defaultBucket ?? 'month'),
  };
}

export function normalizeQuestion(input: unknown): QuestionSpec {
  const raw = asRecord(input) ?? {};
  const source = oneOf(QUESTION_SOURCES, raw.source) ?? 'transactions';

  const filters = asArray(raw.filters)
    .slice(0, MAX_FILTERS)
    .map((filter) => normalizeFilter(source, filter))
    .filter((filter): filter is QuestionFilter => filter !== null);

  const aggregations = asArray(raw.aggregations)
    .slice(0, MAX_AGGREGATIONS)
    .map((aggregation) => normalizeAggregation(source, aggregation))
    .filter((aggregation): aggregation is QuestionAggregation => aggregation !== null);

  const breakouts: QuestionBreakout[] = [];
  for (const candidate of asArray(raw.breakouts)) {
    const breakout = normalizeBreakout(source, candidate);
    if (!breakout) continue;
    if (breakouts.some((b) => b.field === breakout.field && b.bucket === breakout.bucket)) continue;
    breakouts.push(breakout);
    if (breakouts.length >= MAX_BREAKOUTS) break;
  }
  // Groupings without a metric count rows, like Metabase.
  if (breakouts.length > 0 && aggregations.length === 0) aggregations.push({ op: 'count' });

  const sort: QuestionSort[] = [];
  for (const candidate of asArray(raw.sort)) {
    const entry = asRecord(candidate);
    if (!entry || typeof entry.column !== 'string' || !/^[a-z0-9_]{1,64}$/.test(entry.column)) {
      continue;
    }
    if (sort.some((s) => s.column === entry.column)) continue;
    sort.push({ column: entry.column, direction: entry.direction === 'asc' ? 'asc' : 'desc' });
  }

  let limit: number | null = null;
  const rawLimit = toFiniteNumber(raw.limit);
  if (rawLimit !== null && rawLimit >= 1)
    limit = Math.min(Math.floor(rawLimit), MAX_QUESTION_LIMIT);

  let columns: string[] | null = null;
  if (Array.isArray(raw.columns)) {
    const valid = unique(
      raw.columns.filter(
        (column): column is string => typeof column === 'string' && !!getField(source, column)
      )
    );
    columns = valid.length > 0 ? valid : null;
  }

  const spec: QuestionSpec = {
    v: 2,
    source,
    filters,
    aggregations,
    breakouts,
    sort,
    limit,
    columns: aggregations.length > 0 ? null : columns,
    visualization: oneOf(VISUALIZATIONS, raw.visualization) ?? 'auto',
    stacking: oneOf(STACKINGS, raw.stacking) ?? 'auto',
  };
  // Drop sorts on columns this question doesn't output.
  const keys = new Set(questionColumnKeys(spec));
  spec.sort = spec.sort.filter((entry) => keys.has(entry.column));
  return spec;
}

// ---------------------------------------------------------------------------
// Output columns
// ---------------------------------------------------------------------------

export type QuestionColumn =
  | { key: string; kind: 'breakout'; breakout: QuestionBreakout }
  | { key: string; kind: 'aggregation'; aggregation: QuestionAggregation }
  | { key: string; kind: 'field'; field: string };

function breakoutBaseKey(source: QuestionSource, breakout: QuestionBreakout): string {
  if (!breakout.bucket) return breakout.field;
  if (breakout.field === PRIMARY_DATE_FIELD[source]) return breakout.bucket;
  return `${breakout.field}_${breakout.bucket}`;
}

function aggregationBaseKey(aggregation: QuestionAggregation): string {
  if (aggregation.op === 'count') return 'count';
  if (isFriendlyAggregation(aggregation.op)) {
    return aggregation.op === 'averageSpending' ? 'average_spending' : aggregation.op;
  }
  return `${aggregation.op}_${aggregation.field}`;
}

/** Output columns of a (normalized) question, in SELECT order. Keys are unique. */
export function questionColumns(spec: QuestionSpec): QuestionColumn[] {
  const used = new Set<string>();
  const claim = (base: string) => {
    let key = base;
    for (let n = 2; used.has(key); n += 1) key = `${base}_${n}`;
    used.add(key);
    return key;
  };

  if (spec.aggregations.length === 0) {
    const columns = spec.columns ?? DEFAULT_RAW_COLUMNS[spec.source];
    return columns.map((field) => ({ key: claim(field), kind: 'field' as const, field }));
  }
  return [
    ...spec.breakouts.map((breakout) => ({
      key: claim(breakoutBaseKey(spec.source, breakout)),
      kind: 'breakout' as const,
      breakout,
    })),
    ...spec.aggregations.map((aggregation) => ({
      key: claim(aggregationBaseKey(aggregation)),
      kind: 'aggregation' as const,
      aggregation,
    })),
  ];
}

export function questionColumnKeys(spec: QuestionSpec): string[] {
  return questionColumns(spec).map((column) => column.key);
}

// ---------------------------------------------------------------------------
// Visualization
// ---------------------------------------------------------------------------

/** Which visualizations make sense for this question's shape. */
export function allowedVisualizations(spec: QuestionSpec): ResolvedVisualization[] {
  if (spec.aggregations.length === 0) return ['table'];
  if (spec.breakouts.length === 0) return ['number', 'table'];
  const options: ResolvedVisualization[] = ['bar', 'line', 'area'];
  if (spec.breakouts.length === 1) options.push('pie');
  options.push('table');
  return options;
}

/** Auto choice: date grouping → line, one category grouping → bar, single value → number. */
export function autoVisualization(spec: QuestionSpec): ResolvedVisualization {
  if (spec.aggregations.length === 0) return 'table';
  if (spec.breakouts.length === 0) return 'number';
  const first = getField(spec.source, spec.breakouts[0].field);
  if (first?.type === 'date') return 'line';
  return 'bar';
}

/** Whether a stacking choice applies: bar/area with more than one series. */
export function canStack(spec: QuestionSpec, visualization: ResolvedVisualization): boolean {
  if (visualization !== 'bar' && visualization !== 'area') return false;
  return spec.breakouts.length >= 2 || spec.aggregations.length >= 2;
}

/**
 * Stacking for a chart. 'auto' stacks the series of a second grouping (parts
 * of one total) and keeps several metrics side by side (e.g. income vs spending).
 */
export function resolveStacking(
  spec: QuestionSpec,
  visualization: ResolvedVisualization
): ResolvedStacking {
  if (!canStack(spec, visualization)) return 'none';
  if (spec.stacking !== 'auto') return spec.stacking;
  return spec.breakouts.length >= 2 ? 'stacked' : 'none';
}

export function resolveVisualization(spec: QuestionSpec): ResolvedVisualization {
  if (spec.visualization !== 'auto' && allowedVisualizations(spec).includes(spec.visualization)) {
    return spec.visualization;
  }
  return autoVisualization(spec);
}
