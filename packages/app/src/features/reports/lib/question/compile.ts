/**
 * Question spec → one read-only DuckDB SELECT.
 *
 * Safety: every identifier in the SQL comes from the fixed field tables in
 * `fields.ts` (never from user input); user values only enter as escaped
 * string literals, validated numbers, validated ISO dates or booleans. The
 * budget id is a validated integer and scopes every budget-owned table.
 *
 * Split transactions: the Transactions source expands split transactions into
 * their split lines (from the snapshotted `transaction_splits` table) so
 * category / group / payee breakdowns attribute each line to its own category.
 */
import type { ChartConfiguration } from '@budgero/core/browser';
import {
  getField,
  type DateBucket,
  type DatePart,
  type FieldDef,
  type QuestionSource,
} from './fields';
import { expressionToSql, type ExprMetricName, type ExprSqlEnv } from './expression';
import {
  customFields,
  expressionFields,
  isValidIsoDate,
  lookupField,
  normalizeQuestion,
  parseCustomMetric,
  questionColumns,
  resolveVisualization,
  trendDateFilter,
  type CustomFields,
  type QuestionAggregation,
  type QuestionColumn,
  type QuestionFilter,
  type QuestionHaving,
  type QuestionSpec,
  type RelativeUnit,
  type ResolvedVisualization,
  AUTO_BIN_COUNT,
  isOrderedBreakout,
} from './spec';

/** Display text for rows with no category / payee / label / account. Baked into the SQL. */
export interface QuestionSqlLabels {
  uncategorized: string;
  noPayee: string;
  noLabel: string;
  noAccount: string;
}

export const DEFAULT_SQL_LABELS: QuestionSqlLabels = {
  uncategorized: 'Uncategorized',
  noPayee: 'No payee',
  noLabel: 'No label',
  noAccount: 'No account',
};

export interface CompileQuestionOptions {
  budgetId: number;
  labels?: QuestionSqlLabels;
  /** Chart id to reuse (keeps dashboard widgets pointing at the same chart). */
  chartId?: string;
  chartTitle?: string;
  /**
   * Fixed "today" (ISO date) for relative date filters. Omit in the app so
   * saved questions keep rolling with CURRENT_DATE; tests pin it.
   */
  today?: string;
}

export interface CompiledQuestion {
  sql: string;
  chart: ChartConfiguration;
  columns: QuestionColumn[];
  visualization: ResolvedVisualization;
  spec: QuestionSpec;
}

// ---------------------------------------------------------------------------
// Literals
// ---------------------------------------------------------------------------

/** Single-quoted SQL string literal; doubles embedded quotes, drops NULs. */
export function sqlString(value: string): string {
  // eslint-disable-next-line no-control-regex
  return `'${value.replace(/\u0000/g, '').replace(/'/g, "''")}'`;
}

function sqlNumber(value: number): string {
  if (!Number.isFinite(value)) throw new Error('Invalid number in filter');
  return String(value);
}

function sqlDate(value: string): string {
  return `CAST(${sqlString(value)} AS DATE)`;
}

/** A DOUBLE literal that reads back as exactly this JS number (shortest round-trip text). */
function sqlDouble(value: number): string {
  if (!Number.isFinite(value)) throw new Error('Invalid number');
  return `CAST('${String(value)}' AS DOUBLE)`;
}

const DATE_PART_SQL: Record<DatePart, string> = {
  year: 'YEAR',
  quarterOfYear: 'QUARTER',
  monthOfYear: 'MONTH',
  dayOfMonth: 'DAY',
  dayOfWeek: 'ISODOW',
};

/** Whole-number date part of a date column. */
function datePartExpression(column: string, part: DatePart): string {
  return `CAST(${DATE_PART_SQL[part]}(${column}) AS INTEGER)`;
}

/** Index of the numeric bin a value falls in (same expression for grouping and drill filters). */
function binIndexExpression(column: string, width: string): string {
  return `FLOOR(CAST(${column} AS DOUBLE) / ${width})`;
}

function sqlTextList(values: readonly unknown[]): string {
  return values.map((value) => sqlString(String(value).trim().toLowerCase())).join(', ');
}

function sqlIdList(values: readonly unknown[]): string {
  return values
    .filter((value): value is number => typeof value === 'number' && Number.isSafeInteger(value))
    .map(String)
    .join(', ');
}

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

const nameOr = (expr: string, fallback: string) =>
  `COALESCE(NULLIF(TRIM(${expr}), ''), ${sqlString(fallback)})`;

/** Line-level transaction rows: unsplit transactions plus one row per split line. */
function linesCte(budgetId: number, onBudgetOnly: boolean): string {
  const where = [`t.budget_id = ${budgetId}`];
  if (onBudgetOnly) where.push('CAST(t.account_on_budget AS INTEGER) = 1');
  const parentWhere = where.join(' AND ');
  return `lines AS (
  SELECT
    t.transaction_id, t.date, t.account_id, t.account_name, t.account_on_budget,
    t.label_id, t.label_name, t.payee_name, t.memo, t.cleared,
    t.category_id, t.category_name, t.category_group_id, t.category_group_name,
    t.inflow, t.outflow,
    COALESCE(t.transfer_id, '') <> '' AS is_transfer
  FROM transactions_analytics t
  WHERE ${parentWhere} AND NOT t.has_splits
  UNION ALL
  SELECT
    t.transaction_id, t.date, t.account_id, t.account_name, t.account_on_budget,
    t.label_id, t.label_name,
    COALESCE(NULLIF(TRIM(s."Payee"), ''), t.payee_name) AS payee_name,
    COALESCE(NULLIF(TRIM(s."Memo"), ''), t.memo) AS memo, t.cleared,
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

function transactionsCtes(budgetId: number, labels: QuestionSqlLabels): string[] {
  return [
    linesCte(budgetId, false),
    `src AS (
  SELECT
    transaction_id,
    TRY_CAST(date AS DATE) AS date,
    account_id, ${nameOr('account_name', labels.noAccount)} AS account,
    category_id, ${nameOr('category_name', labels.uncategorized)} AS category,
    category_group_id, ${nameOr('category_group_name', labels.uncategorized)} AS category_group,
    payee_name, ${nameOr('payee_name', labels.noPayee)} AS payee,
    label_id, ${nameOr('label_name', labels.noLabel)} AS label,
    memo,
    inflow - outflow AS amount, inflow, outflow,
    is_transfer OR COALESCE(category_group_name, '') = 'Transfers' AS is_transfer,
    COALESCE(CAST(account_on_budget AS INTEGER), 0) = 1 AS on_budget,
    COALESCE(CAST(cleared AS INTEGER), 0) = 1 AS cleared,
    COALESCE(category_group_name, '') = 'Income' AS is_income
  FROM lines
)`,
  ];
}

/**
 * Budget rows: one per category per month with assigned (from `assignments`)
 * and activity (on-budget transaction lines, like the Budget page). Income and
 * Transfers groups are left out, as on the Budget page.
 */
function budgetCtes(budgetId: number, labels: QuestionSqlLabels): string[] {
  return [
    linesCte(budgetId, true),
    `budget_rows AS (
  SELECT
    SUBSTR(CAST(a."Month" AS VARCHAR), 1, 7) AS month_key,
    a."CategoryID" AS category_id,
    CAST(COALESCE(a."Amount", 0) / 1000.0 AS DECIMAL(18, 3)) AS assigned,
    CAST(0 AS DECIMAL(18, 3)) AS activity
  FROM assignments a
  WHERE a."BudgetID" = ${budgetId}
  UNION ALL
  SELECT SUBSTR(date, 1, 7), category_id, CAST(0 AS DECIMAL(18, 3)), inflow - outflow
  FROM lines
  WHERE category_id IS NOT NULL
)`,
    `src AS (
  SELECT
    TRY_CAST(b.month_key || '-01' AS DATE) AS month,
    b.category_id, ${nameOr('c."Name"', labels.uncategorized)} AS category,
    c."CategoryGroupID" AS category_group_id,
    ${nameOr('cg."Name"', labels.uncategorized)} AS category_group,
    SUM(b.assigned) AS assigned,
    SUM(b.activity) AS activity
  FROM budget_rows b
  JOIN categories c ON c."ID" = b.category_id AND c."BudgetID" = ${budgetId}
  LEFT JOIN category_groups cg ON cg."ID" = c."CategoryGroupID"
  WHERE COALESCE(cg."Name", '') NOT IN ('Income', 'Transfers')
  GROUP BY 1, 2, 3, 4, 5
)`,
  ];
}

function accountsCtes(budgetId: number, labels: QuestionSqlLabels): string[] {
  return [
    `account_totals AS (
  SELECT
    account_id,
    SUM(inflow - outflow) AS balance,
    SUM(COALESCE(inflow_original, inflow) - COALESCE(outflow_original, outflow)) AS balance_native,
    COUNT(*) AS transaction_count,
    MAX(TRY_CAST(date AS DATE)) AS last_transaction
  FROM transactions_analytics
  WHERE budget_id = ${budgetId}
  GROUP BY account_id
)`,
    `src AS (
  SELECT
    a."ID" AS account_id, ${nameOr('a."Name"', labels.noAccount)} AS account,
    a."Type" AS account_type,
    a."Currency" AS currency,
    COALESCE(CAST(a."OnBudget" AS INTEGER), 0) = 1 AS on_budget,
    COALESCE(CAST(a."Archived" AS INTEGER), 0) = 1 AS closed,
    CAST(COALESCE(x.balance, 0) AS DECIMAL(18, 3)) AS balance,
    CAST(COALESCE(x.balance_native, 0) AS DECIMAL(18, 3)) AS balance_native,
    COALESCE(x.transaction_count, 0) AS transaction_count,
    x.last_transaction
  FROM accounts a
  LEFT JOIN account_totals x ON x.account_id = a."ID"
  WHERE a."BudgetID" = ${budgetId}
)`,
  ];
}

function sourceCtes(source: QuestionSource, budgetId: number, labels: QuestionSqlLabels) {
  switch (source) {
    case 'transactions':
      return transactionsCtes(budgetId, labels);
    case 'budget':
      return budgetCtes(budgetId, labels);
    case 'accounts':
      return accountsCtes(budgetId, labels);
  }
}

// ---------------------------------------------------------------------------
// Expressions
// ---------------------------------------------------------------------------

function bucketExpression(column: string, bucket: DateBucket): string {
  switch (bucket) {
    case 'day':
      return `strftime(${column}, '%Y-%m-%d')`;
    case 'week':
      return `strftime(DATE_TRUNC('week', ${column}), '%Y-%m-%d')`;
    case 'month':
      return `strftime(${column}, '%Y-%m')`;
    case 'quarter':
      return `strftime(${column}, '%Y') || '-Q' || CAST(QUARTER(${column}) AS VARCHAR)`;
    case 'year':
      return `strftime(${column}, '%Y')`;
  }
}

/** Raw column output for a field (dates as ISO text, money as DOUBLE). */
function rawFieldExpression(field: FieldDef, source: QuestionSource): string {
  if (field.type === 'date') {
    return source === 'budget' && field.id === 'month'
      ? `strftime(${field.id}, '%Y-%m')`
      : `strftime(${field.id}, '%Y-%m-%d')`;
  }
  if (field.type === 'number') return `CAST(${field.id} AS DOUBLE)`;
  return field.id;
}

/** Raw text column of a name-keyed field (payees by their raw name, so "No payee" never matches). */
function rawTextColumn(field: FieldDef): string {
  return field.id === 'payee' ? 'payee_name' : field.id;
}

/**
 * Column holding a field's searchable / comparable text (lower-cased,
 * trimmed). Groupings on text use the same key, so a drill-through filter
 * matches exactly the rows behind a cell.
 */
function textColumn(field: FieldDef): string {
  return `LOWER(TRIM(COALESCE(${rawTextColumn(field)}, '')))`;
}

function emptyCondition(field: FieldDef): string {
  if (field.type === 'entity' && field.idKeyed) return `${field.id}_id IS NULL`;
  if (field.id === 'payee') return `NULLIF(TRIM(payee_name), '') IS NULL`;
  if (field.type === 'text') return `NULLIF(TRIM(${field.id}), '') IS NULL`;
  return `${field.id} IS NULL`;
}

function unitInterval(unit: RelativeUnit, amount: number): string {
  return `INTERVAL ${Math.floor(amount)} ${unit.toUpperCase()}`;
}

function dateCondition(column: string, filter: QuestionFilter, today: string): string | null {
  const [first, second] = filter.values as string[];
  switch (filter.op) {
    case 'previous':
    case 'current': {
      const unit = filter.unit ?? 'month';
      const start = `CAST(DATE_TRUNC('${unit}', ${today}) AS DATE)`;
      const amount = filter.op === 'current' ? 1 : (filter.amount ?? 1);
      const includeCurrent = filter.op === 'current' || filter.includeCurrent !== false;
      const from = includeCurrent
        ? amount > 1
          ? `${start} - ${unitInterval(unit, amount - 1)}`
          : start
        : `${start} - ${unitInterval(unit, amount)}`;
      const to = includeCurrent ? `${start} + ${unitInterval(unit, 1)}` : start;
      return `${column} >= ${from} AND ${column} < ${to}`;
    }
    case 'between':
      return `${column} >= ${sqlDate(first)} AND ${column} <= ${sqlDate(second)}`;
    case 'before':
      return `${column} < ${sqlDate(first)}`;
    case 'after':
      return `${column} > ${sqlDate(first)}`;
    case 'is':
      return `${column} = ${sqlDate(first)}`;
    default:
      return null;
  }
}

/** Whether a filter limits a date range (not a date part). */
function isDateRangeFilter(filter: QuestionFilter): boolean {
  return filter.part === undefined;
}

function filterCondition(
  source: QuestionSource,
  filter: QuestionFilter,
  today: string,
  custom?: CustomFields,
  /** Replacement SQL for date columns' ranges (period comparisons shift them). */
  dateColumns?: ReadonlyMap<string, string>
): string | null {
  const field = lookupField(source, filter.field, custom);
  if (!field) return null;
  if (filter.op === 'isEmpty') return emptyCondition(field);
  if (filter.op === 'notEmpty') return `NOT (${emptyCondition(field)})`;

  switch (field.type) {
    case 'boolean':
      return `COALESCE(${field.id}, FALSE) = ${filter.values[0] === true ? 'TRUE' : 'FALSE'}`;
    case 'date': {
      if (filter.part) {
        const parts = sqlIdList(filter.values);
        if (!parts) return null;
        const expr = datePartExpression(field.id, filter.part);
        return filter.op === 'isNot'
          ? `(${field.id} IS NULL OR ${expr} NOT IN (${parts}))`
          : `${expr} IN (${parts})`;
      }
      return dateCondition(dateColumns?.get(field.id) ?? field.id, filter, today);
    }
    case 'number': {
      const column = `CAST(${field.id} AS DOUBLE)`;
      const numbers = filter.values as number[];
      if (filter.binWidth !== undefined && filter.op === 'between') {
        const index = Math.round(numbers[0] / filter.binWidth);
        if (!Number.isSafeInteger(index)) return null;
        return `${binIndexExpression(field.id, sqlDouble(filter.binWidth))} = ${index}`;
      }
      switch (filter.op) {
        case 'gt':
          return `${column} > ${sqlNumber(numbers[0])}`;
        case 'lt':
          return `${column} < ${sqlNumber(numbers[0])}`;
        case 'between':
          return `${column} BETWEEN ${sqlNumber(numbers[0])} AND ${sqlNumber(numbers[1])}`;
        case 'is':
          return `${column} IN (${numbers.map(sqlNumber).join(', ')})`;
        case 'isNot':
          return `(${field.id} IS NULL OR ${column} NOT IN (${numbers.map(sqlNumber).join(', ')}))`;
        default:
          return null;
      }
    }
    case 'entity':
    case 'text': {
      if (filter.op === 'contains' || filter.op === 'startsWith') {
        const needle = sqlString(String(filter.values[0]).trim().toLowerCase());
        // Search what the user sees: display names (incl. "Uncategorized").
        const haystack = `LOWER(COALESCE(${field.id}, ''))`;
        return filter.op === 'contains'
          ? `contains(${haystack}, ${needle})`
          : `starts_with(${haystack}, ${needle})`;
      }
      if (field.type === 'entity' && field.idKeyed) {
        const ids = sqlIdList(filter.values);
        if (!ids) return null;
        return filter.op === 'is'
          ? `${field.id}_id IN (${ids})`
          : `(${field.id}_id IS NULL OR ${field.id}_id NOT IN (${ids}))`;
      }
      const names = sqlTextList(filter.values);
      if (!names) return null;
      return filter.op === 'is'
        ? `${textColumn(field)} IN (${names})`
        : `${textColumn(field)} NOT IN (${names})`;
    }
  }
}

const SPENDING_LINE = 'NOT is_income';
const INCOME_LINE = 'is_income';

function aggregationExpression(
  source: QuestionSource,
  aggregation: QuestionAggregation,
  custom?: CustomFields
): string {
  const toDouble = (expr: string) => `CAST(COALESCE(${expr}, 0) AS DOUBLE)`;
  switch (aggregation.op) {
    case 'custom':
      return customMetricSql(source, aggregation.expression ?? '', custom);
    case 'count':
      return source === 'transactions' ? `COUNT(DISTINCT transaction_id)` : `COUNT(*)`;
    case 'sum':
      return toDouble(`SUM(${aggregation.field})`);
    case 'avg':
      return `CAST(ROUND(AVG(${aggregation.field}), 2) AS DOUBLE)`;
    case 'min':
      return `CAST(MIN(${aggregation.field}) AS DOUBLE)`;
    case 'max':
      return `CAST(MAX(${aggregation.field}) AS DOUBLE)`;
    case 'distinct': {
      const field = lookupField(source, aggregation.field ?? '', custom);
      const column =
        field?.type === 'entity' && field.idKeyed ? `${field.id}_id` : aggregation.field;
      return `COUNT(DISTINCT ${column})`;
    }
    case 'spending':
      return toDouble(`SUM(CASE WHEN ${SPENDING_LINE} THEN outflow - inflow ELSE 0 END)`);
    case 'income':
      return toDouble(`SUM(CASE WHEN ${INCOME_LINE} THEN inflow - outflow ELSE 0 END)`);
    case 'net':
      return toDouble(`SUM(inflow - outflow)`);
    case 'averageSpending':
      return toDouble(
        `ROUND(SUM(CASE WHEN ${SPENDING_LINE} THEN outflow - inflow ELSE 0 END) / NULLIF(COUNT(DISTINCT CASE WHEN ${SPENDING_LINE} THEN transaction_id END), 0), 2)`
      );
  }
}

function defaultRawOrder(source: QuestionSource): string {
  switch (source) {
    case 'transactions':
      return 'date DESC NULLS LAST, transaction_id DESC';
    case 'budget':
      return 'month DESC, category_group, category';
    case 'accounts':
      return 'account';
  }
}

// ---------------------------------------------------------------------------
// Compiler
// ---------------------------------------------------------------------------

export function compileQuestion(
  input: QuestionSpec,
  options: CompileQuestionOptions
): CompiledQuestion {
  const { budgetId } = options;
  if (!Number.isSafeInteger(budgetId) || budgetId <= 0) {
    throw new Error('A budget must be selected to build a report.');
  }
  const spec = normalizeQuestion(input);
  const labels = options.labels ?? DEFAULT_SQL_LABELS;
  const columns = questionColumns(spec);
  const visualization = resolveVisualization(spec);

  const today =
    options.today && isValidIsoDate(options.today) ? sqlDate(options.today) : 'CURRENT_DATE';
  const custom = customFields(spec.source, spec.customColumns);
  // A question that only measures spending (or only income) leaves the other
  // side's rows out, so "Spending by category" lists no income categories.
  const ops = spec.aggregations.map((aggregation) => aggregation.op);
  const sideCondition =
    ops.length > 0 && ops.every((op) => op === 'spending' || op === 'averageSpending')
      ? SPENDING_LINE
      : ops.length > 0 && ops.every((op) => op === 'income')
        ? INCOME_LINE
        : null;
  const trendCap = trendCapCondition(spec, visualization, today);
  /** WHERE clause; `dateColumns` shifts date ranges (same period last year). */
  const whereFor = (dateColumns?: ReadonlyMap<string, string>) => {
    const conditions = spec.filters
      .map((filter) => filterCondition(spec.source, filter, today, custom, dateColumns))
      .filter((condition): condition is string => Boolean(condition));
    if (sideCondition) conditions.push(sideCondition);
    if (trendCap) conditions.push(trendCap);
    return conditions.length > 0 ? `\nWHERE ${conditions.join('\n  AND ')}` : '';
  };
  const where = whereFor();
  const ctes = sourceCtes(spec.source, budgetId, labels);
  // Custom columns become real columns of `src_custom`, so every later step
  // (filters, groupings, metrics, raw output) reads them like source fields.
  let base = 'src';
  if (custom.size > 0) {
    ctes.push(customColumnsCte(spec.source, custom));
    base = 'src_custom';
  }
  const { limit } = spec;
  let body: string;

  if (spec.aggregations.length === 0) {
    const keys = new Set(columns.map((column) => column.key));
    const select = columns
      .map((column) => {
        const field = lookupField(spec.source, column.kind === 'field' ? column.field : '', custom);
        return field ? `${rawFieldExpression(field, spec.source)} AS ${column.key}` : null;
      })
      .filter(Boolean);
    // Sorting by a field that isn't shown: carried as a hidden sort column.
    const sortColumn = (column: string) => (keys.has(column) ? column : `${column}__sort`);
    for (const entry of spec.sort) {
      if (keys.has(entry.column)) continue;
      const field = lookupField(spec.source, entry.column, custom);
      if (field) select.push(`${rawFieldExpression(field, spec.source)} AS ${entry.column}__sort`);
    }
    // Sorts name output columns, so they apply over the projected rows; the
    // source's natural order breaks ties.
    ctes.push(
      `result AS (\nSELECT\n  ${select.join(',\n  ')},\n  ROW_NUMBER() OVER (ORDER BY ${defaultRawOrder(spec.source)}) AS row_order\nFROM ${base}${where}\n)`
    );
    const order = [
      ...spec.sort.map(
        (entry) => `${sortColumn(entry.column)} ${entry.direction.toUpperCase()} NULLS LAST`
      ),
      'row_order',
    ].join(', ');
    body = `SELECT ${columns.map((column) => column.key).join(', ')}\nFROM result\nORDER BY ${order}${
      limit ? `\nLIMIT ${limit}` : ''
    }`;
  } else {
    body = compileSummarized({ spec, columns, ctes, base, where, whereFor, custom, today });
  }

  const sql = `WITH ${ctes.join(',\n')}\n${body}`
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n');

  return {
    sql,
    chart: buildChartConfig(columns, visualization, options),
    columns,
    visualization,
    spec,
  };
}

/**
 * Number with trend: a period that includes today counts up to today, like
 * the previous period it is compared with (see `trendPeriods`), so
 * future-dated transactions don't inflate "this month so far".
 */
function trendCapCondition(
  spec: QuestionSpec,
  visualization: ResolvedVisualization,
  today: string
): string | null {
  if (visualization !== 'trend' || spec.breakouts.length > 0) return null;
  const filter = trendDateFilter(spec);
  if (!filter) return null;
  const includesToday =
    filter.op === 'current' || (filter.op === 'previous' && filter.includeCurrent !== false);
  return includesToday ? `${filter.field} <= ${today}` : null;
}

/** Stored chart type per visualization (dashboards read it back, see `chartTypeFor`). */
export const CHART_TYPE: Record<ResolvedVisualization, ChartConfiguration['chartType']> = {
  number: 'stat',
  line: 'line',
  bar: 'bar',
  area: 'area',
  pie: 'pie',
  table: 'table',
  trend: 'stat',
  combo: 'bar',
  pivot: 'table',
  calendar: 'table',
  waterfall: 'bar',
  sankey: 'table',
  scatter: 'scatter',
  row: 'bar',
  // Stored for dashboards and apps that don't know the newer types (v1.20 draws these).
  treemap: 'pie',
  radar: 'bar',
  progress: 'stat',
};

/** Chart config stored with the saved question (dashboards key widgets by its id). */
function buildChartConfig(
  columns: QuestionColumn[],
  visualization: ResolvedVisualization,
  options: CompileQuestionOptions
): ChartConfiguration {
  const breakouts = columns.filter((column) => column.kind === 'breakout');
  const metrics = columns.filter((column) => column.kind === 'aggregation');
  const first = columns[0]?.key ?? 'value';
  const metric = metrics[0]?.key ?? first;
  return {
    id: options.chartId ?? randomId(),
    chartType: CHART_TYPE[visualization],
    ...(options.chartTitle ? { title: options.chartTitle } : {}),
    xAxisColumn:
      visualization === 'number' || visualization === 'progress'
        ? metric
        : (breakouts[0]?.key ?? first),
    yAxisColumn: metric,
    ...(breakouts[1] ? { groupByColumn: breakouts[1].key } : {}),
    aggregateFunction: 'SUM',
  };
}

function randomId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `chart-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

// ---------------------------------------------------------------------------
// Custom expressions
// ---------------------------------------------------------------------------

/** SQL reading a field inside an expression (a known column; never user text). */
function expressionFieldSql(
  source: QuestionSource,
  custom: CustomFields | undefined,
  inline?: ReadonlyMap<string, string>
) {
  return (id: string): string => {
    const inlined = inline?.get(id);
    if (inlined) return `(${inlined})`;
    if (custom?.has(id)) return id;
    const field = getField(source, id);
    if (!field) throw new Error('Unknown field in expression');
    switch (field.type) {
      case 'number':
        return `CAST(${field.id} AS DOUBLE)`;
      case 'boolean':
        return `COALESCE(${field.id}, FALSE)`;
      case 'date':
        return field.id;
      default:
        return `COALESCE(${field.id}, '')`;
    }
  };
}

function expressionSqlEnv(
  source: QuestionSource,
  custom: CustomFields | undefined,
  inline?: ReadonlyMap<string, string>
): ExprSqlEnv {
  return {
    field: expressionFieldSql(source, custom, inline),
    metric: (name: ExprMetricName) =>
      aggregationExpression(source, { op: name === 'count' ? 'count' : name }),
    countIf: (condition: string) =>
      source === 'transactions'
        ? `COUNT(DISTINCT CASE WHEN ${condition} THEN transaction_id END)`
        : `COUNT(CASE WHEN ${condition} THEN 1 END)`,
    string: sqlString,
  };
}

function fieldTypes(source: QuestionSource, custom: CustomFields | undefined) {
  return new Map(expressionFields(source, custom).map((field) => [field.id, field.type]));
}

/** `src_custom`: the source plus one column per custom column (earlier ones inlined). */
function customColumnsCte(source: QuestionSource, custom: CustomFields): string {
  const types = fieldTypes(source, custom);
  const inline = new Map<string, string>();
  const selects: string[] = [];
  for (const [id, entry] of custom) {
    const sql = expressionToSql(entry.ast, expressionSqlEnv(source, undefined, inline), types);
    // Conditions that can't be decided (NULL) count as false, like source
    // booleans and the `is` filter, so groupings and drill-through agree.
    const typed =
      entry.info.type === 'number'
        ? `CAST(${sql} AS DOUBLE)`
        : entry.info.type === 'boolean'
          ? `COALESCE(${sql}, FALSE)`
          : sql;
    inline.set(id, typed);
    selects.push(`${typed} AS ${id}`);
  }
  return `src_custom AS (\nSELECT\n  *,\n  ${selects.join(',\n  ')}\nFROM src\n)`;
}

function customMetricSql(
  source: QuestionSource,
  expression: string,
  custom: CustomFields | undefined
): string {
  const parsed = parseCustomMetric(source, expression, custom);
  if (!parsed.ok) throw new Error(parsed.error.message);
  const sql = expressionToSql(
    parsed.value.ast,
    expressionSqlEnv(source, custom),
    fieldTypes(source, custom)
  );
  return `CAST(${sql} AS DOUBLE)`;
}

// ---------------------------------------------------------------------------
// Summarized questions: groupings, gap filling, metric modifiers
// ---------------------------------------------------------------------------

interface Dimension {
  key: string;
  /**
   * Hidden column (`<key>__key`): the entity id or raw text for entities and
   * text, the bin width for numeric bins.
   */
  hidden: string | null;
  /** Holds a parent name for same-name disambiguation (categories). */
  parent: string | null;
  bucket: DateBucket | null;
  fieldId: string;
  select: string[];
  group: string[];
  /** SQL over source rows that identifies the group (period comparisons join on it). */
  matchKey: string;
  /** The same key read from a result row (`alias.` prefixed columns). */
  matchResult: (alias: string) => string;
}

const SERIES_STEP: Record<DateBucket, string> = {
  day: 'INTERVAL 1 DAY',
  week: 'INTERVAL 7 DAY',
  month: 'INTERVAL 1 MONTH',
  quarter: 'INTERVAL 3 MONTH',
  year: 'INTERVAL 1 YEAR',
};

/** Shift that moves a date into the same bucket one year later (weeks keep their weekday). */
const LAST_YEAR_SHIFT: Record<DateBucket, string> = {
  day: 'INTERVAL 1 YEAR',
  week: 'INTERVAL 364 DAY',
  month: 'INTERVAL 1 YEAR',
  quarter: 'INTERVAL 1 YEAR',
  year: 'INTERVAL 1 YEAR',
};

/** Auto bin width: about AUTO_BIN_COUNT bins of a 1 / 2 / 5 × 10^n width over the filtered rows. */
function autoBinCte(name: string, column: string, base: string, where: string): string {
  return `${name} AS (
SELECT CASE WHEN r IS NULL OR r <= 0 THEN CAST(1 AS DOUBLE)
  ELSE GREATEST((CASE WHEN r / p <= 1 THEN 1 WHEN r / p <= 2 THEN 2 WHEN r / p <= 5 THEN 5 ELSE 10 END) * p, CAST(0.000001 AS DOUBLE)) END AS w
FROM (
  SELECT r, POW(10, FLOOR(LOG10(GREATEST(r, CAST(0.000001 AS DOUBLE))))) AS p
  FROM (SELECT (MAX(CAST(${column} AS DOUBLE)) - MIN(CAST(${column} AS DOUBLE))) / ${AUTO_BIN_COUNT} AS r FROM ${base}${where}) range
) scaled
)`;
}

interface DimensionOptions {
  /** SQL replacing the date column (period comparisons shift dates). */
  dateColumn?: string;
  /** Bin width SQL for a binned grouping. */
  binWidth?: string;
}

function dimensionFor(
  source: QuestionSource,
  column: Extract<QuestionColumn, { kind: 'breakout' }>,
  custom: CustomFields,
  options: DimensionOptions = {}
): Dimension {
  const { key, breakout } = column;
  const field = lookupField(source, breakout.field, custom);
  const id = field?.id ?? breakout.field;
  const plain = (expr: string, hidden: string | null = null): Dimension => ({
    key,
    hidden,
    parent: null,
    bucket: breakout.bucket ?? null,
    fieldId: id,
    select: [`${expr} AS ${key}`],
    group: [expr],
    matchKey: expr,
    matchResult: (alias) => `${alias}.${key}`,
  });
  if (breakout.bucket) {
    return plain(bucketExpression(options.dateColumn ?? id, breakout.bucket));
  }
  if (breakout.part) return plain(datePartExpression(options.dateColumn ?? id, breakout.part));
  if (breakout.bin !== undefined && options.binWidth) {
    const width = options.binWidth;
    const index = binIndexExpression(id, width);
    const dimension = plain(`${index} * ${width}`, `${key}__key`);
    dimension.select.push(`MIN(${width}) AS ${dimension.hidden}`);
    return dimension;
  }
  if (field && (field.type === 'entity' || field.type === 'text')) {
    const hidden = `${key}__key`;
    if (field.idKeyed) {
      // Group by id too: same-name categories in different groups stay apart.
      const dimension = plain(id, hidden);
      dimension.select.push(`${id}_id AS ${hidden}`);
      dimension.group.unshift(`${id}_id`);
      dimension.matchKey = `${id}_id`;
      dimension.matchResult = (alias) => `${alias}.${hidden}`;
      if (id === 'category' && source !== 'accounts') {
        dimension.parent = `${key}__parent`;
        dimension.select.push(`MIN(category_group) AS ${dimension.parent}`);
      }
      return dimension;
    }
    // Name-keyed text (payees, custom text columns, ...): group by the
    // trimmed, lower-cased text the filters compare, so "Amazon" and
    // "amazon " are one group and drilling into it finds exactly its rows.
    const raw = rawTextColumn(field);
    const normalized = textColumn(field);
    return {
      key,
      hidden,
      parent: null,
      bucket: null,
      fieldId: id,
      select: [`MIN(${id}) AS ${key}`, `MIN(NULLIF(TRIM(${raw}), '')) AS ${hidden}`],
      group: [normalized],
      matchKey: normalized,
      matchResult: (alias) => `LOWER(TRIM(COALESCE(${alias}.${hidden}, '')))`,
    };
  }
  return plain(id);
}

/** Columns a dimension carries through every step. */
function dimensionColumns(dimension: Dimension): string[] {
  return dimension.hidden ? [dimension.key, dimension.hidden] : [dimension.key];
}

/** Partition / ranking key: the id or raw value when there is one, else the label. */
function dimensionKey(dimension: Dimension): string {
  return dimension.hidden
    ? `COALESCE(CAST(${dimension.hidden} AS VARCHAR), CAST(${dimension.key} AS VARCHAR))`
    : dimension.key;
}

/** Inclusive [from, to] date bounds the filters put on a date field (SQL DATE expressions). */
function dateFilterBounds(
  filters: readonly QuestionFilter[],
  fieldId: string,
  today: string
): { from: string | null; to: string | null } {
  const froms: string[] = [];
  const tos: string[] = [];
  for (const filter of filters) {
    if (filter.field !== fieldId || !isDateRangeFilter(filter)) continue;
    const [first, second] = filter.values as string[];
    switch (filter.op) {
      case 'previous':
      case 'current': {
        const unit = filter.unit ?? 'month';
        const start = `CAST(DATE_TRUNC('${unit}', ${today}) AS DATE)`;
        const amount = filter.op === 'current' ? 1 : (filter.amount ?? 1);
        const includeCurrent = filter.op === 'current' || filter.includeCurrent !== false;
        froms.push(
          includeCurrent
            ? amount > 1
              ? `CAST(${start} - ${unitInterval(unit, amount - 1)} AS DATE)`
              : start
            : `CAST(${start} - ${unitInterval(unit, amount)} AS DATE)`
        );
        const end = includeCurrent ? `${start} + ${unitInterval(unit, 1)}` : start;
        tos.push(`CAST(${end} - INTERVAL 1 DAY AS DATE)`);
        break;
      }
      case 'between':
        froms.push(sqlDate(first));
        tos.push(sqlDate(second));
        break;
      case 'before':
        tos.push(`CAST(${sqlDate(first)} - INTERVAL 1 DAY AS DATE)`);
        break;
      case 'after':
        froms.push(`CAST(${sqlDate(first)} + INTERVAL 1 DAY AS DATE)`);
        break;
      case 'is':
        froms.push(sqlDate(first));
        tos.push(sqlDate(first));
        break;
      default:
        break;
    }
  }
  const combine = (fn: string, parts: string[]) =>
    parts.length === 0 ? null : parts.length === 1 ? parts[0] : `${fn}(${parts.join(', ')})`;
  return { from: combine('GREATEST', froms), to: combine('LEAST', tos) };
}

/** SQL condition of a "having" filter on an output column. */
function havingCondition(having: QuestionHaving): string | null {
  const { column, values: numbers } = having;
  switch (having.op) {
    case 'isEmpty':
      return `${column} IS NULL`;
    case 'notEmpty':
      return `${column} IS NOT NULL`;
    case 'gt':
      return `${column} > ${sqlNumber(numbers[0])}`;
    case 'lt':
      return `${column} < ${sqlNumber(numbers[0])}`;
    case 'between':
      return `${column} BETWEEN ${sqlNumber(numbers[0])} AND ${sqlNumber(numbers[1])}`;
    case 'is':
      return `${column} IN (${numbers.map(sqlNumber).join(', ')})`;
    case 'isNot':
      return `(${column} IS NULL OR ${column} NOT IN (${numbers.map(sqlNumber).join(', ')}))`;
  }
}

interface SummarizeContext {
  spec: QuestionSpec;
  columns: QuestionColumn[];
  ctes: string[];
  base: string;
  where: string;
  whereFor: (dateColumns?: ReadonlyMap<string, string>) => string;
  custom: CustomFields;
  today: string;
}

type BreakoutColumn = Extract<QuestionColumn, { kind: 'breakout' }>;
type MetricColumn = Extract<QuestionColumn, { kind: 'aggregation' }>;

/**
 * agg (GROUP BY, ids kept) → labeled (same-name categories get their group)
 * → filled (one row per date bucket, empty buckets get the empty-group value)
 * → shaped (running total / moving average / % of total) → compared (previous
 * period or same period last year, % change) → having (filters on metrics)
 * → ordered / limited output.
 */
function compileSummarized({
  spec,
  columns,
  ctes,
  base,
  where,
  whereFor,
  custom,
  today,
}: SummarizeContext): string {
  const { limit } = spec;
  const breakoutColumns = columns.filter(
    (column): column is BreakoutColumn => column.kind === 'breakout'
  );
  const metricColumns = columns.filter(
    (column): column is MetricColumn => column.kind === 'aggregation' && !column.derived
  );
  // Numeric bins: a fixed width, or one computed from the filtered rows.
  const binWidths = new Map<string, string>();
  for (const column of breakoutColumns) {
    const { bin, field } = column.breakout;
    if (bin === undefined) continue;
    if (bin === 'auto') {
      const name = `bin_${column.key}`;
      ctes.push(autoBinCte(name, field, base, where));
      binWidths.set(column.key, `(SELECT w FROM ${name})`);
    } else {
      binWidths.set(column.key, sqlDouble(bin));
    }
  }
  const dimensions = breakoutColumns.map((column) =>
    dimensionFor(spec.source, column, custom, { binWidth: binWidths.get(column.key) })
  );
  const dateDimension = dimensions.find((dimension) => dimension.bucket !== null) ?? null;
  const otherDimensions = dimensions.filter((dimension) => dimension !== dateDimension);
  const modified = (column: MetricColumn) => Boolean(column.aggregation.modifier);
  const valueAlias = (column: MetricColumn) =>
    modified(column) ? `${column.key}__raw` : column.key;
  const timeSeries = metricColumns.some(
    (column) =>
      column.aggregation.compare ||
      column.aggregation.modifier === 'running' ||
      column.aggregation.modifier === 'moving'
  );
  const fill = dateDimension !== null && (dimensions.length === 1 || timeSeries);

  const metricSelects = metricColumns.map(
    (column) =>
      `${aggregationExpression(spec.source, column.aggregation, custom)} AS ${valueAlias(column)}`
  );
  const groupBy =
    dimensions.length > 0
      ? `\nGROUP BY ${dimensions.flatMap((dimension) => dimension.group).join(', ')}`
      : '';
  ctes.push(
    `agg AS (\nSELECT\n  ${[
      ...dimensions.flatMap((dimension) => dimension.select),
      ...metricSelects,
      ...(fill ? ['1 AS __present'] : []),
    ].join(',\n  ')}\nFROM ${base}${where}${groupBy}\n)`
  );
  let current = 'agg';

  const parented = dimensions.filter((dimension) => dimension.parent);
  if (parented.length > 0) {
    const replace = parented.map((dimension) => {
      const { key, hidden, parent } = dimension;
      const window = `OVER (PARTITION BY ${key})`;
      return `CASE WHEN MIN(COALESCE(${hidden}, -1)) ${window} <> MAX(COALESCE(${hidden}, -1)) ${window} AND ${parent} IS NOT NULL THEN ${key} || ' (' || ${parent} || ')' ELSE ${key} END AS ${key}`;
    });
    ctes.push(
      `labeled AS (\nSELECT * EXCLUDE (${parented.map((dimension) => dimension.parent).join(', ')}) REPLACE (\n  ${replace.join(',\n  ')}\n)\nFROM ${current}\n)`
    );
    current = 'labeled';
  }

  if (fill && dateDimension?.bucket) {
    const { bucket, fieldId, key: dateKey } = dateDimension;
    const bounds = dateFilterBounds(spec.filters, fieldId, today);
    const from = bounds.from ?? 'lo';
    const to = bounds.to ? `LEAST(${bounds.to}, GREATEST(hi, ${today}))` : 'hi';
    ctes.push(
      `fill_bounds AS (\nSELECT MIN(${fieldId}) AS lo, MAX(${fieldId}) AS hi\nFROM ${base}${where}\n)`,
      `fill_buckets AS (\nSELECT DISTINCT ${bucketExpression('d', bucket)} AS ${dateKey}\nFROM (\n  SELECT UNNEST(generate_series(CAST(DATE_TRUNC('${bucket}', ${from}) AS TIMESTAMP), CAST(${to} AS TIMESTAMP), ${SERIES_STEP[bucket]})) AS d\n  FROM fill_bounds\n) series\n)`,
      `fill_empty AS (\nSELECT\n  ${metricSelects.join(',\n  ')}\nFROM ${base}\nWHERE FALSE\n)`
    );
    const others = otherDimensions.flatMap(dimensionColumns);
    if (others.length > 0) {
      ctes.push(`fill_others AS (\nSELECT DISTINCT ${others.join(', ')}\nFROM ${current}\n)`);
    }
    const dimensionOutputs = dimensions.flatMap((dimension) =>
      dimensionColumns(dimension).map((name) =>
        dimension === dateDimension ? `b.${name}` : `o.${name}`
      )
    );
    const values = metricColumns.map(valueAlias);
    const join = [
      `a.${dateKey} = b.${dateKey}`,
      ...others.map((name) => `a.${name} IS NOT DISTINCT FROM o.${name}`),
    ].join(' AND ');
    ctes.push(
      `filled AS (\nSELECT\n  ${[
        ...dimensionOutputs,
        ...values.map(
          (value) => `CASE WHEN a.__present IS NULL THEN e.${value} ELSE a.${value} END AS ${value}`
        ),
      ].join(
        ',\n  '
      )}\nFROM fill_buckets b${others.length > 0 ? '\nCROSS JOIN fill_others o' : ''}\nCROSS JOIN fill_empty e\nLEFT JOIN ${current} a ON ${join}\nWHERE EXISTS (SELECT 1 FROM ${current})\nUNION ALL\nSELECT ${[...dimensions.flatMap(dimensionColumns), ...values].join(', ')}\nFROM ${current}\nWHERE ${dateKey} IS NULL\n)`
    );
    current = 'filled';
  }

  const partition = otherDimensions.map(dimensionKey);
  const series = (frame: string) =>
    `OVER (${partition.length > 0 ? `PARTITION BY ${partition.join(', ')} ` : ''}ORDER BY ${dateDimension?.key ?? '1'}${frame})`;

  if (metricColumns.some(modified)) {
    const sharePartition =
      dateDimension && dimensions.length > 1 ? `PARTITION BY ${dateDimension.key}` : '';
    const shaped = metricColumns.map((column) => {
      const raw = valueAlias(column);
      switch (column.aggregation.modifier) {
        case 'running':
          return `SUM(${raw}) ${series(' ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW')} AS ${column.key}`;
        case 'moving': {
          const window = Math.max(2, Math.floor(column.aggregation.window ?? 3));
          return `AVG(${raw}) ${series(` ROWS BETWEEN ${window - 1} PRECEDING AND CURRENT ROW`)} AS ${column.key}`;
        }
        case 'share': {
          // Share of the sum of absolute values: with mixed signs (net) the
          // parts stay within ±100%; all-negative columns show positive shares.
          const over = `OVER (${sharePartition})`;
          return `(CASE WHEN MAX(${raw}) ${over} <= 0 THEN -1 ELSE 1 END) * CAST(${raw} AS DOUBLE) * 100 / NULLIF(SUM(ABS(CAST(${raw} AS DOUBLE))) ${over}, 0) AS ${column.key}`;
        }
        default:
          return column.key;
      }
    });
    ctes.push(
      `shaped AS (\nSELECT\n  ${[...dimensions.flatMap(dimensionColumns), ...shaped].join(',\n  ')}\nFROM ${current}\n)`
    );
    current = 'shaped';
  }

  // Same period last year: the metrics re-aggregated over dates moved one
  // year forward (date filters apply to the moved dates), joined per group.
  const lastYear = metricColumns.filter((column) => column.aggregation.compareTo === 'lastYear');
  let lastYearJoin = '';
  if (lastYear.length > 0 && dateDimension?.bucket) {
    const shifted = `CAST(${dateDimension.fieldId} + ${LAST_YEAR_SHIFT[dateDimension.bucket]} AS DATE)`;
    const shiftedDimensions = breakoutColumns.map((column) =>
      dimensionFor(spec.source, column, custom, {
        binWidth: binWidths.get(column.key),
        ...(column.breakout.field === dateDimension.fieldId && column.breakout.bucket
          ? { dateColumn: shifted }
          : {}),
      })
    );
    const lastYearSelects = lastYear.map(
      (column) =>
        `${aggregationExpression(spec.source, column.aggregation, custom)} AS ly__${column.key}`
    );
    ctes.push(
      `agg_ly AS (\nSELECT\n  ${[
        ...shiftedDimensions.map((dimension, index) => `${dimension.matchKey} AS ly_k${index}`),
        ...lastYearSelects,
        '1 AS ly__present',
      ].join(
        ',\n  '
      )}\nFROM ${base}${whereFor(new Map([[dateDimension.fieldId, shifted]]))}\nGROUP BY ${shiftedDimensions.map((dimension) => dimension.matchKey).join(', ')}\n)`,
      `ly_empty AS (\nSELECT\n  ${lastYear
        .map(
          (column) =>
            `${aggregationExpression(spec.source, column.aggregation, custom)} AS lye__${column.key}`
        )
        .join(',\n  ')}\nFROM ${base}\nWHERE FALSE\n)`
    );
    const on = dimensions
      .map(
        (dimension, index) => `${dimension.matchResult('c')} IS NOT DISTINCT FROM ly.ly_k${index}`
      )
      .join(' AND ');
    lastYearJoin = ` c\nLEFT JOIN agg_ly ly ON ${on}\nCROSS JOIN ly_empty lye`;
  }

  const compared: string[] = [];
  let lastMetric: MetricColumn | null = null;
  for (const column of columns) {
    if (column.kind !== 'aggregation') continue;
    if (!column.derived) {
      lastMetric = column;
      continue;
    }
    if (!lastMetric) continue;
    const metric = lastMetric.key;
    const previous =
      column.compareTo === 'lastYear' && lastYearJoin
        ? `(CASE WHEN ly.ly__present IS NULL THEN lye.lye__${metric} ELSE ly.ly__${metric} END)`
        : `LAG(${metric}) ${series('')}`;
    compared.push(
      column.derived === 'previous'
        ? `${previous} AS ${column.key}`
        : `(${metric} - ${previous}) * 100 / NULLIF(ABS(${previous}), 0) AS ${column.key}`
    );
  }
  if (compared.length > 0) {
    ctes.push(
      `compared AS (\nSELECT\n  ${lastYearJoin ? 'c.*' : '*'},\n  ${compared.join(',\n  ')}\nFROM ${current}${lastYearJoin}\n)`
    );
    current = 'compared';
  }

  const having = (spec.having ?? [])
    .map(havingCondition)
    .filter((condition): condition is string => Boolean(condition));
  if (having.length > 0) {
    ctes.push(`filtered AS (\nSELECT *\nFROM ${current}\nWHERE ${having.join('\n  AND ')}\n)`);
    current = 'filtered';
  }

  // Ordering and limits.
  const breakoutKeys = breakoutColumns.map((column) => column.key);
  const breakoutOf = (key: string) =>
    breakoutColumns.find((column) => column.key === key)?.breakout;
  const isDateBucket = (key: string) => breakoutOf(key)?.bucket !== undefined;
  const isOrdered = (key: string) => {
    const breakout = breakoutOf(key);
    return Boolean(breakout && isOrderedBreakout(breakout));
  };
  const rankKey = (key: string) => {
    const dimension = dimensions.find((item) => item.key === key);
    return dimension ? dimensionKey(dimension) : key;
  };
  const firstMetric = metricColumns[0].key;
  const metricKeys = columns.filter((column) => column.kind === 'aggregation').map((c) => c.key);
  const userSorts = spec.sort.map((entry) => `${entry.column} ${entry.direction.toUpperCase()}`);

  let order: string[];
  if (spec.sort.length > 0) {
    order = userSorts;
  } else if (breakoutKeys.length > 0 && isOrdered(breakoutKeys[0])) {
    // Dates, date parts and bins read in their own order.
    order = [];
  } else if (breakoutKeys.length > 0) {
    order = [`${firstMetric} DESC`];
  } else {
    order = [];
  }
  const tieBreak = breakoutKeys.filter((key) => !spec.sort.some((entry) => entry.column === key));
  const orderBy = [...order, ...tieBreak.map((key) => `${key} ASC`)]
    .map((part) => `${part} NULLS LAST`)
    .join(', ');

  let from = current;
  let limitClause = limit ? `\nLIMIT ${limit}` : '';
  if (limit && breakoutKeys.length > 1) {
    // Two+ groupings: Limit keeps the top N values of one grouping (the
    // first non-date one), ranked by the sorted (or first) metric, so a
    // chart shows N whole series/bars rather than N arbitrary cells.
    const rankedKey = breakoutKeys.find((key) => !isDateBucket(key)) ?? breakoutKeys[0];
    const ranked = rankKey(rankedKey);
    const metricSort = spec.sort.find((entry) => metricKeys.includes(entry.column));
    const metric = metricSort?.column ?? firstMetric;
    const direction = metricSort?.direction === 'asc' ? 'ASC' : 'DESC';
    ctes.push(
      `top_values AS (\nSELECT ${ranked} AS ranked_value\nFROM ${current}\nGROUP BY 1\nORDER BY SUM(${metric}) ${direction} NULLS LAST, 1\nLIMIT ${limit}\n)`
    );
    from = `${current}\nWHERE ${ranked} IN (SELECT ranked_value FROM top_values)`;
    limitClause = '';
  }
  let finalOrder = orderBy;
  const leadSort = spec.sort[0];
  const [firstKey, ...restKeys] = breakoutKeys;
  if (
    breakoutKeys.length > 1 &&
    !isDateBucket(firstKey) &&
    (leadSort ? metricKeys.includes(leadSort.column) : !isOrdered(firstKey))
  ) {
    // Keep each first-grouping value's rows together, groups ordered by
    // their total; inside a group the metric sort (and any further sorts)
    // order the rows, then the remaining groupings.
    const metric = leadSort?.column ?? firstMetric;
    const direction = leadSort?.direction === 'asc' ? 'ASC' : 'DESC';
    const firstRank = rankKey(firstKey);
    from = `(\nSELECT *, SUM(${metric}) OVER (PARTITION BY ${firstRank}) AS group_total\nFROM ${from}\n) grouped`;
    // A date series inside a group stays chronological; without a sort, other
    // ordered groupings (weekday, bins) keep their own order too.
    const inside = restKeys.some(isDateBucket)
      ? []
      : leadSort
        ? userSorts
        : restKeys.some(isOrdered)
          ? []
          : [`${metric} ${direction}`];
    finalOrder = [
      `group_total ${direction}`,
      `${firstKey} ASC`,
      ...(firstRank !== firstKey ? [`${firstRank} ASC`] : []),
      ...inside,
      ...restKeys
        .filter((key) => !spec.sort.some((entry) => entry.column === key))
        .map((key) => `${key} ASC`),
    ]
      .map((part) => `${part} NULLS LAST`)
      .join(', ');
  }
  const outputs = [
    ...columns.map((column) => column.key),
    ...dimensions.flatMap((dimension) => (dimension.hidden ? [dimension.hidden] : [])),
  ];
  return `SELECT ${outputs.join(', ')}\nFROM ${from}${finalOrder ? `\nORDER BY ${finalOrder}` : ''}${limitClause}`;
}
