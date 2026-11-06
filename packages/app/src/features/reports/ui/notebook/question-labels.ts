/**
 * Human labels for the notebook: sources, fields, operators, metrics, column
 * headers and formatted grouping values ("2025-12" → "Dec 2025").
 * Resolved at call time so the active locale applies.
 */
import { t } from '@lingui/core/macro';
import { getLocaleTag } from '@shared/i18n';
import {
  getField,
  type DateBucket,
  type QuestionAggregation,
  type QuestionColumn,
  type QuestionFilter,
  type QuestionSource,
  type QuestionSpec,
  type QuestionSqlLabels,
  type RelativeUnit,
  type FilterOp,
  type ResolvedVisualization,
} from '@features/reports/lib/question';

export function sourceLabel(source: QuestionSource): string {
  switch (source) {
    case 'transactions':
      return t`Transactions`;
    case 'budget':
      return t`Budget`;
    case 'accounts':
      return t`Accounts`;
  }
}

export function sourceDescription(source: QuestionSource): string {
  switch (source) {
    case 'transactions':
      return t`Every transaction; split transactions count once per category.`;
    case 'budget':
      return t`Assigned and activity per category per month.`;
    case 'accounts':
      return t`Each account with its balance from transactions.`;
  }
}

export function fieldLabel(source: QuestionSource, fieldId: string): string {
  switch (fieldId) {
    case 'date':
      return t`Date`;
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
      return source === 'accounts' ? t`On budget` : t`On-budget account`;
    case 'cleared':
      return t`Cleared`;
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
    default:
      return fieldId;
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

export function unitLabel(unit: RelativeUnit, amount: number): string {
  switch (unit) {
    case 'day':
      return amount === 1 ? t`day` : t`days`;
    case 'week':
      return amount === 1 ? t`week` : t`weeks`;
    case 'month':
      return amount === 1 ? t`month` : t`months`;
    case 'quarter':
      return amount === 1 ? t`quarter` : t`quarters`;
    case 'year':
      return amount === 1 ? t`year` : t`years`;
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

export function aggregationLabel(source: QuestionSource, aggregation: QuestionAggregation): string {
  const field = aggregation.field ? fieldLabel(source, aggregation.field) : '';
  switch (aggregation.op) {
    case 'count':
      return source === 'transactions'
        ? t`Number of transactions`
        : source === 'accounts'
          ? t`Number of accounts`
          : t`Number of rows`;
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
      return fieldLabel(source, column.field);
    case 'aggregation':
      return aggregationLabel(source, column.aggregation);
    case 'breakout': {
      const { breakout } = column;
      if (!breakout.bucket) return fieldLabel(source, breakout.field);
      const primary = breakout.field === 'date' || breakout.field === 'month';
      if (primary) return bucketLabel(breakout.bucket);
      const field = fieldLabel(source, breakout.field);
      const bucket = bucketLabel(breakout.bucket);
      return t`${field}: ${bucket}`;
    }
  }
}

const MONEY_FIELDS = new Set(['amount', 'inflow', 'outflow', 'assigned', 'activity', 'balance']);

/** How a numeric column should be formatted. */
export function columnFormat(column: QuestionColumn): 'money' | 'number' | 'text' {
  if (column.kind === 'aggregation') {
    const { op, field } = column.aggregation;
    if (op === 'count' || op === 'distinct') return 'number';
    if (op === 'spending' || op === 'income' || op === 'net' || op === 'averageSpending') {
      return 'money';
    }
    return field && MONEY_FIELDS.has(field) ? 'money' : 'number';
  }
  if (column.kind === 'field') {
    if (MONEY_FIELDS.has(column.field)) return 'money';
    if (column.field === 'balance_native' || column.field === 'transaction_count') return 'number';
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
  valueName: (value: string | number | boolean) => string = String
): string {
  const field = getField(source, filter.field);
  const name = fieldLabel(source, filter.field);
  if (!field) return name;
  const values = filter.values.map(valueName);
  const [first = '', second = ''] = values;
  const more = values.length - 2;
  const list = values.length > 2 ? t`${first}, ${second} and ${more} more` : values.join(', ');
  const firstDate = formatIsoDate(filter.values[0]);
  const secondDate = formatIsoDate(filter.values[1]);
  switch (filter.op) {
    case 'isEmpty':
      return t`${name} is empty`;
    case 'notEmpty':
      return t`${name} is not empty`;
    case 'previous': {
      const amount = filter.amount ?? 1;
      const unit = unitLabel(filter.unit ?? 'month', amount);
      return filter.includeCurrent === false
        ? t`${name}: previous ${amount} full ${unit}`
        : t`${name}: last ${amount} ${unit}`;
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
      return field.type === 'date'
        ? t`${name}: ${firstDate} – ${secondDate}`
        : t`${name} between ${first} and ${second}`;
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
  const metric = aggregationLabel(spec.source, spec.aggregations[0]);
  const secondMetric =
    spec.aggregations.length === 2 ? aggregationLabel(spec.source, spec.aggregations[1]) : '';
  const metrics = secondMetric ? t`${metric} and ${secondMetric}` : metric;
  if (spec.breakouts.length === 0) return metrics;
  const groups = spec.breakouts.map((breakout) =>
    breakout.bucket && (breakout.field === 'date' || breakout.field === 'month')
      ? bucketLabel(breakout.bucket)
      : fieldLabel(spec.source, breakout.field)
  );
  const [firstGroup, secondGroup] = groups;
  const by = secondGroup ? t`${firstGroup} and ${secondGroup}` : firstGroup;
  return t`${metrics} by ${by}`;
}
