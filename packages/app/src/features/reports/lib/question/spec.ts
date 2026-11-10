/**
 * The notebook question spec: { source, filters[], aggregations[],
 * breakouts[], sort[], limit, visualization }. `normalizeQuestion` turns any
 * untrusted input (a saved header, a half-edited notebook) into a valid spec
 * and never throws.
 */
import {
  DATE_BUCKETS,
  DATE_PART_RANGE,
  DEFAULT_RAW_COLUMNS,
  PRIMARY_DATE_FIELD,
  QUESTION_SOURCES,
  SOURCE_FIELDS,
  datePartsFor,
  getField,
  type DateBucket,
  type DatePart,
  type FieldDef,
  type QuestionSource,
} from './fields';
import {
  ExpressionError,
  parseExpression,
  printExpression,
  type ExprField,
  type ExprInfo,
  type ExprNode,
  type ExprValueType,
  type ParseResult,
} from './expression';

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
  /**
   * Date fields, `is` / `isNot`: compare one part of the date (values are
   * part numbers, e.g. day of week 6 and 7 = weekends). Drill-through on a
   * date-part grouping writes these.
   */
  part?: DatePart;
  /**
   * Number fields, `between`: the numeric bin [values[0], values[1]) of this
   * width, matched exactly like the binned grouping (drill-through on a bin).
   */
  binWidth?: number;
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
  'custom',
] as const;
export type AggregationOp = (typeof AGGREGATION_OPS)[number];

/** Budget-meaning metrics, only on the Transactions source. */
export const FRIENDLY_AGGREGATIONS = ['spending', 'income', 'net', 'averageSpending'] as const;
/** Ops that take a numeric field. */
export const NUMERIC_AGGREGATIONS = ['sum', 'avg', 'min', 'max'] as const;

export interface QuestionAggregation {
  op: AggregationOp;
  field?: string;
  /** `custom` metrics: display name. */
  name?: string;
  /** `custom` metrics: canonical expression text (see expression.ts). */
  expression?: string;
  /** Running total / moving average / % of total instead of the plain value. */
  modifier?: MetricModifier;
  /** Moving average window in buckets. */
  window?: number;
  /** Adds "previous period" and "% change" columns (needs a date grouping). */
  compare?: boolean;
  /** What `compare` compares with; absent = the previous bucket. */
  compareTo?: CompareOffset;
}

/**
 * Compare a date-grouped metric with the bucket before it ('previous') or
 * with the same bucket a year earlier ('lastYear', e.g. March vs last March).
 */
export const COMPARE_OFFSETS = ['previous', 'lastYear'] as const;
export type CompareOffset = (typeof COMPARE_OFFSETS)[number];

/** Numeric binning of a number grouping: a fixed bin width, or 'auto' (about 10 nice bins). */
export type NumericBin = 'auto' | number;
/** Bin widths the UI offers next to 'auto'. */
export const NUMERIC_BIN_WIDTHS = [1, 5, 10, 25, 50, 100, 250, 500, 1000, 5000] as const;
/** Bins 'auto' aims for. */
export const AUTO_BIN_COUNT = 10;
const MAX_BIN_WIDTH = 1e12;
const MIN_BIN_WIDTH = 1e-6;

export interface QuestionBreakout {
  field: string;
  /** Date fields: bucket the dates (month, week, ...). */
  bucket?: DateBucket;
  /** Date fields, instead of a bucket: group by one part of the date (e.g. day of week). */
  part?: DatePart;
  /** Number fields: group into ranges. */
  bin?: NumericBin;
}

/** Operators of a filter on a metric after aggregation ("having"). */
export const HAVING_OPS = ['gt', 'lt', 'between', 'is', 'isNot', 'isEmpty', 'notEmpty'] as const;
export type HavingOp = (typeof HAVING_OPS)[number];
export const MAX_HAVING = 10;

/** A filter on a summarized result's metric column, e.g. categories with spending > 500. */
export interface QuestionHaving {
  /** Output column key of a metric (see `questionColumns`). */
  column: string;
  op: HavingOp;
  values: number[];
}

export interface QuestionSort {
  /** Output column key (see `questionColumns`). */
  column: string;
  direction: 'asc' | 'desc';
}

export const VISUALIZATIONS = [
  'auto',
  'number',
  'line',
  'bar',
  'area',
  'pie',
  'table',
  'trend',
  'combo',
  'pivot',
  'calendar',
  'waterfall',
  'sankey',
  'scatter',
  'row',
] as const;
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
  /** Custom columns (row-level expressions); absent when there are none. */
  customColumns?: QuestionCustomColumn[];
  /** Chart settings (values on bars, goal line, ...); omitted when all default. */
  display?: QuestionDisplay;
  /** Filters on metrics after aggregation; absent when there are none. */
  having?: QuestionHaving[];
}

export const MAX_QUESTION_LIMIT = 10_000;
/** Filters the editor lets a question have. */
export const MAX_FILTERS = 30;
/**
 * Room above MAX_FILTERS for the dashboard's own filters (date, accounts,
 * category groups), so a widget at the editor's limit still takes them.
 */
const DASHBOARD_FILTER_SLOTS = 3;
const MAX_STORED_FILTERS = MAX_FILTERS + DASHBOARD_FILTER_SLOTS;
export const MAX_AGGREGATIONS = 6;
export const MAX_BREAKOUTS = 3;
const MAX_VALUES = 500;
/** Longest text value a filter keeps (long memos still match exactly). */
export const MAX_FILTER_TEXT = 10_000;

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
  return trimmed.length > 0 && trimmed.length <= MAX_FILTER_TEXT ? trimmed : null;
}

/** Whether a text value is too long to filter by (filters drop it). */
export function isFilterTextTooLong(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > MAX_FILTER_TEXT;
}

function normalizeBin(value: unknown): NumericBin | null {
  if (value === 'auto') return 'auto';
  const width = toFiniteNumber(value);
  return width !== null && width >= MIN_BIN_WIDTH && width <= MAX_BIN_WIDTH ? width : null;
}

/** Whole numbers in a date part's range, unique. */
function partValues(part: DatePart, values: unknown[]): number[] {
  const [low, high] = DATE_PART_RANGE[part];
  return unique(
    values
      .map(toFiniteNumber)
      .filter(
        (value): value is number =>
          value !== null && Number.isInteger(value) && value >= low && value <= high
      )
  );
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
export function normalizeFilter(
  source: QuestionSource,
  input: unknown,
  custom?: CustomFields
): QuestionFilter | null {
  const raw = asRecord(input);
  if (!raw) return null;
  const field = typeof raw.field === 'string' ? lookupField(source, raw.field, custom) : undefined;
  const op = oneOf(FILTER_OPS, raw.op);
  if (!field || !op) return null;
  const rawValues = asArray(raw.values).slice(0, MAX_VALUES);

  // Date part: "day of week is 6, 7".
  const part = oneOf(datePartsFor(field), raw.part);
  if (part) {
    if (op !== 'is' && op !== 'isNot') return null;
    const values = partValues(part, rawValues);
    return values.length > 0 ? { field: field.id, op, values, part } : null;
  }
  // Numeric bin: [low, high) of a bin width, from drill-through.
  if (field.type === 'number' && op === 'between' && raw.binWidth !== undefined) {
    const width = normalizeBin(raw.binWidth);
    const low = toFiniteNumber(asArray(raw.values)[0]);
    if (typeof width !== 'number' || low === null) return null;
    const index = Math.round(low / width);
    if (!Number.isSafeInteger(index)) return null;
    return { field: field.id, op, values: [index * width, (index + 1) * width], binWidth: width };
  }
  if (!operatorsFor(field).includes(op)) return null;

  const base = { field: field.id, op };

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
  input: unknown,
  custom?: CustomFields
): QuestionAggregation | null {
  const raw = asRecord(input);
  if (!raw) return null;
  const op = oneOf(AGGREGATION_OPS, raw.op);
  if (!op) return null;
  const extras = normalizeMetricOptions(raw);
  if (op === 'custom') {
    const metric = normalizeCustomMetric(source, raw, custom);
    return metric ? { ...metric, ...extras } : null;
  }
  if (isFriendlyAggregation(op)) return source === 'transactions' ? { op, ...extras } : null;
  if (op === 'count') return { op, ...extras };
  const field = typeof raw.field === 'string' ? lookupField(source, raw.field, custom) : undefined;
  if (!field) return null;
  if (op === 'distinct') return { op, field: field.id, ...extras };
  return field.type === 'number' ? { op, field: field.id, ...extras } : null;
}

export function normalizeBreakout(
  source: QuestionSource,
  input: unknown,
  custom?: CustomFields
): QuestionBreakout | null {
  const raw = asRecord(input);
  if (!raw || typeof raw.field !== 'string') return null;
  const field = lookupField(source, raw.field, custom);
  if (!field) return null;
  if (field.type === 'number') {
    const bin = normalizeBin(raw.bin);
    if (bin !== null) return { field: field.id, bin };
  }
  if (!field.groupable) return null;
  if (field.type !== 'date') return { field: field.id };
  const part = oneOf(datePartsFor(field), raw.part);
  if (part) return { field: field.id, part };
  const bucket = oneOf(DATE_BUCKETS, raw.bucket);
  return {
    field: field.id,
    bucket: bucket && field.buckets?.includes(bucket) ? bucket : (field.defaultBucket ?? 'month'),
  };
}

export function normalizeQuestion(input: unknown): QuestionSpec {
  const raw = asRecord(input) ?? {};
  const source = oneOf(QUESTION_SOURCES, raw.source) ?? 'transactions';
  const customColumns = normalizeCustomColumns(source, raw.customColumns);
  const custom = customFields(source, customColumns);

  const filters = asArray(raw.filters)
    .slice(0, MAX_STORED_FILTERS)
    .map((filter) => normalizeFilter(source, filter, custom))
    .filter((filter): filter is QuestionFilter => filter !== null);

  const aggregations = asArray(raw.aggregations)
    .slice(0, MAX_AGGREGATIONS)
    .map((aggregation) => normalizeAggregation(source, aggregation, custom))
    .filter((aggregation): aggregation is QuestionAggregation => aggregation !== null);

  const breakouts: QuestionBreakout[] = [];
  for (const candidate of asArray(raw.breakouts)) {
    const breakout = normalizeBreakout(source, candidate, custom);
    if (!breakout) continue;
    if (breakouts.some((b) => sameBreakout(b, breakout))) continue;
    breakouts.push(breakout);
    if (breakouts.length >= MAX_BREAKOUTS) break;
  }
  // Groupings without a metric count rows, like Metabase.
  if (breakouts.length > 0 && aggregations.length === 0) aggregations.push({ op: 'count' });
  dropUnusableModifiers(aggregations, breakouts);

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
        (column): column is string =>
          typeof column === 'string' && !!lookupField(source, column, custom)
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
    ...(customColumns.length > 0 ? { customColumns } : {}),
  };
  const display = normalizeDisplay(raw.display);
  if (display) spec.display = display;
  const outputs = questionColumns(spec);
  const keys = new Set(outputs.map((column) => column.key));
  // Drop sorts on columns this question doesn't output; raw rows can also
  // sort by any field of the source (shown or not).
  spec.sort = spec.sort.filter(
    (entry) =>
      keys.has(entry.column) ||
      (aggregations.length === 0 && Boolean(lookupField(source, entry.column, custom)))
  );
  const having = normalizeHaving(raw.having, outputs);
  if (having.length > 0) spec.having = having;
  return spec;
}

function sameBreakout(a: QuestionBreakout, b: QuestionBreakout): boolean {
  return a.field === b.field && a.bucket === b.bucket && a.part === b.part && a.bin === b.bin;
}

/** Metric columns a "having" filter can test. */
export function havingColumns(spec: QuestionSpec): QuestionColumn[] {
  return questionColumns(spec).filter((column) => column.kind === 'aggregation');
}

function normalizeHaving(input: unknown, columns: readonly QuestionColumn[]): QuestionHaving[] {
  const metricKeys = new Set(
    columns.filter((column) => column.kind === 'aggregation').map((column) => column.key)
  );
  const result: QuestionHaving[] = [];
  for (const candidate of asArray(input).slice(0, MAX_HAVING)) {
    const entry = normalizeHavingEntry(candidate, metricKeys);
    if (entry) result.push(entry);
  }
  return result;
}

function normalizeHavingEntry(
  input: unknown,
  metricKeys: ReadonlySet<string>
): QuestionHaving | null {
  const raw = asRecord(input);
  if (!raw || typeof raw.column !== 'string' || !metricKeys.has(raw.column)) return null;
  const op = oneOf(HAVING_OPS, raw.op);
  if (!op) return null;
  const base = { column: raw.column, op };
  if (op === 'isEmpty' || op === 'notEmpty') return { ...base, values: [] };
  const numbers = asArray(raw.values)
    .slice(0, MAX_VALUES)
    .map(toFiniteNumber)
    .filter((value): value is number => value !== null);
  if (op === 'between') {
    if (numbers.length < 2) return null;
    const [low, high] = numbers[0] <= numbers[1] ? numbers : [numbers[1], numbers[0]];
    return { ...base, values: [low, high] };
  }
  if (op === 'gt' || op === 'lt')
    return numbers.length > 0 ? { ...base, values: [numbers[0]] } : null;
  const values = unique(numbers);
  return values.length > 0 ? { ...base, values } : null;
}

// ---------------------------------------------------------------------------
// Output columns
// ---------------------------------------------------------------------------

export type QuestionColumn = (
  | { key: string; kind: 'breakout'; breakout: QuestionBreakout }
  | { key: string; kind: 'aggregation'; aggregation: QuestionAggregation }
  | { key: string; kind: 'field'; field: string }
) &
  QuestionColumnExtras;

const DATE_PART_KEYS: Record<DatePart, string> = {
  year: 'year',
  quarterOfYear: 'quarter_of_year',
  monthOfYear: 'month_of_year',
  dayOfMonth: 'day_of_month',
  dayOfWeek: 'day_of_week',
};

function breakoutBaseKey(source: QuestionSource, breakout: QuestionBreakout): string {
  if (breakout.part) return `${breakout.field}_${DATE_PART_KEYS[breakout.part]}`;
  if (breakout.bin !== undefined) return `${breakout.field}_bin`;
  if (!breakout.bucket) return breakout.field;
  if (breakout.field === PRIMARY_DATE_FIELD[source]) return breakout.bucket;
  return `${breakout.field}_${breakout.bucket}`;
}

function aggregationBaseKey(aggregation: QuestionAggregation): string {
  const plain = plainAggregationKey(aggregation);
  switch (aggregation.modifier) {
    case 'running':
      return `${plain}_running_total`;
    case 'moving':
      return `${plain}_moving_avg`;
    case 'share':
      return `${plain}_share`;
    default:
      return plain;
  }
}

function plainAggregationKey(aggregation: QuestionAggregation): string {
  if (aggregation.op === 'custom') return customMetricKey(aggregation.name);
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

  const extras = columnExtras(spec);
  if (spec.aggregations.length === 0) {
    const columns = spec.columns ?? DEFAULT_RAW_COLUMNS[spec.source];
    return columns.map((field) => ({
      key: claim(field),
      kind: 'field' as const,
      field,
      ...extras.forField(field),
    }));
  }
  return [
    ...spec.breakouts.map((breakout) => ({
      key: claim(breakoutBaseKey(spec.source, breakout)),
      kind: 'breakout' as const,
      breakout,
      ...extras.forField(breakout.field),
    })),
    ...spec.aggregations.flatMap((aggregation) => {
      const key = claim(aggregationBaseKey(aggregation));
      const metric = {
        key,
        kind: 'aggregation' as const,
        aggregation,
        ...extras.forAggregation(aggregation),
      };
      if (!aggregation.compare) return [metric];
      const lastYear = aggregation.compareTo === 'lastYear';
      const compareTo = lastYear ? { compareTo: 'lastYear' as const } : {};
      return [
        metric,
        {
          ...metric,
          key: claim(lastYear ? `${key}_last_year` : `${key}_previous`),
          derived: 'previous' as const,
          ...compareTo,
        },
        {
          ...metric,
          key: claim(lastYear ? `${key}_yoy_change` : `${key}_change`),
          derived: 'change' as const,
          format: 'percent' as const,
          ...compareTo,
        },
      ];
    }),
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
  return VISUALIZATION_ORDER.filter((visualization) => !visualizationBlocker(spec, visualization));
}

/**
 * Auto choice: single value → number, two metrics in different units (money
 * vs count) → combo, a date and a category grouping → (stacked) bar, date
 * grouping → line, category grouping → bar. The row
 * chart is picked later from the result (long labels / many bars).
 */
export function autoVisualization(spec: QuestionSpec): ResolvedVisualization {
  if (spec.aggregations.length === 0) return 'table';
  if (spec.breakouts.length === 0) return 'number';
  if (
    spec.breakouts.length === 1 &&
    spec.aggregations.length >= 2 &&
    aggregationUnit(spec.aggregations[0]) !== aggregationUnit(spec.aggregations[1])
  ) {
    return 'combo';
  }
  // A date and a category grouping: parts of each period's total, stacked.
  if (spec.breakouts.length === 2 && !isDateBreakout(spec, spec.breakouts[1])) return 'bar';
  if (isDateBreakout(spec, spec.breakouts[0])) return 'line';
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

// ---------------------------------------------------------------------------
// Custom columns, custom metrics and metric modifiers
// ---------------------------------------------------------------------------

/** A row-level expression column, referenced by its id (`expr_1`) like a field. */
export interface QuestionCustomColumn {
  id: string;
  name: string;
  /** Canonical expression text (field ids in brackets). */
  expression: string;
}

export const METRIC_MODIFIERS = ['running', 'moving', 'share'] as const;
export type MetricModifier = (typeof METRIC_MODIFIERS)[number];

export const MAX_CUSTOM_COLUMNS = 10;
export const MAX_NAME_LENGTH = 60;
export const DEFAULT_MOVING_WINDOW = 3;
export const MAX_MOVING_WINDOW = 60;
const CUSTOM_COLUMN_ID = /^expr_\d{1,3}$/;

export type ColumnFormat = 'money' | 'number' | 'text' | 'percent';

/** Output-column hints the labels / formatters use for custom and derived columns. */
export interface QuestionColumnExtras {
  /** Display name of a custom column or custom metric. */
  name?: string;
  /** Display name of the custom column a metric aggregates (e.g. Sum of <name>). */
  fieldName?: string;
  format?: ColumnFormat;
  /** Compare-to-previous-period columns. */
  derived?: 'previous' | 'change';
  /** Derived columns: what they compare with (absent = the previous bucket). */
  compareTo?: CompareOffset;
}

/** Money-valued source fields. */
export const MONEY_FIELD_IDS: ReadonlySet<string> = new Set([
  'amount',
  'inflow',
  'outflow',
  'assigned',
  'activity',
  'balance',
]);

interface CustomFieldEntry {
  column: QuestionCustomColumn;
  field: FieldDef;
  info: ExprInfo;
  ast: ExprNode;
}

/** Parsed custom columns of a question, by id, in definition order. */
export type CustomFields = ReadonlyMap<string, CustomFieldEntry>;

function exprTypeOf(field: FieldDef): ExprValueType {
  switch (field.type) {
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'date':
      return 'date';
    default:
      return 'string';
  }
}

/** A source field or custom column. */
export function lookupField(
  source: QuestionSource,
  fieldId: string,
  custom?: CustomFields
): FieldDef | undefined {
  return getField(source, fieldId) ?? custom?.get(fieldId)?.field;
}

/** Fields an expression can reference: the source's, then the custom columns given. */
export function expressionFields(
  source: QuestionSource,
  custom?: CustomFields,
  names?: (fieldId: string) => readonly string[]
): ExprField[] {
  const fields: ExprField[] = SOURCE_FIELDS[source].map((field) => ({
    id: field.id,
    type: exprTypeOf(field),
    money: MONEY_FIELD_IDS.has(field.id),
    names: names?.(field.id) ?? [],
  }));
  for (const entry of custom?.values() ?? []) {
    fields.push({
      id: entry.column.id,
      type: entry.info.type,
      money: entry.info.money,
      names: [entry.column.name],
    });
  }
  return fields;
}

function cleanName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.trim().replace(/\s+/g, ' ');
  if (!name || name.length > MAX_NAME_LENGTH || /[[\]]/.test(name)) return null;
  return name;
}

function customField(id: string, info: ExprInfo): FieldDef {
  const type = info.type === 'number' ? 'number' : info.type === 'boolean' ? 'boolean' : 'text';
  return { id, type, groupable: true };
}

/** Why a custom column name can't be used (null = it can). */
export type CustomColumnNameIssue = 'empty' | 'tooLong' | 'brackets' | 'taken';

/**
 * Checks a custom column name: not empty, short, no brackets, and not the
 * name of another field. Names compare case-insensitively with the source's
 * field ids, any `labels` given (e.g. the field names in every UI language),
 * other custom columns' names and custom column ids, since `[Name]` in an
 * expression must mean exactly one field.
 */
export function customColumnNameIssue(
  source: QuestionSource,
  columns: readonly QuestionCustomColumn[] | undefined,
  name: string,
  ownId?: string,
  labels?: (fieldId: string) => readonly string[]
): CustomColumnNameIssue | null {
  const trimmed = name.trim().replace(/\s+/g, ' ');
  if (!trimmed) return 'empty';
  if (trimmed.length > MAX_NAME_LENGTH) return 'tooLong';
  if (/[[\]]/.test(trimmed)) return 'brackets';
  const lower = trimmed.toLocaleLowerCase();
  if (isReservedName(source, lower)) return 'taken';
  const sourceLabels = SOURCE_FIELDS[source].flatMap((field) => labels?.(field.id) ?? []);
  if (sourceLabels.some((label) => label.trim().toLocaleLowerCase() === lower)) return 'taken';
  const others = (columns ?? []).filter((column) => column.id !== ownId);
  if (others.some((column) => column.name.toLocaleLowerCase() === lower)) return 'taken';
  return null;
}

/** Source field ids and custom column ids: names an expression resolves before any label. */
function isReservedName(source: QuestionSource, lower: string): boolean {
  return CUSTOM_COLUMN_ID.test(lower) || SOURCE_FIELDS[source].some((field) => field.id === lower);
}

/** `name`, or `name 2`, `name 3`, ... when taken. */
function uniqueName(name: string, taken: (lower: string) => boolean): string {
  if (!taken(name.toLocaleLowerCase())) return name;
  for (let n = 2; ; n += 1) {
    const suffix = ` ${n}`;
    const candidate = `${name.slice(0, MAX_NAME_LENGTH - suffix.length).trimEnd()}${suffix}`;
    if (!taken(candidate.toLocaleLowerCase())) return candidate;
  }
}

/** Something `normalizeQuestion` had to drop or change, for the editor to explain. */
export interface QuestionIssue {
  kind: 'customColumn' | 'customMetric' | 'filter' | 'having';
  /** Position in the input list (custom columns, aggregations, filters or having). */
  index: number;
  /**
   * invalid: malformed entry, dropped; expression: the expression doesn't
   * parse (see `error`), dropped; nameTaken: custom column renamed to
   * `name` because its name was taken; textTooLong: a filter value longer
   * than MAX_FILTER_TEXT, filter dropped; tooMany: over the limit, dropped.
   */
  reason: 'invalid' | 'expression' | 'nameTaken' | 'textTooLong' | 'tooMany';
  error?: ExpressionError;
  /** Custom column / metric name (the new name for nameTaken). */
  name?: string;
}

function analyzeCustomColumns(
  source: QuestionSource,
  input: unknown
): { columns: QuestionCustomColumn[]; issues: QuestionIssue[] } {
  const columns: QuestionCustomColumn[] = [];
  const issues: QuestionIssue[] = [];
  const parsed = new Map<string, CustomFieldEntry>();
  const taken = (lower: string) =>
    isReservedName(source, lower) ||
    columns.some((column) => column.name.toLocaleLowerCase() === lower);
  asArray(input).forEach((candidate, index) => {
    const issue = (reason: QuestionIssue['reason'], extra: Partial<QuestionIssue> = {}) =>
      issues.push({ kind: 'customColumn', index, reason, ...extra });
    if (columns.length >= MAX_CUSTOM_COLUMNS) {
      issue('tooMany');
      return;
    }
    const raw = asRecord(candidate);
    if (
      !raw ||
      typeof raw.id !== 'string' ||
      !CUSTOM_COLUMN_ID.test(raw.id) ||
      parsed.has(raw.id)
    ) {
      issue('invalid');
      return;
    }
    const cleaned = cleanName(raw.name);
    if (!cleaned || typeof raw.expression !== 'string') {
      issue('invalid');
      return;
    }
    const result = parseExpression(raw.expression, {
      fields: expressionFields(source, parsed),
      level: 'row',
    });
    if (!result.ok) {
      issue('expression', { error: result.error, name: cleaned });
      return;
    }
    // A name that equals a field id (or an earlier column's name) would make
    // `[Name]` mean two things: keep the column under a free name.
    const name = uniqueName(cleaned, taken);
    if (name !== cleaned) issue('nameTaken', { name });
    const column = { id: raw.id, name, expression: printExpression(result.value.ast) };
    columns.push(column);
    parsed.set(column.id, {
      column,
      field: customField(column.id, result.value.info),
      info: result.value.info,
      ast: result.value.ast,
    });
  });
  return { columns, issues };
}

/**
 * Valid custom columns: unique ids and names (taken names get a number),
 * expressions that parse (earlier columns only). `questionIssues` lists
 * what was dropped or renamed.
 */
export function normalizeCustomColumns(
  source: QuestionSource,
  input: unknown
): QuestionCustomColumn[] {
  return analyzeCustomColumns(source, input).columns;
}

/**
 * What `normalizeQuestion` would drop or change in an input spec (custom
 * columns and metrics that don't parse, invalid or too-long filters, ...),
 * so the editor can show an error instead of silently losing a part.
 */
export function questionIssues(input: unknown): QuestionIssue[] {
  const raw = asRecord(input) ?? {};
  const source = oneOf(QUESTION_SOURCES, raw.source) ?? 'transactions';
  const { columns, issues } = analyzeCustomColumns(source, raw.customColumns);
  const custom = customFields(source, columns);
  asArray(raw.filters).forEach((filter, index) => {
    if (index >= MAX_STORED_FILTERS) {
      issues.push({ kind: 'filter', index, reason: 'tooMany' });
    } else if (!normalizeFilter(source, filter, custom)) {
      const values = asArray(asRecord(filter)?.values);
      issues.push({
        kind: 'filter',
        index,
        reason: values.some(isFilterTextTooLong) ? 'textTooLong' : 'invalid',
      });
    }
  });
  asArray(raw.aggregations).forEach((aggregation, index) => {
    if (index >= MAX_AGGREGATIONS) {
      issues.push({ kind: 'customMetric', index, reason: 'tooMany' });
      return;
    }
    const entry = asRecord(aggregation);
    if (entry?.op !== 'custom') return;
    const result =
      typeof entry.expression === 'string'
        ? parseCustomMetric(source, entry.expression, custom)
        : null;
    if (!result || !result.ok) {
      issues.push({
        kind: 'customMetric',
        index,
        reason: result ? 'expression' : 'invalid',
        ...(result && !result.ok ? { error: result.error } : {}),
        ...(typeof entry.name === 'string' ? { name: entry.name } : {}),
      });
    }
  });
  const normalized = normalizeQuestion(input);
  const metricKeys = new Set(havingColumns(normalized).map((column) => column.key));
  asArray(raw.having).forEach((entry, index) => {
    if (index >= MAX_HAVING) issues.push({ kind: 'having', index, reason: 'tooMany' });
    else if (!normalizeHavingEntry(entry, metricKeys)) {
      issues.push({ kind: 'having', index, reason: 'invalid' });
    }
  });
  return issues;
}

/** Parsed custom columns (assumes they're normalized). */
export function customFields(
  source: QuestionSource,
  columns: readonly QuestionCustomColumn[] | undefined
): CustomFields {
  const parsed = new Map<string, CustomFieldEntry>();
  for (const column of columns ?? []) {
    const result = parseExpression(column.expression, {
      fields: expressionFields(source, parsed),
      level: 'row',
    });
    if (!result.ok) continue;
    parsed.set(column.id, {
      column,
      field: customField(column.id, result.value.info),
      info: result.value.info,
      ast: result.value.ast,
    });
  }
  return parsed;
}

/** Parses a custom metric's expression for a source (ids only, as stored). */
export function parseCustomMetric(
  source: QuestionSource,
  expression: string,
  custom?: CustomFields
): ParseResult {
  return parseExpression(expression, {
    fields: expressionFields(source, custom),
    level: 'metric',
    budgetMetrics: source === 'transactions',
  });
}

function normalizeCustomMetric(
  source: QuestionSource,
  raw: Record<string, unknown>,
  custom?: CustomFields
): QuestionAggregation | null {
  if (typeof raw.expression !== 'string') return null;
  const result = parseCustomMetric(source, raw.expression, custom);
  if (!result.ok) return null;
  const name = cleanName(raw.name);
  return {
    op: 'custom',
    expression: printExpression(result.value.ast),
    ...(name ? { name } : {}),
  };
}

function normalizeMetricOptions(
  raw: Record<string, unknown>
): Pick<QuestionAggregation, 'modifier' | 'window' | 'compare' | 'compareTo'> {
  const modifier = oneOf(METRIC_MODIFIERS, raw.modifier);
  const options: Pick<QuestionAggregation, 'modifier' | 'window' | 'compare' | 'compareTo'> = {};
  if (modifier) options.modifier = modifier;
  if (modifier === 'moving') {
    const window = toFiniteNumber(raw.window);
    options.window =
      window === null
        ? DEFAULT_MOVING_WINDOW
        : Math.min(Math.max(Math.floor(window), 2), MAX_MOVING_WINDOW);
  }
  if (raw.compare === true) {
    options.compare = true;
    // Last year's value is compared raw, so it skips running / moving / share metrics.
    if (raw.compareTo === 'lastYear' && !modifier) options.compareTo = 'lastYear';
  }
  return options;
}

/** Whether a question has a bucketed date grouping (needed by time-series modifiers). */
export function hasDateBreakout(breakouts: readonly QuestionBreakout[]): boolean {
  return breakouts.some((breakout) => breakout.bucket !== undefined);
}

/** Running total, moving average and compare need a date grouping; % of total a grouping. */
function dropUnusableModifiers(
  aggregations: QuestionAggregation[],
  breakouts: readonly QuestionBreakout[]
) {
  const dated = hasDateBreakout(breakouts);
  aggregations.forEach((aggregation, index) => {
    const next = { ...aggregation };
    if ((next.modifier === 'running' || next.modifier === 'moving') && !dated) {
      delete next.modifier;
      delete next.window;
    }
    if (next.modifier === 'share' && breakouts.length === 0) delete next.modifier;
    if (next.compare && !dated) {
      delete next.compare;
      delete next.compareTo;
    }
    aggregations[index] = next;
  });
}

function customMetricKey(name: string | undefined): string {
  const slug = (name ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  return slug ? `custom_${slug}` : 'custom';
}

function columnExtras(spec: QuestionSpec) {
  const custom = customFields(spec.source, spec.customColumns);
  const fieldFormat = (fieldId: string): ColumnFormat | undefined => {
    const entry = custom.get(fieldId);
    if (!entry) return undefined;
    if (entry.info.type !== 'number') return 'text';
    return entry.info.money ? 'money' : 'number';
  };
  return {
    forField(fieldId: string): QuestionColumnExtras {
      const entry = custom.get(fieldId);
      return entry ? { name: entry.column.name, format: fieldFormat(fieldId) } : {};
    },
    forAggregation(aggregation: QuestionAggregation): QuestionColumnExtras {
      const extras: QuestionColumnExtras = {};
      if (aggregation.op === 'custom') {
        if (aggregation.name) extras.name = aggregation.name;
        const result = parseCustomMetric(spec.source, aggregation.expression ?? '', custom);
        extras.format = result.ok && result.value.info.money ? 'money' : 'number';
      } else if (aggregation.field && custom.has(aggregation.field)) {
        extras.fieldName = custom.get(aggregation.field)!.column.name;
        const format = fieldFormat(aggregation.field);
        if (aggregation.op !== 'distinct' && format) extras.format = format;
      }
      if (aggregation.modifier === 'share') extras.format = 'percent';
      return extras;
    },
  };
}

/** Next free custom column id (`expr_1`, `expr_2`, …). */
export function nextCustomColumnId(spec: QuestionSpec): string {
  const used = new Set((spec.customColumns ?? []).map((column) => column.id));
  for (let n = 1; ; n += 1) {
    if (!used.has(`expr_${n}`)) return `expr_${n}`;
  }
}

/** A field of the question: source field or custom column. */
export function questionField(spec: QuestionSpec, fieldId: string): FieldDef | undefined {
  return lookupField(spec.source, fieldId, customFields(spec.source, spec.customColumns));
}

/** Picker / allowed order of the chart types (table last). */
export const VISUALIZATION_ORDER: readonly ResolvedVisualization[] = [
  'number',
  'trend',
  'bar',
  'row',
  'line',
  'area',
  'combo',
  'pie',
  'waterfall',
  'calendar',
  'sankey',
  'scatter',
  'pivot',
  'table',
];

/** Why a chart type can't show this question (null = it can). */
export type VisualizationBlocker =
  | 'needsSummary'
  | 'needsNoGrouping'
  | 'needsGrouping'
  | 'needsOneGrouping'
  | 'needsCategoryGrouping'
  | 'needsDateTrend'
  | 'needsTwoMetrics'
  | 'needsTwoMetricsOneGrouping'
  | 'needsDayGrouping'
  | 'needsTwoGroupings'
  | 'needsTwoCategoryGroupings';

/** A date grouping on a time line (bucketed); date parts (weekday, ...) are categories. */
function isDateBreakout(spec: QuestionSpec, breakout: QuestionBreakout | undefined): boolean {
  return !!breakout && !breakout.part && getField(spec.source, breakout.field)?.type === 'date';
}

/**
 * Groupings with a natural order (date buckets, date parts, numeric bins):
 * shown in that order unless the question sorts otherwise.
 */
export function isOrderedBreakout(breakout: QuestionBreakout): boolean {
  return breakout.bucket !== undefined || breakout.part !== undefined || breakout.bin !== undefined;
}

/** The date filter a number-with-trend compares against the period before it. */
export function trendDateFilter(spec: QuestionSpec): QuestionFilter | null {
  const dateField = PRIMARY_DATE_FIELD[spec.source];
  return (
    spec.filters.find(
      (filter) =>
        filter.field === dateField &&
        (filter.op === 'previous' || filter.op === 'current' || filter.op === 'between')
    ) ?? null
  );
}

export function visualizationBlocker(
  spec: QuestionSpec,
  visualization: ResolvedVisualization
): VisualizationBlocker | null {
  if (visualization === 'table') return null;
  if (spec.aggregations.length === 0) return 'needsSummary';
  const groupings = spec.breakouts.length;
  const metrics = spec.aggregations.length;
  const [first, second] = spec.breakouts;
  switch (visualization) {
    case 'number':
      return groupings === 0 ? null : 'needsNoGrouping';
    case 'trend':
      if (groupings === 0) return trendDateFilter(spec) ? null : 'needsDateTrend';
      return groupings === 1 && isDateBreakout(spec, first) ? null : 'needsDateTrend';
    case 'bar':
    case 'line':
    case 'area':
      return groupings > 0 ? null : 'needsGrouping';
    case 'row':
      return groupings > 0 && !isDateBreakout(spec, first) ? null : 'needsCategoryGrouping';
    case 'pie':
    case 'waterfall':
      return groupings === 1 ? null : 'needsOneGrouping';
    case 'combo':
      return groupings === 1 && metrics >= 2 ? null : 'needsTwoMetricsOneGrouping';
    case 'calendar':
      return groupings === 1 && isDateBreakout(spec, first) && first.bucket === 'day'
        ? null
        : 'needsDayGrouping';
    case 'sankey':
      return groupings === 2 && !isDateBreakout(spec, first) && !isDateBreakout(spec, second)
        ? null
        : 'needsTwoCategoryGroupings';
    case 'scatter':
      return groupings > 0 && metrics >= 2 ? null : 'needsTwoMetrics';
    case 'pivot':
      return groupings === 2 ? null : 'needsTwoGroupings';
  }
}

/** What a metric measures, so charts can tell when two metrics need two axes. */
export function aggregationUnit(aggregation: QuestionAggregation): 'money' | 'number' {
  if (aggregation.op === 'count' || aggregation.op === 'distinct') return 'number';
  if (isFriendlyAggregation(aggregation.op)) return 'money';
  return aggregation.field && MONEY_FIELD_IDS.has(aggregation.field) ? 'money' : 'number';
}

// ---------------------------------------------------------------------------
// Display settings
// ---------------------------------------------------------------------------

export const DISPLAY_SORTS = ['asc', 'desc'] as const;
export type DisplaySort = (typeof DISPLAY_SORTS)[number];
export const MAX_TOP_N = 50;
const MAX_GOAL = 1e12;

/** Per-chart settings; every field optional, absent = the chart's default. */
export interface QuestionDisplay {
  /** Print values on bars / points. */
  showValues?: boolean;
  /** Goal line (in the metric's unit, e.g. budget currency). */
  goal?: number;
  /** Combo: second metric on its own axis; absent = when units differ. */
  dualAxis?: boolean;
  /** Keep the N largest categories, fold the rest into "Other". */
  topN?: number;
  /** Bar / row: sort categories by value. */
  sort?: DisplaySort;
}

/** Valid display settings, or undefined when nothing is set. */
export function normalizeDisplay(input: unknown): QuestionDisplay | undefined {
  const raw = asRecord(input);
  if (!raw) return undefined;
  const display: QuestionDisplay = {};
  if (typeof raw.showValues === 'boolean') display.showValues = raw.showValues;
  const goal = toFiniteNumber(raw.goal);
  if (goal !== null && Math.abs(goal) < MAX_GOAL) display.goal = Math.round(goal * 100) / 100;
  if (typeof raw.dualAxis === 'boolean') display.dualAxis = raw.dualAxis;
  const topN = toFiniteNumber(raw.topN);
  if (topN !== null && topN >= 1) display.topN = Math.min(Math.floor(topN), MAX_TOP_N);
  const sort = oneOf(DISPLAY_SORTS, raw.sort);
  if (sort) display.sort = sort;
  return Object.keys(display).length > 0 ? display : undefined;
}
