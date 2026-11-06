/**
 * Legacy (v1) report-builder spec, saved as a `-- budgero-builder: {json}`
 * header by the first report builder. Only parsed now: `upgradeLegacySpec`
 * turns it into a v2 question spec.
 */
import { z } from 'zod';
import {
  normalizeQuestion,
  questionColumns,
  type QuestionAggregation,
  type QuestionBreakout,
  type QuestionFilter,
  type QuestionSpec,
  type Visualization,
} from './spec';

const BUILDER_MEASURES = [
  'spending',
  'income',
  'net',
  'incomeVsSpending',
  'count',
  'average',
] as const;
const BUILDER_DIMENSIONS = [
  'month',
  'week',
  'quarter',
  'year',
  'category',
  'categoryGroup',
  'payee',
  'account',
  'label',
] as const;
const BUILDER_DATE_PRESETS = [
  'thisMonth',
  'last3Months',
  'last6Months',
  'last12Months',
  'yearToDate',
  'allTime',
  'custom',
] as const;
const BUILDER_CHART_TYPES = ['bar', 'line', 'area', 'pie', 'table', 'stat'] as const;
const BUILDER_SORTS = ['valueDesc', 'valueAsc', 'label'] as const;

export type BuilderMeasure = (typeof BUILDER_MEASURES)[number];
export type BuilderDimension = (typeof BUILDER_DIMENSIONS)[number];
export type BuilderDatePreset = (typeof BUILDER_DATE_PRESETS)[number];
export type BuilderChartType = (typeof BUILDER_CHART_TYPES)[number];
export type BuilderSort = (typeof BUILDER_SORTS)[number];

const TIME_DIMENSIONS: readonly BuilderDimension[] = ['month', 'week', 'quarter', 'year'];

const MAX_BUILDER_LIMIT = 500;

export interface ReportBuilderFilters {
  accountIds: number[];
  categoryIds: number[];
  categoryGroupIds: number[];
  /** Payee names (payees are name-keyed in Budgero). */
  payees: string[];
  labelIds: number[];
}

export interface ReportBuilderSpec {
  measure: BuilderMeasure;
  groupBy: BuilderDimension;
  splitBy: BuilderDimension | null;
  dateRange: { preset: BuilderDatePreset; from?: string; to?: string };
  filters: ReportBuilderFilters;
  includeTransfers: boolean;
  includeOffBudget: boolean;
  chartType: BuilderChartType;
  sort: BuilderSort;
  /** Top N labels (categorical group-bys only); null = no limit. */
  limit: number | null;
}

function isTimeDimension(dimension: BuilderDimension | null | undefined): boolean {
  return dimension != null && TIME_DIMENSIONS.includes(dimension);
}

// ---------------------------------------------------------------------------
// Validation / normalization
// ---------------------------------------------------------------------------

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isValidIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (month < 1 || month > 12 || day < 1) return false;
  // Day 0 of the next month is the last day of this one.
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= daysInMonth;
}

const idList = z
  .array(z.unknown())
  .catch([])
  .transform((values) =>
    Array.from(
      new Set(
        values
          .map((value) => Number(value))
          .filter((value) => Number.isSafeInteger(value) && value > 0)
      )
    )
  );

const stringList = z
  .array(z.unknown())
  .catch([])
  .transform((values) =>
    Array.from(
      new Set(
        values
          .filter((value): value is string => typeof value === 'string')
          .map((value) => value.trim())
          .filter((value) => value.length > 0 && value.length <= 500)
      )
    )
  );

const specSchema = z.object({
  measure: z.enum(BUILDER_MEASURES).catch('spending'),
  groupBy: z.enum(BUILDER_DIMENSIONS).catch('category'),
  splitBy: z.enum(BUILDER_DIMENSIONS).nullable().catch(null),
  dateRange: z
    .object({
      preset: z.enum(BUILDER_DATE_PRESETS).catch('last12Months'),
      from: z.unknown().optional(),
      to: z.unknown().optional(),
    })
    .catch({ preset: 'last12Months' }),
  filters: z
    .object({
      accountIds: idList,
      categoryIds: idList,
      categoryGroupIds: idList,
      payees: stringList,
      labelIds: idList,
    })
    .partial()
    .catch({}),
  includeTransfers: z.boolean().catch(false),
  includeOffBudget: z.boolean().catch(false),
  chartType: z.enum(BUILDER_CHART_TYPES).catch('bar'),
  sort: z.enum(BUILDER_SORTS).catch('valueDesc'),
  limit: z.unknown().optional(),
});

/**
 * Coerce untrusted input (a saved header, URL state, a partially edited
 * form) into a valid spec. Never throws; unknown values fall back to defaults
 * and incompatible combinations are fixed up.
 */
export function normalizeSpec(input: unknown): ReportBuilderSpec {
  const parsed = specSchema.parse(typeof input === 'object' && input !== null ? input : {});

  const dateRange: ReportBuilderSpec['dateRange'] = { preset: parsed.dateRange.preset };
  if (parsed.dateRange.preset === 'custom') {
    if (isValidIsoDate(parsed.dateRange.from)) dateRange.from = parsed.dateRange.from;
    if (isValidIsoDate(parsed.dateRange.to)) dateRange.to = parsed.dateRange.to;
    if (dateRange.from && dateRange.to && dateRange.from > dateRange.to) {
      [dateRange.from, dateRange.to] = [dateRange.to, dateRange.from];
    }
  }

  const rawLimit = parsed.limit;
  let limit: number | null = null;
  if (rawLimit !== null && rawLimit !== undefined && rawLimit !== '') {
    const numeric = Math.floor(Number(rawLimit));
    if (Number.isFinite(numeric) && numeric > 0) limit = Math.min(numeric, MAX_BUILDER_LIMIT);
  }

  const spec: ReportBuilderSpec = {
    measure: parsed.measure,
    groupBy: parsed.groupBy,
    splitBy: parsed.splitBy,
    dateRange,
    filters: {
      accountIds: parsed.filters.accountIds ?? [],
      categoryIds: parsed.filters.categoryIds ?? [],
      categoryGroupIds: parsed.filters.categoryGroupIds ?? [],
      payees: parsed.filters.payees ?? [],
      labelIds: parsed.filters.labelIds ?? [],
    },
    includeTransfers: parsed.includeTransfers,
    includeOffBudget: parsed.includeOffBudget,
    chartType: parsed.chartType,
    sort: parsed.sort,
    limit,
  };

  // "Income vs spending" brings its own two series; it can't be a pie or a single number.
  if (spec.measure === 'incomeVsSpending') {
    spec.splitBy = null;
    if (spec.chartType === 'pie' || spec.chartType === 'stat') spec.chartType = 'bar';
  }
  // A series must differ from the rows; pie and stat charts have no series.
  if (spec.splitBy === spec.groupBy || spec.chartType === 'pie' || spec.chartType === 'stat') {
    spec.splitBy = null;
  }
  // Time axes always read left to right; Top N only applies to categories.
  if (isTimeDimension(spec.groupBy)) {
    spec.sort = 'label';
    spec.limit = null;
  }
  return spec;
}

// ---------------------------------------------------------------------------
// v1 → v2
// ---------------------------------------------------------------------------

function v1DateFilter(range: ReportBuilderSpec['dateRange']): QuestionFilter | null {
  const previousMonths = (amount: number): QuestionFilter => ({
    field: 'date',
    op: 'previous',
    values: [],
    amount,
    unit: 'month',
    includeCurrent: true,
  });
  switch (range.preset) {
    case 'thisMonth':
      return { field: 'date', op: 'current', values: [], unit: 'month' };
    case 'last3Months':
      return previousMonths(3);
    case 'last6Months':
      return previousMonths(6);
    case 'last12Months':
      return previousMonths(12);
    case 'yearToDate':
      return { field: 'date', op: 'current', values: [], unit: 'year' };
    case 'allTime':
      return null;
    case 'custom':
      if (range.from && range.to) {
        return { field: 'date', op: 'between', values: [range.from, range.to] };
      }
      // v1 bounds were inclusive (before/after are exclusive): open-ended between.
      if (range.from) return { field: 'date', op: 'between', values: [range.from, '9999-12-31'] };
      if (range.to) return { field: 'date', op: 'between', values: ['0001-01-01', range.to] };
      return null;
  }
}

function v1Breakout(dimension: BuilderDimension): QuestionBreakout {
  switch (dimension) {
    case 'month':
    case 'week':
    case 'quarter':
    case 'year':
      return { field: 'date', bucket: dimension };
    case 'category':
      return { field: 'category' };
    case 'categoryGroup':
      return { field: 'category_group' };
    case 'payee':
      return { field: 'payee' };
    case 'account':
      return { field: 'account' };
    case 'label':
      return { field: 'label' };
  }
}

function v1Aggregations(measure: BuilderMeasure): QuestionAggregation[] {
  switch (measure) {
    case 'spending':
    case 'income':
    case 'net':
      return [{ op: measure }];
    case 'incomeVsSpending':
      return [{ op: 'income' }, { op: 'spending' }];
    case 'count':
      return [{ op: 'count' }];
    case 'average':
      return [{ op: 'averageSpending' }];
  }
}

const V1_VISUALIZATION: Record<BuilderChartType, Visualization> = {
  bar: 'bar',
  line: 'line',
  area: 'area',
  pie: 'pie',
  table: 'table',
  stat: 'number',
};

/**
 * Turn a v1 builder spec into an equivalent v2 question. v1's "spending" and
 * "average" measures only counted non-income lines; v2's Spending metric does
 * the same. v1's "exclude transfers / off-budget" toggles become filters.
 */
export function upgradeLegacySpec(input: unknown): QuestionSpec {
  const v1 = normalizeSpec(input);
  const filters: QuestionFilter[] = [];
  const date = v1DateFilter(v1.dateRange);
  if (date) filters.push(date);
  if (!v1.includeTransfers) filters.push({ field: 'is_transfer', op: 'is', values: [false] });
  if (!v1.includeOffBudget) filters.push({ field: 'on_budget', op: 'is', values: [true] });
  const { accountIds, categoryIds, categoryGroupIds, payees, labelIds } = v1.filters;
  if (accountIds.length) filters.push({ field: 'account', op: 'is', values: accountIds });
  if (categoryIds.length) filters.push({ field: 'category', op: 'is', values: categoryIds });
  if (categoryGroupIds.length) {
    filters.push({ field: 'category_group', op: 'is', values: categoryGroupIds });
  }
  if (payees.length) filters.push({ field: 'payee', op: 'is', values: payees });
  if (labelIds.length) filters.push({ field: 'label', op: 'is', values: labelIds });

  const aggregations = v1Aggregations(v1.measure);
  const isStat = v1.chartType === 'stat';
  const breakouts = isStat
    ? []
    : [v1Breakout(v1.groupBy), ...(v1.splitBy ? [v1Breakout(v1.splitBy)] : [])];

  const draft = normalizeQuestion({
    v: 2,
    source: 'transactions',
    filters,
    aggregations,
    breakouts,
    sort: [],
    limit: null,
    columns: null,
    visualization: V1_VISUALIZATION[v1.chartType],
  });
  if (isStat || isTimeDimension(v1.groupBy)) return draft;

  // Categorical axes: v1 sorted by value (or label) and kept the top N labels.
  const [firstBreakout] = questionColumns(draft).filter((column) => column.kind === 'breakout');
  const [firstMetric] = questionColumns(draft).filter((column) => column.kind === 'aggregation');
  const sort =
    v1.sort === 'label'
      ? [{ column: firstBreakout.key, direction: 'asc' as const }]
      : [
          {
            column: firstMetric.key,
            direction: v1.sort === 'valueAsc' ? ('asc' as const) : ('desc' as const),
          },
        ];
  return normalizeQuestion({ ...draft, sort, limit: v1.limit });
}
