/**
 * Human labels for the notebook: sources, fields, operators, metrics, column
 * headers and formatted grouping values ("2025-12" → "Dec 2025").
 * Resolved at call time so the active locale applies.
 */
import { plural, t } from '@lingui/core/macro';
import { getLocaleTag } from '@shared/i18n';
import {
  MONEY_FIELD_IDS,
  PERCENT_FIELD_IDS,
  getField,
  havingColumns,
  type ColumnFormat,
  type DateBucket,
  type DatePart,
  type ExpressionError,
  type FieldDef,
  type QuestionAggregation,
  type QuestionColumn,
  type QuestionFilter,
  type QuestionSource,
  type QuestionSpec,
  type QuestionSqlLabels,
  type RelativeUnit,
  type FilterOp,
  type QuestionHaving,
  type QuestionIssue,
  type ResolvedVisualization,
  type ValueKind,
  type VisualizationBlocker,
} from '@features/reports/lib/question';

export function sourceLabel(source: QuestionSource): string {
  switch (source) {
    case 'transactions':
      return t`Transactions`;
    case 'budget':
      return t`Budget`;
    case 'accounts':
      return t`Accounts`;
    case 'balances':
      return t`Balances over time`;
    case 'scheduled':
      return t`Scheduled transactions`;
    case 'upcoming':
      return t`Upcoming scheduled`;
    case 'payees':
      return t`Payees`;
  }
}

export function sourceDescription(source: QuestionSource): string {
  switch (source) {
    case 'transactions':
      return t`Every transaction; split transactions count once per category.`;
    case 'budget':
      return t`Assigned, activity, available and goals per category per month, as the budget shows them.`;
    case 'accounts':
      return t`Each account with its balance from transactions.`;
    case 'balances':
      return t`Each account's balance at the end of every day, week or month, for net worth over time.`;
    case 'scheduled':
      return t`Each recurring transaction with its next date and a monthly equivalent.`;
    case 'upcoming':
      return t`Every scheduled occurrence that hasn't been entered yet, by due date.`;
    case 'payees':
      return t`One row per payee: how often and how much, transfers left out.`;
  }
}

export function fieldLabel(source: QuestionSource, fieldId: string): string {
  switch (fieldId) {
    case 'date':
      return source === 'payees' ? t`Transaction date` : t`Date`;
    case 'month':
      return t`Month`;
    case 'category':
      return t`Category`;
    case 'category_group':
      return t`Category group`;
    case 'payee':
      return t`Payee`;
    case 'account':
      return t`Account`;
    case 'label':
      return t`Label`;
    case 'memo':
      return t`Memo`;
    case 'amount':
      return t`Amount`;
    case 'inflow':
      return t`Inflow`;
    case 'outflow':
      return t`Outflow`;
    case 'is_transfer':
      return t`Transfer`;
    case 'on_budget':
      return source === 'accounts' || source === 'balances' ? t`On budget` : t`On-budget account`;
    case 'cleared':
      return t`Cleared`;
    case 'is_income':
      return t`Income category`;
    case 'assigned':
      return t`Assigned`;
    case 'activity':
      return t`Activity`;
    case 'account_type':
      return t`Account type`;
    case 'currency':
      return t`Currency`;
    case 'closed':
      return t`Closed`;
    case 'balance':
      return t`Balance`;
    case 'balance_native':
      return t`Balance (account currency)`;
    case 'transaction_count':
      return t`Number of transactions`;
    case 'last_transaction':
      return t`Last transaction`;
    case 'available':
      return t`Available`;
    case 'goal_type':
      return t`Goal type`;
    case 'goal_target':
      return t`Goal target`;
    case 'goal_monthly_target':
      return t`Goal: this month's target`;
    case 'goal_needed':
      return t`Goal: still needed`;
    case 'goal_progress':
      return t`Goal progress`;
    case 'goal_funded':
      return t`Goal met`;
    case 'is_liability':
      return t`Debt account`;
    case 'change':
      return t`Change`;
    case 'assets':
      return t`Assets`;
    case 'debts':
      return t`Debts`;
    case 'next_date':
      return t`Next date`;
    case 'to_account':
      return t`To account`;
    case 'monthly_amount':
      return t`Monthly amount`;
    case 'frequency':
      return t`Frequency`;
    case 'status':
      return t`Status`;
    case 'active':
      return t`Active`;
    case 'is_split':
      return t`Split transaction`;
    case 'amount_native':
      return t`Amount (account currency)`;
    case 'days_until':
      return source === 'upcoming' ? t`Days until due` : t`Days until next`;
    case 'start_date':
      return t`Start date`;
    case 'end_date':
      return t`End date`;
    case 'due_date':
      return t`Due date`;
    case 'is_overdue':
      return t`Overdue`;
    case 'total':
      return t`Total`;
    case 'average_amount':
      return t`Average amount`;
    case 'first_seen':
      return t`First seen`;
    case 'last_seen':
      return t`Last seen`;
    case 'top_category':
      return t`Most used category`;
    default:
      return fieldId;
  }
}

/** One-line explanation of a field for the pickers, or null when the label says it all. */
export function fieldDescription(source: QuestionSource, fieldId: string): string | null {
  switch (source) {
    case 'budget':
      switch (fieldId) {
        case 'available':
          return t`What the budget shows as available, rollover and overspending included.`;
        case 'goal_type':
          return t`The category's goal, empty when it has none.`;
        case 'goal_target':
          return t`The goal's full target amount.`;
        case 'goal_monthly_target':
          return t`What the goal asks for in this month.`;
        case 'goal_needed':
          return t`What is still missing to meet the goal.`;
        case 'goal_progress':
          return t`How much of the goal is funded, in percent.`;
        case 'goal_funded':
          return t`The goal counts as met (or on track) this month.`;
        default:
          return null;
      }
    case 'balances':
      switch (fieldId) {
        case 'date':
          return t`End of each period (today for the current one).`;
        case 'balance':
          return t`Balance at the end of the period, in the budget currency.`;
        case 'balance_native':
          return t`Balance in the account's own currency.`;
        case 'change':
          return t`How much the balance moved during the period.`;
        case 'is_liability':
          return t`Credit cards, loans and mortgages.`;
        case 'assets':
          return t`The balance of accounts that aren't debts.`;
        case 'debts':
          return t`What debt accounts owe, as a positive amount.`;
        default:
          return null;
      }
    case 'scheduled':
    case 'upcoming':
      switch (fieldId) {
        case 'next_date':
          return t`The next occurrence not yet entered (can be overdue).`;
        case 'amount':
          return t`In the budget currency: income positive, bills negative.`;
        case 'monthly_amount':
          return t`The amount spread per month (weekly × 52 / 12, yearly / 12, …).`;
        case 'status':
          return t`Active, paused, or ended (no more occurrences).`;
        case 'active':
          return t`Not paused and still has occurrences to come.`;
        case 'is_split':
          return t`Split across several categories.`;
        case 'days_until':
          return t`Days from today; negative when overdue.`;
        case 'to_account':
          return t`The other account of a scheduled transfer.`;
        default:
          return null;
      }
    case 'payees':
      switch (fieldId) {
        case 'date':
        case 'account':
        case 'category':
        case 'category_group':
        case 'on_budget':
          return t`Filters the transactions a payee's totals count.`;
        case 'total':
          return t`Inflows minus outflows.`;
        case 'average_amount':
          return t`Total divided by the number of transactions.`;
        case 'top_category':
          return t`The category used most often with this payee.`;
        default:
          return null;
      }
    default:
      return null;
  }
}

/** Display text of a coded value (goal types, frequencies, schedule states). */
export function codeLabel(kind: ValueKind | undefined, value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  switch (kind) {
    case 'goalType':
      switch (value) {
        case 'monthly':
          return t`Monthly spending`;
        case 'yearly':
          return t`Yearly spending`;
        case 'target-date':
          return t`Save by a date`;
        case 'monthly-savings':
          return t`Save each month`;
        case 'target-balance':
          return t`Target balance`;
        default:
          return value;
      }
    case 'scheduleStatus':
      switch (value) {
        case 'active':
          return t`Active`;
        case 'paused':
          return t`Paused`;
        case 'ended':
          return t`Ended`;
        default:
          return value;
      }
    case 'frequency': {
      // "month" or "<n>-<unit>", e.g. "2-week".
      const match = /^(?:(\d+)-)?(day|week|month|year)$/.exec(value);
      if (!match) return value;
      const count = Number(match[1] ?? 1);
      switch (match[2]) {
        case 'day':
          return plural(count, { one: 'Daily', other: 'Every # days' });
        case 'week':
          return plural(count, { one: 'Weekly', other: 'Every # weeks' });
        case 'month':
          return plural(count, { one: 'Monthly', other: 'Every # months' });
        default:
          return plural(count, { one: 'Yearly', other: 'Every # years' });
      }
    }
    default:
      return null;
  }
}

export function bucketLabel(bucket: DateBucket): string {
  switch (bucket) {
    case 'day':
      return t`Day`;
    case 'week':
      return t`Week`;
    case 'month':
      return t`Month`;
    case 'quarter':
      return t`Quarter`;
    case 'year':
      return t`Year`;
  }
}

export function datePartLabel(part: DatePart): string {
  switch (part) {
    case 'year':
      return t`Year`;
    case 'quarterOfYear':
      return t`Quarter of year`;
    case 'monthOfYear':
      return t`Month of year`;
    case 'dayOfMonth':
      return t`Day of month`;
    case 'dayOfWeek':
      return t`Day of week`;
  }
}

/** A date-part value as a name: 1 → "Mon" / "Monday", 3 → "Mar", 2 → "Q2". */
export function formatDatePartValue(
  part: DatePart,
  value: unknown,
  style: 'short' | 'long' = 'short'
): string {
  if (value === null || value === undefined || value === '') return '—';
  const number = Number(value);
  if (!Number.isInteger(number)) return String(value);
  const locale = getLocaleTag();
  switch (part) {
    case 'dayOfWeek': {
      if (number < 1 || number > 7) return String(value);
      // 1 Jan 2024 was a Monday (ISO day 1).
      const date = new Date(2024, 0, number);
      return date.toLocaleDateString(locale, { weekday: style === 'long' ? 'long' : 'short' });
    }
    case 'monthOfYear': {
      if (number < 1 || number > 12) return String(value);
      const date = new Date(2024, number - 1, 1);
      return date.toLocaleDateString(locale, { month: style === 'long' ? 'long' : 'short' });
    }
    case 'quarterOfYear':
      return t`Q${number}`;
    default:
      return String(number);
  }
}

/** The unit word for `amount` of it ("day" / "days"), by the language's plural rules. */
export function unitLabel(unit: RelativeUnit, amount: number): string {
  switch (unit) {
    case 'day':
      return plural(amount, { one: 'day', other: 'days' });
    case 'week':
      return plural(amount, { one: 'week', other: 'weeks' });
    case 'month':
      return plural(amount, { one: 'month', other: 'months' });
    case 'quarter':
      return plural(amount, { one: 'quarter', other: 'quarters' });
    case 'year':
      return plural(amount, { one: 'year', other: 'years' });
  }
}

/** "Date: last 3 months" / "Date: previous 3 full months", as whole phrases. */
function relativeRangeLabel(
  name: string,
  unit: RelativeUnit,
  amount: number,
  fullPeriods: boolean
): string {
  if (fullPeriods) {
    switch (unit) {
      case 'day':
        return plural(amount, {
          one: `${name}: previous # full day`,
          other: `${name}: previous # full days`,
        });
      case 'week':
        return plural(amount, {
          one: `${name}: previous # full week`,
          other: `${name}: previous # full weeks`,
        });
      case 'month':
        return plural(amount, {
          one: `${name}: previous # full month`,
          other: `${name}: previous # full months`,
        });
      case 'quarter':
        return plural(amount, {
          one: `${name}: previous # full quarter`,
          other: `${name}: previous # full quarters`,
        });
      case 'year':
        return plural(amount, {
          one: `${name}: previous # full year`,
          other: `${name}: previous # full years`,
        });
    }
  }
  switch (unit) {
    case 'day':
      return plural(amount, { one: `${name}: last # day`, other: `${name}: last # days` });
    case 'week':
      return plural(amount, { one: `${name}: last # week`, other: `${name}: last # weeks` });
    case 'month':
      return plural(amount, { one: `${name}: last # month`, other: `${name}: last # months` });
    case 'quarter':
      return plural(amount, { one: `${name}: last # quarter`, other: `${name}: last # quarters` });
    case 'year':
      return plural(amount, { one: `${name}: last # year`, other: `${name}: last # years` });
  }
}

export function operatorLabel(op: FilterOp, fieldType?: string): string {
  switch (op) {
    case 'is':
      return fieldType === 'date' ? t`On` : t`Is`;
    case 'isNot':
      return t`Is not`;
    case 'contains':
      return t`Contains`;
    case 'startsWith':
      return t`Starts with`;
    case 'gt':
      return t`Greater than`;
    case 'lt':
      return t`Less than`;
    case 'between':
      return t`Between`;
    case 'isEmpty':
      return t`Is empty`;
    case 'notEmpty':
      return t`Not empty`;
    case 'previous':
      return t`Previous`;
    case 'current':
      return t`Current`;
    case 'before':
      return t`Before`;
    case 'after':
      return t`After`;
  }
}

export function aggregationLabel(
  source: QuestionSource,
  aggregation: QuestionAggregation,
  /** Name of the custom column the metric aggregates, if any. */
  fieldName?: string
): string {
  const field = fieldName ?? (aggregation.field ? fieldLabel(source, aggregation.field) : '');
  switch (aggregation.op) {
    case 'count':
      switch (source) {
        case 'transactions':
          return t`Number of transactions`;
        case 'accounts':
          return t`Number of accounts`;
        case 'scheduled':
          return t`Number of scheduled transactions`;
        case 'upcoming':
          return t`Number of occurrences`;
        case 'payees':
          return t`Number of payees`;
        default:
          return t`Number of rows`;
      }
    case 'sum':
      return t`Sum of ${field}`;
    case 'avg':
      return t`Average of ${field}`;
    case 'min':
      return t`Minimum of ${field}`;
    case 'max':
      return t`Maximum of ${field}`;
    case 'distinct':
      return t`Distinct ${field}`;
    case 'spending':
      return t`Spending`;
    case 'income':
      return t`Income`;
    case 'net':
      return t`Net (income − spending)`;
    case 'averageSpending':
      return t`Average spending per transaction`;
    case 'custom':
      return aggregation.name ?? t`Custom metric`;
  }
}

/** Short explanation for the friendly metrics in the metric picker. */
export function aggregationHint(op: QuestionAggregation['op']): string | null {
  switch (op) {
    case 'spending':
      return t`Outflows minus refunds, income categories left out`;
    case 'income':
      return t`Inflows to income categories`;
    case 'net':
      return t`Income minus spending`;
    case 'averageSpending':
      return t`Spending divided by the number of spending transactions`;
    default:
      return null;
  }
}

/** Friendly table header for an output column ("Month", "Category", "Spending"). */
export function columnLabel(source: QuestionSource, column: QuestionColumn): string {
  switch (column.kind) {
    case 'field':
      return column.name ?? fieldLabel(source, column.field);
    case 'aggregation': {
      const base = aggregationLabel(source, column.aggregation, column.fieldName);
      const metric = withModifierLabel(base, column.aggregation);
      const lastYear = column.compareTo === 'lastYear';
      if (column.derived === 'previous') {
        return lastYear ? t`${metric} (last year)` : t`${metric} (previous period)`;
      }
      if (column.derived === 'change') {
        return lastYear ? t`${metric}: % change vs last year` : t`${metric}: % change`;
      }
      return metric;
    }
    case 'breakout': {
      const { breakout } = column;
      const name = column.name ?? fieldLabel(source, breakout.field);
      if (breakout.part) {
        const part = datePartLabel(breakout.part);
        return isPrimaryDate(breakout.field) ? part : t`${name}: ${part}`;
      }
      if (breakout.bin !== undefined) return t`${name} (range)`;
      if (!breakout.bucket) return name;
      if (isPrimaryDate(breakout.field)) return bucketLabel(breakout.bucket);
      const field = fieldLabel(source, breakout.field);
      const bucket = bucketLabel(breakout.bucket);
      return t`${field}: ${bucket}`;
    }
  }
}

function isPrimaryDate(fieldId: string): boolean {
  return fieldId === 'date' || fieldId === 'month';
}

const MONEY_FIELDS = MONEY_FIELD_IDS;

/** "Spending" → "Spending (running total)" etc. */
export function withModifierLabel(label: string, aggregation: QuestionAggregation): string {
  switch (aggregation.modifier) {
    case 'running':
      return t`${label} (running total)`;
    case 'moving': {
      const window = aggregation.window ?? 3;
      return t`${label} (moving average of ${window})`;
    }
    case 'share':
      return t`${label} (% of total)`;
    default:
      return label;
  }
}

/** Plain-number source fields (not money). */
const NUMBER_FIELDS = new Set([
  'balance_native',
  'transaction_count',
  'amount_native',
  'days_until',
]);

/** How a numeric column should be formatted. */
export function columnFormat(column: QuestionColumn): ColumnFormat {
  if (column.format) return column.format;
  if (column.kind === 'aggregation') {
    const { op, field } = column.aggregation;
    if (op === 'count' || op === 'distinct') return 'number';
    if (op === 'spending' || op === 'income' || op === 'net' || op === 'averageSpending') {
      return 'money';
    }
    if (field && PERCENT_FIELD_IDS.has(field)) return 'percent';
    return field && MONEY_FIELDS.has(field) ? 'money' : 'number';
  }
  if (column.kind === 'breakout' && column.breakout.bin !== undefined) {
    return MONEY_FIELDS.has(column.breakout.field) ? 'money' : 'number';
  }
  if (column.kind === 'field') {
    if (MONEY_FIELDS.has(column.field)) return 'money';
    if (PERCENT_FIELD_IDS.has(column.field)) return 'percent';
    if (NUMBER_FIELDS.has(column.field)) return 'number';
  }
  return 'text';
}

/** Date bucket of a column, if it holds bucketed dates. */
export function columnBucket(column: QuestionColumn, source: QuestionSource): DateBucket | null {
  if (column.kind === 'breakout') return column.breakout.bucket ?? null;
  if (column.kind === 'field' && getField(source, column.field)?.type === 'date') {
    return source === 'budget' && column.field === 'month' ? 'month' : 'day';
  }
  return null;
}

function parseIsoDay(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

/** "2025-12" → "Dec 2025", "2026-Q1" → "Q1 2026", "2026-01-05" → "5 Jan 2026". */
export function formatBucketValue(
  bucket: DateBucket,
  value: unknown,
  style: 'short' | 'long' = 'short'
): string {
  if (value === null || value === undefined || value === '') return '—';
  const text = String(value);
  const locale = getLocaleTag();
  switch (bucket) {
    case 'year':
      return text;
    case 'quarter': {
      const match = /^(\d{4})-Q([1-4])$/.exec(text);
      if (!match) return text;
      const [, year, quarter] = match;
      return t`Q${quarter} ${year}`;
    }
    case 'month': {
      const match = /^(\d{4})-(\d{2})/.exec(text);
      if (!match) return text;
      const date = new Date(Number(match[1]), Number(match[2]) - 1, 1);
      return date.toLocaleDateString(locale, {
        month: style === 'long' ? 'long' : 'short',
        year: 'numeric',
      });
    }
    case 'week': {
      const date = parseIsoDay(text);
      if (!date) return text;
      const day = date.toLocaleDateString(locale, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
      return style === 'long' ? t`Week of ${day}` : day;
    }
    case 'day': {
      const date = parseIsoDay(text);
      return date
        ? date.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })
        : text;
    }
  }
}

export function visualizationLabel(visualization: ResolvedVisualization): string {
  switch (visualization) {
    case 'number':
      return t`Number`;
    case 'line':
      return t`Line`;
    case 'bar':
      return t`Bar`;
    case 'area':
      return t`Area`;
    case 'pie':
      return t`Pie`;
    case 'table':
      return t`Table`;
    case 'trend':
      return t`Number with trend`;
    case 'combo':
      return t`Combo`;
    case 'pivot':
      return t`Pivot table`;
    case 'calendar':
      return t`Calendar heatmap`;
    case 'waterfall':
      return t`Waterfall`;
    case 'sankey':
      return t`Flow (Sankey)`;
    case 'scatter':
      return t`Scatter`;
    case 'row':
      return t`Row`;
    case 'treemap':
      return t`Treemap`;
    case 'radar':
      return t`Radar`;
    case 'progress':
      return t`Progress`;
  }
}

/** Why a chart type is unavailable for the current question. */
export function visualizationBlockerLabel(blocker: VisualizationBlocker): string {
  switch (blocker) {
    case 'needsSummary':
      return t`Add a metric in Summarize first.`;
    case 'needsNoGrouping':
      return t`Shows a single value: remove the groupings.`;
    case 'needsGrouping':
      return t`Needs a grouping (Summarize by).`;
    case 'needsOneGrouping':
      return t`Needs exactly one grouping.`;
    case 'needsCategoryGrouping':
      return t`Needs a grouping that isn’t a date, like Category.`;
    case 'needsDateTrend':
      return t`Needs one grouping by date, or no grouping and a date filter with a range.`;
    case 'needsTwoMetrics':
      return t`Needs a grouping and two metrics.`;
    case 'needsTwoMetricsOneGrouping':
      return t`Needs two metrics and one grouping.`;
    case 'needsDayGrouping':
      return t`Needs one grouping by date, by day.`;
    case 'needsTwoGroupings':
      return t`Needs exactly two groupings.`;
    case 'needsTwoCategoryGroupings':
      return t`Needs two groupings that aren’t dates, like Category group and Category.`;
    case 'needsOneOrTwoGroupings':
      return t`Needs one or two groupings, like Category group and Category.`;
    case 'needsCategoryFirst':
      return t`Needs a first grouping that isn’t a date, like Category.`;
  }
}

export function booleanLabel(value: boolean): string {
  return value ? t`Yes` : t`No`;
}

/** Labels baked into the generated SQL for empty values. */
export function getQuestionSqlLabels(): QuestionSqlLabels {
  return {
    uncategorized: t`Uncategorized`,
    noPayee: t`No payee`,
    noLabel: t`No label`,
    noAccount: t`No account`,
    split: t`Several categories`,
  };
}

function formatIsoDate(value: unknown): string {
  return formatBucketValue('day', value);
}

/**
 * Chip text for a filter, e.g. "Date: previous 12 months", "Category is Rent,
 * Fun". `valueName` maps ids / names to display names.
 */
export function filterSummary(
  source: QuestionSource,
  filter: QuestionFilter,
  valueName: (value: string | number | boolean) => string = String,
  /** A custom column the filter is on: its field definition and name. */
  customField?: { field: FieldDef; name: string }
): string {
  const field = customField?.field ?? getField(source, filter.field);
  const name = customField?.name ?? fieldLabel(source, filter.field);
  if (!field) return name;
  const values = filter.values.map(valueName);
  const [first = '', second = ''] = values;
  const more = values.length - 2;
  const list =
    values.length > 2
      ? plural(more, {
          one: `${first}, ${second} and # more`,
          other: `${first}, ${second} and # more`,
        })
      : values.join(', ');
  const firstDate = formatIsoDate(filter.values[0]);
  const secondDate = formatIsoDate(filter.values[1]);
  if (filter.part && (filter.op === 'is' || filter.op === 'isNot')) {
    const part = datePartLabel(filter.part);
    const names = filter.values.map((value) => formatDatePartValue(filter.part!, value, 'long'));
    const shown = names.length > 3 ? `${names.slice(0, 3).join(', ')}…` : names.join(', ');
    return filter.op === 'is'
      ? t`${name}: ${part} is ${shown}`
      : t`${name}: ${part} is not ${shown}`;
  }
  switch (filter.op) {
    case 'isEmpty':
      return t`${name} is empty`;
    case 'notEmpty':
      return t`${name} is not empty`;
    case 'previous': {
      return relativeRangeLabel(
        name,
        filter.unit ?? 'month',
        filter.amount ?? 1,
        filter.includeCurrent === false
      );
    }
    case 'current': {
      switch (filter.unit) {
        case 'day':
          return t`${name}: today`;
        case 'week':
          return t`${name}: this week`;
        case 'quarter':
          return t`${name}: this quarter`;
        case 'year':
          return t`${name}: this year`;
        default:
          return t`${name}: this month`;
      }
    }
    case 'between':
      if (field.type === 'date') return t`${name}: ${firstDate} – ${secondDate}`;
      // A numeric bin from drill-through: [from, to).
      if (filter.binWidth !== undefined) return t`${name}: ${first} to under ${second}`;
      return t`${name} between ${first} and ${second}`;
    case 'before':
      return t`${name} before ${firstDate}`;
    case 'after':
      return t`${name} after ${firstDate}`;
    case 'gt':
      return t`${name} > ${first}`;
    case 'lt':
      return t`${name} < ${first}`;
    case 'contains':
      return t`${name} contains “${first}”`;
    case 'startsWith':
      return t`${name} starts with “${first}”`;
    case 'is':
      if (field.type === 'boolean') {
        return filter.values[0] === true ? t`${name}: yes` : t`${name}: no`;
      }
      if (field.type === 'date') return t`${name}: ${firstDate}`;
      return t`${name} is ${list}`;
    case 'isNot':
      return t`${name} is not ${list}`;
  }
}

/** Default question title, e.g. "Spending by Category and Month". */
export function describeQuestion(spec: QuestionSpec): string {
  const source = sourceLabel(spec.source);
  if (spec.aggregations.length === 0) return source;
  const label = (aggregation: QuestionAggregation) =>
    withModifierLabel(
      aggregationLabel(spec.source, aggregation, customColumnName(spec, aggregation.field)),
      aggregation
    );
  const metric = label(spec.aggregations[0]);
  const secondMetric = spec.aggregations.length === 2 ? label(spec.aggregations[1]) : '';
  const metrics = secondMetric ? t`${metric} and ${secondMetric}` : metric;
  if (spec.breakouts.length === 0) return metrics;
  const groups = spec.breakouts.map((breakout) => {
    if (breakout.part && isPrimaryDate(breakout.field)) return datePartLabel(breakout.part);
    return breakout.bucket && isPrimaryDate(breakout.field)
      ? bucketLabel(breakout.bucket)
      : specFieldLabel(spec, breakout.field);
  });
  const [firstGroup, secondGroup] = groups;
  const by = secondGroup ? t`${firstGroup} and ${secondGroup}` : firstGroup;
  return t`${metrics} by ${by}`;
}

function customColumnName(spec: QuestionSpec, fieldId: string | undefined): string | undefined {
  if (!fieldId) return undefined;
  return spec.customColumns?.find((column) => column.id === fieldId)?.name;
}

/** Label of a source field or custom column of a question. */
export function specFieldLabel(spec: QuestionSpec, fieldId: string): string {
  return customColumnName(spec, fieldId) ?? fieldLabel(spec.source, fieldId);
}

/** Localized names a field can be written as in an expression (besides its id). */
export function expressionFieldNames(source: QuestionSource, fieldId: string): string[] {
  return [fieldLabel(source, fieldId)];
}

/** Localized names for Spending / Income / Net / Count in custom metrics. */
export function expressionMetricNames(): Record<string, 'spending' | 'income' | 'net' | 'count'> {
  const names = {
    [t`Spending`]: 'spending',
    [t`Income`]: 'income',
    [t`Net`]: 'net',
    [t`Count`]: 'count',
  } as const;
  // Only single words that aren't keywords can be typed as names.
  return Object.fromEntries(
    Object.entries(names).filter(
      ([name]) =>
        /^[\p{L}_][\p{L}\p{N}_]*$/u.test(name) &&
        !['and', 'or', 'not', 'true', 'false'].includes(name.toLowerCase())
    )
  );
}

/** User-facing message for an expression error. */
export function expressionErrorMessage(error: ExpressionError): string {
  const { detail } = error;
  switch (error.code) {
    case 'empty':
      return t`Enter an expression.`;
    case 'tooLong':
      return t`This expression is too long.`;
    case 'tooComplex':
      return t`This expression is nested too deeply.`;
    case 'unexpectedCharacter':
      return t`“${detail}” isn’t allowed here.`;
    case 'unterminatedString':
      return t`Text is missing its closing quote.`;
    case 'unterminatedField':
      return t`A field name is missing its closing ].`;
    case 'emptyField':
      return t`Put a field name between the brackets, like [Amount].`;
    case 'unknownField':
      return t`There’s no field called [${detail}].`;
    case 'unknownName':
      return t`Unknown name “${detail}”. Put field names in brackets, like [Amount].`;
    case 'unknownFunction':
      return t`There’s no function called ${detail}.`;
    case 'unexpectedToken':
      return t`Unexpected ${detail}.`;
    case 'unexpectedEnd':
      return t`The expression ends too early.`;
    case 'missingParen':
      return t`A closing parenthesis ) is missing.`;
    case 'argumentCount':
      return t`${detail}() has the wrong number of values.`;
    case 'expectedNumber':
      return t`This needs to be a number.`;
    case 'expectedBoolean':
      return t`This needs to be a condition, like [Amount] > 0.`;
    case 'expectedText':
      return t`This needs to be text.`;
    case 'typeMismatch':
      return t`These values have different types.`;
    case 'invalidDate':
      return t`Write dates as "YYYY-MM-DD".`;
    case 'aggregateInColumn':
    case 'metricInColumn':
      return t`${detail} only works in a custom metric.`;
    case 'nestedAggregate':
      return t`${detail} can’t be used inside another aggregation.`;
    case 'fieldOutsideAggregate':
      return t`In a metric, fields go inside an aggregation, like Sum([Amount]).`;
    case 'needsAggregate':
      return t`A metric needs an aggregation, like Sum([Amount]) or Count.`;
    case 'metricUnavailable':
      return t`${detail} is only available for transactions.`;
    case 'metricResultNotNumber':
      return t`A metric has to be a number.`;
    case 'columnResultDate':
      return t`A custom column can be a number, text or a condition.`;
    case 'roundDigits':
      return t`round() takes a whole number of digits from −10 to 10.`;
    case 'numberTooPrecise':
      return t`The number ${detail} is too large or has too many decimals.`;
  }
}

/** Chip text of a result filter, e.g. "Spending > 500", "Spending: 100 – 200". */
export function havingSummary(spec: QuestionSpec, having: QuestionHaving): string {
  const column = havingColumns(spec).find((item) => item.key === having.column);
  const name = column ? columnLabel(spec.source, column) : having.column;
  const number = new Intl.NumberFormat(getLocaleTag(), { maximumFractionDigits: 2 });
  const [first = 0, second = 0] = having.values.map((value) => number.format(value));
  const list = having.values.map((value) => number.format(value)).join(', ');
  switch (having.op) {
    case 'gt':
      return t`${name} > ${first}`;
    case 'lt':
      return t`${name} < ${first}`;
    case 'between':
      return t`${name} between ${first} and ${second}`;
    case 'is':
      return t`${name} is ${list}`;
    case 'isNot':
      return t`${name} is not ${list}`;
    case 'isEmpty':
      return t`${name} is empty`;
    case 'notEmpty':
      return t`${name} is not empty`;
  }
}

/** Why part of an opened question was dropped or renamed. */
export function questionIssueMessage(issue: QuestionIssue): string {
  const name = issue.name ?? '';
  const reason = issue.error ? expressionErrorMessage(issue.error) : '';
  switch (issue.kind) {
    case 'customColumn':
      if (issue.reason === 'nameTaken') return t`A custom column was renamed to “${name}”.`;
      if (issue.reason === 'expression') return t`Custom column “${name}” was left out: ${reason}`;
      return t`A custom column couldn’t be read and was left out.`;
    case 'customMetric':
      if (issue.reason === 'expression') return t`Custom metric “${name}” was left out: ${reason}`;
      return t`A custom metric couldn’t be read and was left out.`;
    case 'filter':
      if (issue.reason === 'textTooLong') return t`A filter with a very long value was left out.`;
      return t`A filter couldn’t be read and was left out.`;
    case 'having':
      return t`A result filter couldn’t be read and was left out.`;
  }
}
