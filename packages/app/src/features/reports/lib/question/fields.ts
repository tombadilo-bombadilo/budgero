/**
 * Data sources a question can start from, and the fields each one exposes.
 *
 * Every source compiles to a `src` CTE whose column names are the field ids
 * below (plus `<field>_id` id columns for id-keyed entities), so filters,
 * summaries and sorts only ever reference these known identifiers.
 */

export const QUESTION_SOURCES = [
  'transactions',
  'budget',
  'accounts',
  'balances',
  'scheduled',
  'upcoming',
  'payees',
] as const;
export type QuestionSource = (typeof QUESTION_SOURCES)[number];

export const DATE_BUCKETS = ['day', 'week', 'month', 'quarter', 'year'] as const;
export type DateBucket = (typeof DATE_BUCKETS)[number];

/**
 * Date parts: a grouping (or filter) on one component of a date, e.g.
 * "spending by weekday". Values are whole numbers: year (2026), quarter of
 * year (1-4), month of year (1-12), day of month (1-31), ISO day of week
 * (1 = Monday ... 7 = Sunday).
 */
export const DATE_PARTS = [
  'year',
  'quarterOfYear',
  'monthOfYear',
  'dayOfMonth',
  'dayOfWeek',
] as const;
export type DatePart = (typeof DATE_PARTS)[number];

/** Inclusive value range of each date part. */
export const DATE_PART_RANGE: Record<DatePart, readonly [number, number]> = {
  year: [1, 9999],
  quarterOfYear: [1, 4],
  monthOfYear: [1, 12],
  dayOfMonth: [1, 31],
  dayOfWeek: [1, 7],
};

export type FieldType = 'date' | 'number' | 'text' | 'boolean' | 'entity';

/** What kind of thing an entity / text field holds; drives the value picker. */
export type ValueKind =
  | 'account'
  | 'category'
  | 'categoryGroup'
  | 'label'
  | 'payee'
  | 'accountType'
  | 'currency'
  | 'memo'
  | 'goalType'
  | 'frequency'
  | 'scheduleStatus';

export interface FieldDef {
  id: string;
  type: FieldType;
  /**
   * Id-keyed entities filter by `<id>_id` (numbers). Name-keyed fields
   * (payee, account type, currency) filter by name.
   */
  idKeyed?: boolean;
  valueKind?: ValueKind;
  /** Allowed date buckets (date fields only). */
  buckets?: readonly DateBucket[];
  /** Default bucket when used as a grouping. */
  defaultBucket?: DateBucket;
  /** Usable in Summarize "by" (groupings). */
  groupable: boolean;
  /**
   * Only a filter (Payees: the transactions a payee's totals count), never a
   * column, metric, grouping or expression field.
   */
  filterOnly?: boolean;
}

const date = (id: string, buckets: readonly DateBucket[], defaultBucket: DateBucket): FieldDef => ({
  id,
  type: 'date',
  buckets,
  defaultBucket,
  groupable: true,
});
const entity = (id: string, valueKind: ValueKind, idKeyed: boolean): FieldDef => ({
  id,
  type: 'entity',
  valueKind,
  idKeyed,
  groupable: true,
});
const text = (id: string, valueKind: ValueKind, groupable = true): FieldDef => ({
  id,
  type: 'text',
  valueKind,
  groupable,
});
const number = (id: string): FieldDef => ({ id, type: 'number', groupable: false });
const bool = (id: string): FieldDef => ({ id, type: 'boolean', groupable: true });
const filterOnly = (field: FieldDef): FieldDef => ({
  ...field,
  groupable: false,
  filterOnly: true,
});

export const SOURCE_FIELDS: Record<QuestionSource, readonly FieldDef[]> = {
  transactions: [
    date('date', DATE_BUCKETS, 'month'),
    entity('category', 'category', true),
    entity('category_group', 'categoryGroup', true),
    entity('payee', 'payee', false),
    entity('account', 'account', true),
    entity('label', 'label', true),
    text('memo', 'memo', false),
    number('amount'),
    number('inflow'),
    number('outflow'),
    bool('is_transfer'),
    bool('on_budget'),
    bool('cleared'),
    bool('is_income'),
  ],
  budget: [
    date('month', ['month', 'quarter', 'year'], 'month'),
    entity('category', 'category', true),
    entity('category_group', 'categoryGroup', true),
    number('assigned'),
    number('activity'),
    number('available'),
    text('goal_type', 'goalType'),
    number('goal_target'),
    number('goal_monthly_target'),
    number('goal_needed'),
    number('goal_progress'),
    bool('goal_funded'),
  ],
  accounts: [
    entity('account', 'account', true),
    text('account_type', 'accountType'),
    text('currency', 'currency'),
    bool('on_budget'),
    bool('closed'),
    number('balance'),
    number('balance_native'),
    number('transaction_count'),
    date('last_transaction', DATE_BUCKETS, 'month'),
  ],
  balances: [
    date('date', DATE_BUCKETS, 'month'),
    entity('account', 'account', true),
    text('account_type', 'accountType'),
    text('currency', 'currency'),
    bool('on_budget'),
    bool('closed'),
    bool('is_liability'),
    number('balance'),
    number('balance_native'),
    number('change'),
    number('assets'),
    number('debts'),
  ],
  scheduled: [
    entity('payee', 'payee', false),
    date('next_date', DATE_BUCKETS, 'month'),
    entity('account', 'account', true),
    entity('to_account', 'account', true),
    entity('category', 'category', true),
    entity('category_group', 'categoryGroup', true),
    text('memo', 'memo', false),
    number('amount'),
    number('inflow'),
    number('outflow'),
    number('monthly_amount'),
    text('frequency', 'frequency'),
    text('status', 'scheduleStatus'),
    bool('active'),
    bool('is_transfer'),
    bool('is_split'),
    text('currency', 'currency'),
    number('amount_native'),
    number('days_until'),
    date('start_date', DATE_BUCKETS, 'month'),
    date('end_date', DATE_BUCKETS, 'month'),
  ],
  upcoming: [
    date('due_date', DATE_BUCKETS, 'day'),
    entity('payee', 'payee', false),
    entity('account', 'account', true),
    entity('to_account', 'account', true),
    entity('category', 'category', true),
    entity('category_group', 'categoryGroup', true),
    text('memo', 'memo', false),
    number('amount'),
    number('inflow'),
    number('outflow'),
    number('days_until'),
    bool('is_overdue'),
    bool('is_transfer'),
    bool('is_split'),
    text('frequency', 'frequency'),
    text('currency', 'currency'),
    number('amount_native'),
  ],
  payees: [
    entity('payee', 'payee', false),
    number('transaction_count'),
    number('total'),
    number('inflow'),
    number('outflow'),
    number('average_amount'),
    date('first_seen', DATE_BUCKETS, 'month'),
    date('last_seen', DATE_BUCKETS, 'month'),
    entity('top_category', 'category', true),
    // The transactions the totals count (not columns of a payee row).
    filterOnly(date('date', DATE_BUCKETS, 'month')),
    filterOnly(entity('account', 'account', true)),
    filterOnly(entity('category', 'category', true)),
    filterOnly(entity('category_group', 'categoryGroup', true)),
    filterOnly(bool('on_budget')),
  ],
};

/** The date field of a source that gets bucket-only column names (`month`, not `date_month`). */
export const PRIMARY_DATE_FIELD: Record<QuestionSource, string | null> = {
  transactions: 'date',
  budget: 'month',
  accounts: null,
  balances: 'date',
  // A dashboard date range means nothing for "when is the next one".
  scheduled: null,
  upcoming: 'due_date',
  payees: 'date',
};

/** Columns shown when a question has no Summarize step and no column choice. */
export const DEFAULT_RAW_COLUMNS: Record<QuestionSource, readonly string[]> = {
  transactions: ['date', 'account', 'payee', 'category', 'memo', 'amount'],
  budget: ['month', 'category_group', 'category', 'assigned', 'activity'],
  accounts: ['account', 'account_type', 'currency', 'on_budget', 'closed', 'balance'],
  balances: ['account', 'account_type', 'currency', 'date', 'balance', 'balance_native'],
  scheduled: ['payee', 'next_date', 'frequency', 'account', 'category', 'amount', 'monthly_amount'],
  upcoming: ['due_date', 'payee', 'account', 'category', 'amount'],
  payees: ['payee', 'transaction_count', 'outflow', 'inflow', 'total', 'last_seen', 'top_category'],
};

/** Date parts a date field offers (day-level parts need a day-level date). */
export function datePartsFor(field: FieldDef | undefined): DatePart[] {
  if (!field || field.type !== 'date') return [];
  if (field.buckets?.includes('day')) return [...DATE_PARTS];
  return ['year', 'quarterOfYear', 'monthOfYear'];
}

export function getField(source: QuestionSource, fieldId: string): FieldDef | undefined {
  return SOURCE_FIELDS[source].find((field) => field.id === fieldId);
}

/** Fields of a source's rows: everything but filter-only fields. */
export function rowFields(source: QuestionSource): FieldDef[] {
  return SOURCE_FIELDS[source].filter((field) => !field.filterOnly);
}

export function numericFields(source: QuestionSource): FieldDef[] {
  return rowFields(source).filter((field) => field.type === 'number');
}

export function groupableFields(source: QuestionSource): FieldDef[] {
  return SOURCE_FIELDS[source].filter((field) => field.groupable);
}
