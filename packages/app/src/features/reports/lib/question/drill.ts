/**
 * Drill-through: clicking a chart mark or a summarized table cell turns the
 * clicked grouping values into a new question (pure functions, no UI):
 *
 * - records: the rows behind the value ("See these transactions"),
 * - breakout: filter to the value and group by another field,
 * - zoom: a date bucket one step finer (year → quarter → month → week → day),
 * - filter / exclude: keep or drop one categorical value.
 */
import {
  DATE_BUCKETS,
  DEFAULT_RAW_COLUMNS,
  groupableFields,
  type DateBucket,
  type FieldDef,
} from './fields';
import {
  isFilterTextTooLong,
  isValidIsoDate,
  normalizeQuestion,
  questionField,
  type QuestionBreakout,
  type QuestionColumn,
  type QuestionFilter,
  type QuestionSpec,
} from './spec';

export type BreakoutColumn = Extract<QuestionColumn, { kind: 'breakout' }>;

export interface DrillValue {
  column: BreakoutColumn;
  /** The cell value (label, bucket text, boolean or number). */
  value: unknown;
  /**
   * Hidden key from the `<key>__key` result column: the entity id (or null
   * for "Uncategorized" etc.), the raw text, or a numeric bin's width.
   * Undefined when the result has none (e.g. SQL saved before ids were added).
   */
  key?: unknown;
}

export interface DrillContext {
  /** The (normalized) question that produced the clicked result. */
  spec: QuestionSpec;
  values: DrillValue[];
}

export type DrillAction =
  | { kind: 'records' }
  | { kind: 'transactions' }
  | { kind: 'breakout'; field: string; bucket?: DateBucket }
  | { kind: 'zoom'; key: string }
  | { kind: 'filter'; key: string; exclude?: boolean };

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

/** YYYY-MM-DD of a UTC date built by `utc()` (bucket math stays in UTC, no time zones). */
function isoDay(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function utc(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month, day));
}

/** Inclusive [first, last] day of a bucket value ("2026-03" → 2026-03-01 … 2026-03-31). */
export function bucketRange(bucket: DateBucket, value: unknown): [string, string] | null {
  if (typeof value !== 'string') return null;
  switch (bucket) {
    case 'day':
      return isValidIsoDate(value) ? [value, value] : null;
    case 'week': {
      if (!isValidIsoDate(value)) return null;
      const [year, month, day] = value.split('-').map(Number);
      return [value, isoDay(utc(year, month - 1, day + 6))];
    }
    case 'month': {
      const match = /^(\d{4})-(\d{2})$/.exec(value);
      if (!match) return null;
      const year = Number(match[1]);
      const month = Number(match[2]);
      if (month < 1 || month > 12) return null;
      return [isoDay(utc(year, month - 1, 1)), isoDay(utc(year, month, 0))];
    }
    case 'quarter': {
      const match = /^(\d{4})-Q([1-4])$/.exec(value);
      if (!match) return null;
      const year = Number(match[1]);
      const first = (Number(match[2]) - 1) * 3;
      return [isoDay(utc(year, first, 1)), isoDay(utc(year, first + 3, 0))];
    }
    case 'year': {
      if (!/^\d{4}$/.test(value)) return null;
      const year = Number(value);
      return [isoDay(utc(year, 0, 1)), isoDay(utc(year, 11, 31))];
    }
  }
}

/** The next finer bucket a date field allows (year → quarter → month → week → day). */
export function finerBucket(field: FieldDef | undefined, bucket: DateBucket): DateBucket | null {
  const allowed = field?.buckets ?? DATE_BUCKETS;
  const position = DATE_BUCKETS.indexOf(bucket);
  for (let index = position - 1; index >= 0; index -= 1) {
    if (allowed.includes(DATE_BUCKETS[index])) return DATE_BUCKETS[index];
  }
  return null;
}

// ---------------------------------------------------------------------------
// Filters for clicked values
// ---------------------------------------------------------------------------

function isBlank(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === 'string' && !value.trim());
}

/** Range [from, to) of a numeric bin cell: its lower bound and the bin width. */
export function binRange(value: unknown, width: unknown): [number, number] | null {
  const low = typeof value === 'number' ? value : Number.NaN;
  const size = typeof width === 'number' ? width : Number.NaN;
  if (!Number.isFinite(low) || !Number.isFinite(size) || size <= 0) return null;
  return [low, low + size];
}

/**
 * "Is this value" filter for a clicked grouping value, or null when it can't
 * be expressed exactly (then no drill-through is offered for it).
 */
export function drillFilter(spec: QuestionSpec, drill: DrillValue): QuestionFilter | null {
  const { breakout } = drill.column;
  const field = questionField(spec, breakout.field);
  if (!field) return null;
  if (breakout.part) {
    if (isBlank(drill.value)) return { field: field.id, op: 'isEmpty', values: [] };
    const part = Number(drill.value);
    return Number.isInteger(part)
      ? { field: field.id, op: 'is', values: [part], part: breakout.part }
      : null;
  }
  if (breakout.bin !== undefined) {
    if (isBlank(drill.value)) return { field: field.id, op: 'isEmpty', values: [] };
    const width = breakout.bin === 'auto' ? drill.key : breakout.bin;
    const range = binRange(drill.value, width);
    if (!range) return null;
    return { field: field.id, op: 'between', values: range, binWidth: width as number };
  }
  if (breakout.bucket) {
    const range = bucketRange(breakout.bucket, drill.value);
    if (!range) return null;
    return range[0] === range[1]
      ? { field: field.id, op: 'is', values: [range[0]] }
      : { field: field.id, op: 'between', values: range };
  }
  switch (field.type) {
    case 'boolean':
      // Undecidable conditions (NULL) count as false, like the `is` filter.
      if (drill.value === null) return { field: field.id, op: 'is', values: [false] };
      return typeof drill.value === 'boolean'
        ? { field: field.id, op: 'is', values: [drill.value] }
        : null;
    case 'number': {
      if (isBlank(drill.value)) return { field: field.id, op: 'isEmpty', values: [] };
      const numeric = Number(drill.value);
      return Number.isFinite(numeric) ? { field: field.id, op: 'is', values: [numeric] } : null;
    }
    case 'entity':
    case 'text': {
      if (field.idKeyed) {
        if (drill.key === undefined) return null;
        if (drill.key === null) return { field: field.id, op: 'isEmpty', values: [] };
        const id = Number(drill.key);
        return Number.isSafeInteger(id) && id > 0
          ? { field: field.id, op: 'is', values: [id] }
          : null;
      }
      // Name-keyed: the hidden raw value, else the cell text.
      const raw = drill.key !== undefined ? drill.key : drill.value;
      if (isBlank(raw)) return { field: field.id, op: 'isEmpty', values: [] };
      // Too long to filter by: no drill rather than a filter that is dropped.
      if (isFilterTextTooLong(String(raw))) return null;
      return { field: field.id, op: 'is', values: [String(raw)] };
    }
    default:
      return null;
  }
}

/** "Is not this value" filter (categorical values only). */
export function excludeFilter(spec: QuestionSpec, drill: DrillValue): QuestionFilter | null {
  const { breakout } = drill.column;
  if (breakout.bucket || breakout.bin !== undefined) return null;
  const include = drillFilter(spec, drill);
  if (!include) return null;
  if (include.op === 'isEmpty') return { ...include, op: 'notEmpty' };
  if (include.op !== 'is') return null;
  const field = questionField(spec, include.field);
  if (field?.type === 'boolean') return { ...include, values: [include.values[0] !== true] };
  return { ...include, op: 'isNot' };
}

/** Adds filters, dropping existing ones the new filter makes redundant. */
function withFilters(spec: QuestionSpec, added: QuestionFilter[]): QuestionFilter[] {
  let filters = [...spec.filters];
  for (const filter of added) {
    filters = filters.filter((existing) => {
      if (existing.field !== filter.field) return true;
      // A date-part or bin filter and a plain one on the same field both stay.
      if (existing.part !== filter.part || existing.binWidth !== filter.binWidth) return true;
      // A wider date range on the same field.
      if (existing.op === 'between' && (filter.op === 'between' || filter.op === 'is')) {
        const [from, to] = existing.values as string[];
        const [newFrom, newTo = newFrom] = filter.values as string[];
        return !(from <= newFrom && newTo <= to);
      }
      // A value list that already contains the new single value.
      if (existing.op === 'is' && filter.op === 'is' && filter.values.length === 1) {
        return !existing.values.includes(filter.values[0]);
      }
      return !(existing.op === filter.op && sameValues(existing.values, filter.values));
    });
    filters.push(filter);
  }
  return filters;
}

function sameValues(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function drillFilters(context: DrillContext): QuestionFilter[] {
  return context.values
    .map((value) => drillFilter(context.spec, value))
    .filter((filter): filter is QuestionFilter => filter !== null);
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export interface DrillOptions {
  /** Whether "See these transactions / rows" applies. */
  records: boolean;
  /**
   * Balances / Payees: whether the transactions behind the value can be
   * listed exactly (a Transactions question).
   */
  transactions: boolean;
  /** Fields offered for "Break out by …". */
  breakoutFields: FieldDef[];
  /** Date value that can be zoomed into, with the bucket it zooms to. */
  zoom: { key: string; bucket: DateBucket } | null;
  /** Categorical values offered for "Filter to this" / "Exclude this". */
  categorical: DrillValue[];
}

/** Which drill actions make sense for a click. */
export function drillOptions(context: DrillContext): DrillOptions {
  const { spec, values } = context;
  const usable = values.filter((value) => drillFilter(spec, value) !== null);
  // Rows behind a cell only when every clicked grouping value can be filtered
  // exactly; a partial set of filters would list other cells' rows too.
  const exact = usable.length === values.length;
  const clickedFields = new Set(
    usable.filter((value) => !value.column.breakout.bucket).map((v) => v.column.breakout.field)
  );
  const custom = (spec.customColumns ?? [])
    .map((column) => questionField(spec, column.id))
    .filter((field): field is FieldDef => field !== undefined && field.groupable);
  const breakoutFields = [...groupableFields(spec.source), ...custom].filter(
    (field) => !clickedFields.has(field.id)
  );

  let zoom: DrillOptions['zoom'] = null;
  for (const value of usable) {
    const { bucket, field } = value.column.breakout;
    if (!bucket) continue;
    const finer = finerBucket(questionField(spec, field), bucket);
    if (finer) {
      zoom = { key: value.column.key, bucket: finer };
      break;
    }
  }

  return {
    records: exact,
    transactions: exact && transactionsDrillFilters(context) !== null,
    breakoutFields: exact && usable.length > 0 ? breakoutFields : [],
    zoom,
    categorical: usable.filter(
      (value) => !value.column.breakout.bucket && excludeFilter(spec, value) !== null
    ),
  };
}

/** Filters that keep the rows a metric measured (Spending leaves income lines out). */
function impliedMetricFilters(spec: QuestionSpec): QuestionFilter[] {
  if (spec.source !== 'transactions') return [];
  const ops = spec.aggregations.map((aggregation) => aggregation.op);
  if (ops.length === 0) return [];
  if (ops.every((op) => op === 'spending' || op === 'averageSpending')) {
    return [{ field: 'is_income', op: 'is', values: [false] }];
  }
  if (ops.every((op) => op === 'income')) {
    return [{ field: 'is_income', op: 'is', values: [true] }];
  }
  return [];
}

/** Balances fields that are also transaction fields (same meaning, same values). */
const BALANCE_TO_TRANSACTION_FIELDS = new Set(['account', 'on_budget', 'date']);
/** Payees' filter-only fields: the transaction lines its totals count. */
const PAYEE_LINE_FIELDS = new Set(['date', 'account', 'category', 'category_group', 'on_budget']);

/**
 * Transactions-source filters for the transactions behind a Balances or
 * Payees value, or null when they can't be expressed exactly:
 *
 * - Balances: the period's transactions of the account(s), so a monthly
 *   cell lists what changed its balance that month (revaluations aren't
 *   transactions). Filters on account type, currency, ... don't exist on
 *   transactions, so those questions offer no drill.
 * - Payees: the payee's transactions (transfers left out), narrowed by the
 *   question's transaction filters (date, account, category, on-budget).
 */
function transactionsDrillFilters(context: DrillContext): QuestionFilter[] | null {
  const { spec } = context;
  const clicked = drillFilters(context);
  if (clicked.length !== context.values.length) return null;
  if (spec.source === 'balances') {
    const own = spec.filters;
    if ([...own, ...clicked].some((filter) => !BALANCE_TO_TRANSACTION_FIELDS.has(filter.field))) {
      return null;
    }
    // A clicked period replaces the question's own date range.
    const period = clicked.some((filter) => filter.field === 'date');
    return [...own.filter((filter) => !(period && filter.field === 'date')), ...clicked];
  }
  if (spec.source === 'payees') {
    if (!clicked.some((filter) => filter.field === 'payee')) return null;
    if (clicked.some((filter) => filter.field !== 'payee')) return null;
    return [
      { field: 'is_transfer', op: 'is', values: [false] },
      ...spec.filters.filter((filter) => PAYEE_LINE_FIELDS.has(filter.field)),
      ...clicked,
    ];
  }
  return null;
}

/** The new question for a drill action (normalized). */
export function applyDrill(context: DrillContext, action: DrillAction): QuestionSpec {
  const { spec } = context;
  switch (action.kind) {
    case 'transactions': {
      const filters = transactionsDrillFilters(context);
      if (!filters) return spec;
      return normalizeQuestion({
        v: 2,
        source: 'transactions',
        filters,
        aggregations: [],
        breakouts: [],
        sort: [],
        limit: null,
        columns: null,
        visualization: 'auto',
        stacking: 'auto',
      });
    }
    case 'records': {
      const filters = withFilters(spec, [...drillFilters(context), ...impliedMetricFilters(spec)]);
      const custom = (spec.customColumns ?? []).map((column) => column.id);
      return normalizeQuestion({
        v: 2,
        source: spec.source,
        filters,
        aggregations: [],
        breakouts: [],
        sort: [],
        limit: null,
        columns: custom.length > 0 ? [...DEFAULT_RAW_COLUMNS[spec.source], ...custom] : null,
        visualization: 'auto',
        stacking: 'auto',
        customColumns: spec.customColumns,
      });
    }
    case 'breakout': {
      const field = questionField(spec, action.field);
      if (!field || !field.groupable) return spec;
      const breakout: QuestionBreakout =
        field.type === 'date'
          ? { field: field.id, bucket: action.bucket ?? field.defaultBucket ?? 'month' }
          : { field: field.id };
      return normalizeQuestion({
        ...spec,
        filters: withFilters(spec, drillFilters(context)),
        breakouts: [breakout],
        sort: [],
        limit: null,
        visualization: 'auto',
        stacking: 'auto',
        // Filters on metrics belonged to the old grouping.
        having: undefined,
      });
    }
    case 'zoom': {
      const value = context.values.find((item) => item.column.key === action.key);
      const bucket = value?.column.breakout.bucket;
      if (!value || !bucket) return spec;
      const finer = finerBucket(questionField(spec, value.column.breakout.field), bucket);
      const filter = drillFilter(spec, value);
      if (!finer || !filter) return spec;
      return normalizeQuestion({
        ...spec,
        filters: withFilters(spec, [filter]),
        breakouts: spec.breakouts.map((breakout) =>
          breakout.field === value.column.breakout.field && breakout.bucket === bucket
            ? { ...breakout, bucket: finer }
            : breakout
        ),
        sort: spec.sort.filter((entry) => entry.column !== action.key),
        having: undefined,
      });
    }
    case 'filter': {
      const value = context.values.find((item) => item.column.key === action.key);
      if (!value) return spec;
      const filter = action.exclude ? excludeFilter(spec, value) : drillFilter(spec, value);
      if (!filter) return spec;
      return normalizeQuestion({ ...spec, filters: withFilters(spec, [filter]) });
    }
  }
}

/** Drill values for one result row (all grouping columns), reading hidden keys when present. */
export function rowDrillValues(
  columns: readonly QuestionColumn[],
  resultColumns: readonly string[],
  row: readonly unknown[],
  only?: string
): DrillValue[] {
  const index = new Map(resultColumns.map((name, position) => [name, position]));
  return columns
    .filter((column): column is BreakoutColumn => column.kind === 'breakout')
    .filter((column) => !only || column.key === only)
    .flatMap((column) => {
      const position = index.get(column.key);
      if (position === undefined) return [];
      const keyPosition = index.get(`${column.key}__key`);
      return [
        {
          column,
          value: row[position],
          ...(keyPosition !== undefined ? { key: row[keyPosition] } : {}),
        },
      ];
    });
}
