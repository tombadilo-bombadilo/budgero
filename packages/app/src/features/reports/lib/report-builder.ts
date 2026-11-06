/**
 * Report builder: a small, declarative report spec compiled to a read-only
 * DuckDB SELECT over the curated `transactions_analytics` view.
 *
 * Saved builder reports store the generated SQL with a first-line header
 * (`-- budgero-builder: <json spec>`) so they can be reopened in the builder
 * without a schema change; everything after the header is plain SQL that the
 * report runner executes like any other saved report.
 *
 * Split transactions: `transactions_analytics` has one row per transaction,
 * carrying the parent's (empty) category. The compiled SQL therefore expands
 * split transactions into their split lines (joined from the snapshotted
 * `transaction_splits` table) so category / category group / payee
 * breakdowns attribute each split line to its own category and payee.
 */
import { z } from 'zod';
import type { ChartConfiguration } from '@budgero/core/browser';

export const BUILDER_MEASURES = [
  'spending',
  'income',
  'net',
  'incomeVsSpending',
  'count',
  'average',
] as const;
export const BUILDER_DIMENSIONS = [
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
export const BUILDER_DATE_PRESETS = [
  'thisMonth',
  'last3Months',
  'last6Months',
  'last12Months',
  'yearToDate',
  'allTime',
  'custom',
] as const;
export const BUILDER_CHART_TYPES = ['bar', 'line', 'area', 'pie', 'table', 'stat'] as const;
export const BUILDER_SORTS = ['valueDesc', 'valueAsc', 'label'] as const;

export type BuilderMeasure = (typeof BUILDER_MEASURES)[number];
export type BuilderDimension = (typeof BUILDER_DIMENSIONS)[number];
export type BuilderDatePreset = (typeof BUILDER_DATE_PRESETS)[number];
export type BuilderChartType = (typeof BUILDER_CHART_TYPES)[number];
export type BuilderSort = (typeof BUILDER_SORTS)[number];

export const TIME_DIMENSIONS: readonly BuilderDimension[] = ['month', 'week', 'quarter', 'year'];
export const DEFAULT_CATEGORICAL_LIMIT = 12;
export const MAX_BUILDER_LIMIT = 500;

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

/** Display text for rows with no category / payee / label. Baked into the SQL. */
export interface ReportBuilderLabels {
  uncategorized: string;
  noPayee: string;
  noLabel: string;
  noAccount: string;
  income: string;
  spending: string;
}

export const DEFAULT_BUILDER_LABELS: ReportBuilderLabels = {
  uncategorized: 'Uncategorized',
  noPayee: 'No payee',
  noLabel: 'No label',
  noAccount: 'No account',
  income: 'Income',
  spending: 'Spending',
};

export interface CompileOptions {
  budgetId: number;
  labels?: ReportBuilderLabels;
  /** Chart id to reuse (keeps dashboard widgets pointing at the same chart). */
  chartId?: string;
  chartTitle?: string;
}

export interface CompiledReport {
  sql: string;
  chart: ChartConfiguration;
}

/** Column aliases of every compiled query. */
export const BUILDER_COLUMNS = { label: 'label', series: 'series', value: 'value' } as const;

export const BUILDER_HEADER_PREFIX = '-- budgero-builder:';

export function isTimeDimension(dimension: BuilderDimension | null | undefined): boolean {
  return dimension != null && TIME_DIMENSIONS.includes(dimension);
}

export function createDefaultSpec(overrides: Partial<ReportBuilderSpec> = {}): ReportBuilderSpec {
  return normalizeSpec({
    measure: 'spending',
    groupBy: 'category',
    splitBy: null,
    dateRange: { preset: 'last12Months' },
    filters: { accountIds: [], categoryIds: [], categoryGroupIds: [], payees: [], labelIds: [] },
    includeTransfers: false,
    includeOffBudget: false,
    chartType: 'bar',
    sort: 'valueDesc',
    limit: DEFAULT_CATEGORICAL_LIMIT,
    ...overrides,
  });
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
// SQL helpers
// ---------------------------------------------------------------------------

/** Single-quoted SQL string literal; doubles embedded quotes, drops NULs. */
export function sqlString(value: string): string {
  // eslint-disable-next-line no-control-regex
  return `'${value.replace(/\u0000/g, '').replace(/'/g, "''")}'`;
}

function sqlIdList(ids: number[]): string {
  return ids
    .filter((id) => Number.isSafeInteger(id))
    .map((id) => String(id))
    .join(', ');
}

/** `YYYY-MM-DD` of a DuckDB DATE expression. */
function isoOf(dateExpr: string): string {
  return `strftime(${dateExpr}, '%Y-%m-%d')`;
}

/**
 * Date bounds as SQL expressions over the `date` column ('YYYY-MM-DD' text).
 * Presets are relative to CURRENT_DATE so a saved "last 12 months" report
 * keeps rolling. Presets run through the end of the current month.
 */
function dateConditions(range: ReportBuilderSpec['dateRange']): string[] {
  const monthStart = `DATE_TRUNC('month', CURRENT_DATE)`;
  const nextMonth = `${monthStart} + INTERVAL 1 MONTH`;
  const relative = (from: string) => [`date >= ${isoOf(from)}`, `date < ${isoOf(nextMonth)}`];

  switch (range.preset) {
    case 'thisMonth':
      return relative(monthStart);
    case 'last3Months':
      return relative(`${monthStart} - INTERVAL 2 MONTH`);
    case 'last6Months':
      return relative(`${monthStart} - INTERVAL 5 MONTH`);
    case 'last12Months':
      return relative(`${monthStart} - INTERVAL 11 MONTH`);
    case 'yearToDate':
      return relative(`DATE_TRUNC('year', CURRENT_DATE)`);
    case 'allTime':
      return [];
    case 'custom': {
      const conditions: string[] = [];
      if (range.from && isValidIsoDate(range.from))
        conditions.push(`date >= ${sqlString(range.from)}`);
      if (range.to && isValidIsoDate(range.to)) conditions.push(`date <= ${sqlString(range.to)}`);
      return conditions;
    }
  }
}

function dimensionExpression(dimension: BuilderDimension, labels: ReportBuilderLabels): string {
  switch (dimension) {
    case 'month':
      return `SUBSTR(month, 1, 7)`;
    case 'week':
      return `week`;
    case 'quarter':
      return `SUBSTR(quarter, 1, 4) || '-Q' || CASE SUBSTR(quarter, 6, 2) WHEN '01' THEN '1' WHEN '04' THEN '2' WHEN '07' THEN '3' ELSE '4' END`;
    case 'year':
      return `SUBSTR(year, 1, 4)`;
    case 'category':
      return `COALESCE(NULLIF(TRIM(category_name), ''), ${sqlString(labels.uncategorized)})`;
    case 'categoryGroup':
      return `COALESCE(NULLIF(TRIM(category_group_name), ''), ${sqlString(labels.uncategorized)})`;
    case 'payee':
      return `COALESCE(NULLIF(TRIM(payee_name), ''), ${sqlString(labels.noPayee)})`;
    case 'account':
      return `COALESCE(NULLIF(TRIM(account_name), ''), ${sqlString(labels.noAccount)})`;
    case 'label':
      return `COALESCE(NULLIF(TRIM(label_name), ''), ${sqlString(labels.noLabel)})`;
  }
}

function measureExpression(measure: BuilderMeasure): string {
  switch (measure) {
    case 'spending':
      return `CAST(COALESCE(SUM(outflow - inflow), 0) AS DOUBLE)`;
    case 'income':
      return `CAST(COALESCE(SUM(inflow - outflow), 0) AS DOUBLE)`;
    case 'net':
      return `CAST(COALESCE(SUM(inflow - outflow), 0) AS DOUBLE)`;
    case 'incomeVsSpending':
      return `CAST(COALESCE(SUM(CASE WHEN is_income THEN inflow - outflow ELSE outflow - inflow END), 0) AS DOUBLE)`;
    case 'count':
      return `COUNT(DISTINCT transaction_id)`;
    case 'average':
      return `CAST(COALESCE(ROUND(SUM(outflow - inflow) / NULLIF(COUNT(DISTINCT transaction_id), 0), 2), 0) AS DOUBLE)`;
  }
}

/** Line-level rows: unsplit transactions plus one row per split line. */
function linesCte(budgetId: number, spec: ReportBuilderSpec): string {
  const parentConditions = [`t.budget_id = ${budgetId}`];
  if (!spec.includeOffBudget) parentConditions.push('t.account_on_budget = 1');
  const parentWhere = parentConditions.join(' AND ');

  return `lines AS (
  SELECT
    t.transaction_id, t.date, t.week, t.month, t.quarter, t.year,
    t.account_id, t.account_name, t.label_id, t.label_name, t.payee_name,
    t.category_id, t.category_name, t.category_group_id, t.category_group_name,
    t.inflow, t.outflow,
    COALESCE(t.transfer_id, '') <> '' AS is_transfer
  FROM transactions_analytics t
  WHERE ${parentWhere} AND NOT t.has_splits
  UNION ALL
  SELECT
    t.transaction_id, t.date, t.week, t.month, t.quarter, t.year,
    t.account_id, t.account_name, t.label_id, t.label_name,
    COALESCE(NULLIF(TRIM(s."Payee"), ''), t.payee_name) AS payee_name,
    s."CategoryID" AS category_id, c."Name" AS category_name,
    c."CategoryGroupID" AS category_group_id, cg."Name" AS category_group_name,
    CAST(COALESCE(s."InflowConverted", 0) / 1000.0 AS DECIMAL(18, 3)) AS inflow,
    CAST(COALESCE(s."OutflowConverted", 0) / 1000.0 AS DECIMAL(18, 3)) AS outflow,
    COALESCE(t.transfer_id, '') <> '' OR COALESCE(s."TransferAccountID", 0) <> 0 AS is_transfer
  FROM transactions_analytics t
  JOIN transaction_splits s ON s."TransactionID" = t.transaction_id
  LEFT JOIN categories c ON c."ID" = s."CategoryID"
  LEFT JOIN category_groups cg ON cg."ID" = c."CategoryGroupID"
  WHERE ${parentWhere} AND t.has_splits
)`;
}

const IS_INCOME = `COALESCE(category_group_name, '') = 'Income'`;

function baseConditions(spec: ReportBuilderSpec): string[] {
  const conditions: string[] = [...dateConditions(spec.dateRange)];
  const isIncome = IS_INCOME;

  if (!spec.includeTransfers) {
    conditions.push('NOT is_transfer');
    // Legacy budgets kept transfers in a "Transfers" category group.
    conditions.push(`COALESCE(category_group_name, '') <> 'Transfers'`);
  }
  if (spec.measure === 'spending' || spec.measure === 'average') {
    conditions.push(`NOT (${isIncome})`);
  } else if (spec.measure === 'income') {
    conditions.push(isIncome);
  }

  const { filters } = spec;
  if (filters.accountIds.length > 0) {
    conditions.push(`account_id IN (${sqlIdList(filters.accountIds)})`);
  }
  if (filters.categoryIds.length > 0) {
    conditions.push(`category_id IN (${sqlIdList(filters.categoryIds)})`);
  }
  if (filters.categoryGroupIds.length > 0) {
    conditions.push(`category_group_id IN (${sqlIdList(filters.categoryGroupIds)})`);
  }
  if (filters.labelIds.length > 0) {
    conditions.push(`label_id IN (${sqlIdList(filters.labelIds)})`);
  }
  if (filters.payees.length > 0) {
    const names = filters.payees.map((name) => sqlString(name.trim().toLowerCase())).join(', ');
    conditions.push(`LOWER(TRIM(COALESCE(payee_name, ''))) IN (${names})`);
  }
  return conditions;
}

// ---------------------------------------------------------------------------
// Compiler
// ---------------------------------------------------------------------------

export function compileReportSpec(
  input: ReportBuilderSpec,
  options: CompileOptions
): CompiledReport {
  const { budgetId } = options;
  if (!Number.isSafeInteger(budgetId) || budgetId <= 0) {
    throw new Error('A budget must be selected to build a report.');
  }
  const spec = normalizeSpec(input);
  const labels = options.labels ?? DEFAULT_BUILDER_LABELS;
  const value = measureExpression(spec.measure);
  const conditions = baseConditions(spec);
  const where = conditions.length > 0 ? `\nWHERE ${conditions.join('\n  AND ')}` : '';

  const chart: ChartConfiguration = {
    id: options.chartId ?? cryptoRandomId(),
    chartType: spec.chartType,
    ...(options.chartTitle ? { title: options.chartTitle } : {}),
    xAxisColumn: BUILDER_COLUMNS.label,
    yAxisColumn: BUILDER_COLUMNS.value,
    aggregateFunction: 'SUM',
  };

  const ctes: string[] = [linesCte(budgetId, spec)];
  let finalSelect: string;

  if (spec.chartType === 'stat') {
    chart.xAxisColumn = BUILDER_COLUMNS.value;
    ctes.push(`base AS (\nSELECT transaction_id, inflow, outflow\nFROM lines${where}\n)`);
    finalSelect = `SELECT ${value} AS value\nFROM base`;
  } else {
    const flowSeries = spec.measure === 'incomeVsSpending';
    const hasSeries = spec.splitBy !== null || flowSeries;
    const labelExpr = dimensionExpression(spec.groupBy, labels);
    let seriesExpr: string | null = null;
    if (flowSeries) {
      seriesExpr = `CASE WHEN ${IS_INCOME} THEN ${sqlString(labels.income)} ELSE ${sqlString(labels.spending)} END`;
    } else if (spec.splitBy) {
      seriesExpr = dimensionExpression(spec.splitBy, labels);
    }
    if (hasSeries) chart.groupByColumn = BUILDER_COLUMNS.series;

    const dims = hasSeries ? 'label, series' : 'label';
    ctes.push(
      `base AS (\nSELECT\n  ${labelExpr} AS label,${seriesExpr ? `\n  ${seriesExpr} AS series,` : ''}\n  transaction_id, inflow, outflow, ${IS_INCOME} AS is_income\nFROM lines${where}\n)`
    );
    ctes.push(`agg AS (\nSELECT ${dims}, ${value} AS value\nFROM base\nGROUP BY ${dims}\n)`);

    const timeAxis = isTimeDimension(spec.groupBy);
    const totalOrder = spec.sort === 'valueAsc' ? 'total ASC' : 'total DESC';
    const limit = timeAxis ? null : spec.limit;

    // Rank labels by their total (across series) so Top N and value sorts
    // treat a label as one bar even when it is split into series.
    ctes.push(
      `totals AS (\nSELECT label, SUM(value) AS total\nFROM agg\nGROUP BY label${
        limit ? `\nORDER BY ${totalOrder}, label\nLIMIT ${limit}` : ''
      }\n)`
    );

    let order: string;
    if (timeAxis || spec.sort === 'label') {
      order = 'agg.label';
    } else {
      order = `totals.${totalOrder}, agg.label`;
    }
    if (hasSeries) order += ', agg.series';

    finalSelect = `SELECT agg.label, ${hasSeries ? 'agg.series, ' : ''}agg.value\nFROM agg\nJOIN totals ON totals.label = agg.label\nORDER BY ${order}`;
  }

  const sql = `WITH ${ctes.join(',\n')}\n${finalSelect}`;
  return {
    sql: sql
      .split('\n')
      .map((line) => line.trimEnd())
      .join('\n'),
    chart,
  };
}

function cryptoRandomId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `chart-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

// ---------------------------------------------------------------------------
// Saved-report header
// ---------------------------------------------------------------------------

/** Compact spec for the header: drops empty filters and defaults. */
function compactSpec(spec: ReportBuilderSpec): Record<string, unknown> {
  const filters = Object.fromEntries(
    Object.entries(spec.filters).filter(([, values]) => (values as unknown[]).length > 0)
  );
  return {
    v: 1,
    measure: spec.measure,
    groupBy: spec.groupBy,
    ...(spec.splitBy ? { splitBy: spec.splitBy } : {}),
    dateRange: spec.dateRange,
    ...(Object.keys(filters).length > 0 ? { filters } : {}),
    ...(spec.includeTransfers ? { includeTransfers: true } : {}),
    ...(spec.includeOffBudget ? { includeOffBudget: true } : {}),
    chartType: spec.chartType,
    sort: spec.sort,
    limit: spec.limit,
  };
}

/** `-- budgero-builder: {...}` — JSON.stringify never emits a raw newline. */
export function serializeBuilderHeader(spec: ReportBuilderSpec): string {
  return `${BUILDER_HEADER_PREFIX} ${JSON.stringify(compactSpec(normalizeSpec(spec)))}`;
}

/** The query stored for a builder report: header line + generated SQL. */
export function buildSavedBuilderQuery(spec: ReportBuilderSpec, sql: string): string {
  return `${serializeBuilderHeader(spec)}\n${sql}`;
}

/** Returns the spec stored in a saved query's header, or null for plain SQL reports. */
export function parseBuilderHeader(query: string | null | undefined): ReportBuilderSpec | null {
  if (!query) return null;
  const firstLine = query.replace(/^\s+/, '').split('\n', 1)[0] ?? '';
  if (!firstLine.startsWith(BUILDER_HEADER_PREFIX)) return null;
  const json = firstLine.slice(BUILDER_HEADER_PREFIX.length).trim();
  try {
    const parsed: unknown = JSON.parse(json);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return normalizeSpec(parsed);
  } catch {
    return null;
  }
}

/** The SQL body of a saved query without the builder header line. */
export function stripBuilderHeader(query: string): string {
  const trimmed = query.replace(/^\s+/, '');
  if (!trimmed.startsWith(BUILDER_HEADER_PREFIX)) return query;
  const newline = trimmed.indexOf('\n');
  return newline === -1 ? '' : trimmed.slice(newline + 1);
}

// ---------------------------------------------------------------------------
// Starter templates
// ---------------------------------------------------------------------------

export type BuilderTemplateId =
  | 'spendingByCategory'
  | 'incomeVsSpending'
  | 'netByMonth'
  | 'topPayees'
  | 'spendingByLabel'
  | 'spendingByGroupOverTime';

export const BUILDER_TEMPLATES: Record<BuilderTemplateId, ReportBuilderSpec> = {
  spendingByCategory: createDefaultSpec({
    measure: 'spending',
    groupBy: 'category',
    dateRange: { preset: 'last12Months' },
    chartType: 'bar',
  }),
  incomeVsSpending: createDefaultSpec({
    measure: 'incomeVsSpending',
    groupBy: 'month',
    dateRange: { preset: 'last12Months' },
    chartType: 'bar',
  }),
  netByMonth: createDefaultSpec({
    measure: 'net',
    groupBy: 'month',
    dateRange: { preset: 'last12Months' },
    chartType: 'line',
  }),
  topPayees: createDefaultSpec({
    measure: 'spending',
    groupBy: 'payee',
    dateRange: { preset: 'last12Months' },
    chartType: 'bar',
    limit: 10,
  }),
  spendingByLabel: createDefaultSpec({
    measure: 'spending',
    groupBy: 'label',
    dateRange: { preset: 'last6Months' },
    chartType: 'pie',
  }),
  spendingByGroupOverTime: createDefaultSpec({
    measure: 'spending',
    groupBy: 'month',
    splitBy: 'categoryGroup',
    dateRange: { preset: 'last6Months' },
    chartType: 'bar',
  }),
};
