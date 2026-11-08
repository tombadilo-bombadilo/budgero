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
import { getField, type DateBucket, type FieldDef, type QuestionSource } from './fields';
import {
  isValidIsoDate,
  normalizeQuestion,
  questionColumns,
  resolveVisualization,
  type QuestionAggregation,
  type QuestionColumn,
  type QuestionFilter,
  type QuestionSpec,
  type RelativeUnit,
  type ResolvedVisualization,
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

/** Column holding a field's searchable / comparable text (lower-cased). */
function textColumn(field: FieldDef): string {
  // Payees compare by their raw name, so "No payee" never matches a filter.
  const column = field.id === 'payee' ? 'payee_name' : field.id;
  return `LOWER(TRIM(COALESCE(${column}, '')))`;
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

function filterCondition(
  source: QuestionSource,
  filter: QuestionFilter,
  today: string
): string | null {
  const field = getField(source, filter.field);
  if (!field) return null;
  if (filter.op === 'isEmpty') return emptyCondition(field);
  if (filter.op === 'notEmpty') return `NOT (${emptyCondition(field)})`;

  switch (field.type) {
    case 'boolean':
      return `COALESCE(${field.id}, FALSE) = ${filter.values[0] === true ? 'TRUE' : 'FALSE'}`;
    case 'date':
      return dateCondition(field.id, filter, today);
    case 'number': {
      const column = `CAST(${field.id} AS DOUBLE)`;
      const numbers = filter.values as number[];
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

function aggregationExpression(source: QuestionSource, aggregation: QuestionAggregation): string {
  const toDouble = (expr: string) => `CAST(COALESCE(${expr}, 0) AS DOUBLE)`;
  switch (aggregation.op) {
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
      const field = getField(source, aggregation.field ?? '');
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
  const conditions = spec.filters
    .map((filter) => filterCondition(spec.source, filter, today))
    .filter((condition): condition is string => Boolean(condition));
  // A question that only measures spending (or only income) leaves the other
  // side's rows out, so "Spending by category" lists no income categories.
  const ops = spec.aggregations.map((aggregation) => aggregation.op);
  if (ops.length > 0 && ops.every((op) => op === 'spending' || op === 'averageSpending')) {
    conditions.push(SPENDING_LINE);
  } else if (ops.length > 0 && ops.every((op) => op === 'income')) {
    conditions.push(INCOME_LINE);
  }
  const where = conditions.length > 0 ? `\nWHERE ${conditions.join('\n  AND ')}` : '';
  const ctes = sourceCtes(spec.source, budgetId, labels);
  const { limit } = spec;
  let body: string;

  if (spec.aggregations.length === 0) {
    const select = columns
      .map((column) => {
        const field = getField(spec.source, column.kind === 'field' ? column.field : '');
        return field ? `${rawFieldExpression(field, spec.source)} AS ${column.key}` : null;
      })
      .filter(Boolean)
      .join(',\n  ');
    // Sorts name output columns, so they apply over the projected rows; the
    // source's natural order breaks ties.
    ctes.push(
      `result AS (\nSELECT\n  ${select},\n  ROW_NUMBER() OVER (ORDER BY ${defaultRawOrder(spec.source)}) AS row_order\nFROM src${where}\n)`
    );
    const order = [
      ...spec.sort.map((entry) => `${entry.column} ${entry.direction.toUpperCase()} NULLS LAST`),
      'row_order',
    ].join(', ');
    body = `SELECT ${columns.map((column) => column.key).join(', ')}\nFROM result\nORDER BY ${order}${
      limit ? `\nLIMIT ${limit}` : ''
    }`;
  } else {
    const breakoutColumns = columns.filter((column) => column.kind === 'breakout');
    const aggregationColumns = columns.filter((column) => column.kind === 'aggregation');

    const breakoutSelect = breakoutColumns.map((column) => {
      const { breakout } = column;
      const expr = breakout.bucket
        ? bucketExpression(breakout.field, breakout.bucket)
        : breakout.field;
      return `${expr} AS ${column.key}`;
    });
    const aggregationSelect = aggregationColumns.map(
      (column) => `${aggregationExpression(spec.source, column.aggregation)} AS ${column.key}`
    );
    const groupBy =
      breakoutColumns.length > 0
        ? `\nGROUP BY ${breakoutColumns.map((_, index) => index + 1).join(', ')}`
        : '';
    ctes.push(
      `agg AS (\nSELECT\n  ${[...breakoutSelect, ...aggregationSelect].join(',\n  ')}\nFROM src${where}${groupBy}\n)`
    );

    const breakoutKeys = breakoutColumns.map((column) => column.key);
    const isDateBreakout = (key: string) =>
      breakoutColumns.find((column) => column.key === key)?.breakout.bucket !== undefined;
    const firstMetric = aggregationColumns[0].key;

    let order: string[];
    if (spec.sort.length > 0) {
      order = spec.sort.map((entry) => `${entry.column} ${entry.direction.toUpperCase()}`);
    } else if (breakoutKeys.length > 0 && isDateBreakout(breakoutKeys[0])) {
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

    let from = 'agg';
    let limitClause = limit ? `\nLIMIT ${limit}` : '';
    if (limit && breakoutKeys.length > 1) {
      // Two+ groupings: Limit keeps the top N values of one grouping (the
      // first non-date one), ranked by the sorted (or first) metric, so a
      // chart shows N whole series/bars rather than N arbitrary cells.
      const ranked = breakoutKeys.find((key) => !isDateBreakout(key)) ?? breakoutKeys[0];
      const metricSort = spec.sort.find((entry) =>
        aggregationColumns.some((column) => column.key === entry.column)
      );
      const metric = metricSort?.column ?? firstMetric;
      const direction = metricSort?.direction === 'asc' ? 'ASC' : 'DESC';
      ctes.push(
        `top_values AS (\nSELECT ${ranked}\nFROM agg\nGROUP BY ${ranked}\nORDER BY SUM(${metric}) ${direction} NULLS LAST, ${ranked}\nLIMIT ${limit}\n)`
      );
      from = `agg\nWHERE ${ranked} IN (SELECT ${ranked} FROM top_values)`;
      limitClause = '';
    }
    let finalOrder = orderBy;
    const metricKeys = aggregationColumns.map((column) => column.key);
    const leadSort = spec.sort[0];
    if (
      breakoutKeys.length > 1 &&
      !isDateBreakout(breakoutKeys[0]) &&
      (!leadSort || metricKeys.includes(leadSort.column))
    ) {
      // Keep each first-grouping value's rows together, ordered by its total.
      const metric = leadSort?.column ?? firstMetric;
      const direction = leadSort?.direction === 'asc' ? 'ASC' : 'DESC';
      from = `(\nSELECT *, SUM(${metric}) OVER (PARTITION BY ${breakoutKeys[0]}) AS group_total\nFROM ${from}\n) grouped`;
      finalOrder = [
        `group_total ${direction} NULLS LAST`,
        ...breakoutKeys.map((key) => `${key} ASC NULLS LAST`),
      ].join(', ');
    }
    body = `SELECT ${columns.map((column) => column.key).join(', ')}\nFROM ${from}${
      finalOrder ? `\nORDER BY ${finalOrder}` : ''
    }${limitClause}`;
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
    xAxisColumn: visualization === 'number' ? metric : (breakouts[0]?.key ?? first),
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
