import type { TransactionSortState } from './transaction-sort';

/**
 * Desktop register display options: hide the Memo or Payee column, and let
 * the memo wrap onto several lines. A personal display choice, synced per
 * user (synced state, user scope) under TRANSACTION_TABLE_COLUMNS_KEY. Each
 * field is merged on its own, so two devices changing different fields both
 * keep theirs. Missing fields read as the defaults.
 */
export const TRANSACTION_TABLE_COLUMNS_KEY = 'transactionTableColumns';

export interface TransactionTableColumns {
  /** Show the Memo column. */
  showMemo: boolean;
  /** Show the Payee column. */
  showPayee: boolean;
  /** Wrap long memos onto several lines (rows grow) instead of cutting them off. */
  wrapMemo: boolean;
}

export const DEFAULT_TRANSACTION_TABLE_COLUMNS: TransactionTableColumns = {
  showMemo: true,
  showPayee: true,
  wrapMemo: false,
};

const FIELDS = Object.keys(DEFAULT_TRANSACTION_TABLE_COLUMNS) as (keyof TransactionTableColumns)[];

export function parseTransactionTableColumns(value: unknown): TransactionTableColumns {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return DEFAULT_TRANSACTION_TABLE_COLUMNS;
  }
  const raw = value as Partial<Record<keyof TransactionTableColumns, unknown>>;
  const parsed = { ...DEFAULT_TRANSACTION_TABLE_COLUMNS };
  for (const field of FIELDS) {
    const stored = raw[field];
    if (typeof stored === 'boolean') parsed[field] = stored;
  }
  return parsed;
}

export function sameTransactionTableColumns(
  a: TransactionTableColumns,
  b: TransactionTableColumns
): boolean {
  return FIELDS.every((field) => a[field] === b[field]);
}

/**
 * The sort the desktop table applies: a sort on a hidden column falls back to
 * the default order (nothing on screen would explain the order). The stored
 * sort is kept, so showing the column again brings it back.
 */
export function visibleColumnSort(
  sort: TransactionSortState,
  columns: TransactionTableColumns
): TransactionSortState {
  if (!sort) return sort;
  if (sort.column === 'memo' && !columns.showMemo) return null;
  if (sort.column === 'payee' && !columns.showPayee) return null;
  return sort;
}
