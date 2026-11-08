/**
 * Data sources a question can start from, and the fields each one exposes.
 *
 * Every source compiles to a `src` CTE whose column names are the field ids
 * below (plus `<field>_id` id columns for id-keyed entities), so filters,
 * summaries and sorts only ever reference these known identifiers.
 */

export const QUESTION_SOURCES = ['transactions', 'budget', 'accounts'] as const;
export type QuestionSource = (typeof QUESTION_SOURCES)[number];

export const DATE_BUCKETS = ['day', 'week', 'month', 'quarter', 'year'] as const;
export type DateBucket = (typeof DATE_BUCKETS)[number];

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
  | 'memo';

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
};

/** The date field of a source that gets bucket-only column names (`month`, not `date_month`). */
export const PRIMARY_DATE_FIELD: Record<QuestionSource, string | null> = {
  transactions: 'date',
  budget: 'month',
  accounts: null,
};

/** Columns shown when a question has no Summarize step and no column choice. */
export const DEFAULT_RAW_COLUMNS: Record<QuestionSource, readonly string[]> = {
  transactions: ['date', 'account', 'payee', 'category', 'memo', 'amount'],
  budget: ['month', 'category_group', 'category', 'assigned', 'activity'],
  accounts: ['account', 'account_type', 'currency', 'on_budget', 'closed', 'balance'],
};

export function getField(source: QuestionSource, fieldId: string): FieldDef | undefined {
  return SOURCE_FIELDS[source].find((field) => field.id === fieldId);
}

export function numericFields(source: QuestionSource): FieldDef[] {
  return SOURCE_FIELDS[source].filter((field) => field.type === 'number');
}

export function groupableFields(source: QuestionSource): FieldDef[] {
  return SOURCE_FIELDS[source].filter((field) => field.groupable);
}
