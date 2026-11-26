import type { GetTransactionsByAccountRow } from '@budgero/core/browser';
import { extractDateKey } from '@shared/lib/date-utils';
import { splitPayeesLabel, transferPayeeLabel } from './transfer-category';

/** Register columns that can be sorted. Inflow and outflow both sort by the signed amount. */
export const TRANSACTION_SORT_COLUMNS = [
  'date',
  'payee',
  'category',
  'memo',
  'account',
  'label',
  'status',
  'amount',
] as const;

export type TransactionSortColumn = (typeof TRANSACTION_SORT_COLUMNS)[number];
export type TransactionSortDirection = 'asc' | 'desc';

export interface TransactionSort {
  column: TransactionSortColumn;
  direction: TransactionSortDirection;
}

/** null = the register's default order (date, newest first, same-day preference). */
export type TransactionSortState = TransactionSort | null;

export function isTransactionSortColumn(value: unknown): value is TransactionSortColumn {
  return (
    typeof value === 'string' && (TRANSACTION_SORT_COLUMNS as readonly string[]).includes(value)
  );
}

/** A stored sort, or null when the value is missing or not one this build knows. */
export function parseTransactionSort(value: unknown): TransactionSortState {
  if (!value || typeof value !== 'object') return null;
  const { column, direction } = value as Record<string, unknown>;
  if (!isTransactionSortColumn(column)) return null;
  if (direction !== 'asc' && direction !== 'desc') return null;
  return { column, direction };
}

export function sameTransactionSort(a: TransactionSortState, b: TransactionSortState): boolean {
  if (a === null || b === null) return a === b;
  return a.column === b.column && a.direction === b.direction;
}

/**
 * A header click: a new column starts ascending, the active one turns
 * descending, and a third click returns to the default order.
 */
export function nextTransactionSort(
  current: TransactionSortState,
  column: TransactionSortColumn
): TransactionSortState {
  if (!current || current.column !== column) return { column, direction: 'asc' };
  if (current.direction === 'asc') return { column, direction: 'desc' };
  return null;
}

export interface TransactionSortContext {
  /** Inflow minus outflow in the currency the register shows (follows the currency toggle). */
  signedAmount: (row: GetTransactionsByAccountRow) => number;
  /** What the category cell shows for a split parent. */
  splitLabel: string;
  /** What the category cell shows for an on-budget transfer without a category. */
  transfersLabel: string;
  /** UI locale for text comparison. */
  locale?: string;
}

type TextColumn = 'payee' | 'category' | 'memo' | 'account' | 'label';

const TRANSFER_ARROW = /^[→←]\s*/;

function isUncategorizedRow(row: GetTransactionsByAccountRow): boolean {
  if (row.Category === 'Split') return false;
  return !row.CategoryID || !row.Category || row.Category === 'Uncategorized';
}

/** The text a column shows for a row, as compared when sorting ('' = empty, sorted last). */
export function transactionSortText(
  row: GetTransactionsByAccountRow,
  column: TextColumn,
  context: Pick<TransactionSortContext, 'splitLabel' | 'transfersLabel'>
): string {
  switch (column) {
    case 'payee': {
      const label = row.Payee?.trim() || transferPayeeLabel(row) || splitPayeesLabel(row) || '';
      // Transfers sort by the other account's name, not by their direction arrow.
      return label.replace(TRANSFER_ARROW, '').trim();
    }
    case 'category':
      if (row.Category === 'Split') return context.splitLabel;
      if (row.TransferID?.trim() && !row.Category) return context.transfersLabel;
      return isUncategorizedRow(row) ? '' : row.Category.trim();
    case 'memo':
      return row.Memo?.trim() ?? '';
    case 'account':
      return row.Account?.trim() ?? '';
    case 'label':
      return row.Label?.trim() ?? '';
  }
}

/** Uncleared < cleared < reconciled. */
export function transactionStatusRank(row: GetTransactionsByAccountRow): number {
  if (row.Reconciled) return 2;
  return row.Cleared ? 1 : 0;
}

function timeMinutes(time: string | null | undefined): number {
  const match = time?.match(/^(\d{1,2}):(\d{2})/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : -1;
}

/** Date (and time of day, untimed first) as one comparable number. */
function dateTimeKey(row: GetTransactionsByAccountRow): number {
  const dateKey = extractDateKey(row.Date);
  const day = dateKey === 'unknown' ? 0 : Number(dateKey.replace(/-/g, ''));
  return day * 10_000 + timeMinutes(row.Time) + 1;
}

/**
 * Ranks of every row's text, computed once: the distinct values are sorted
 * with a case-insensitive, locale-aware collator (payees and categories
 * repeat, so this is far fewer comparisons than the rows), then rows compare
 * by number.
 */
function textRanks(texts: string[], locale: string | undefined): Float64Array {
  const collator = new Intl.Collator(locale, { sensitivity: 'base', numeric: true });
  const distinct = [...new Set(texts)].sort(collator.compare);
  const rankOf = new Map<string, number>();
  let rank = 0;
  for (let i = 0; i < distinct.length; i++) {
    if (i > 0 && collator.compare(distinct[i - 1], distinct[i]) !== 0) rank++;
    rankOf.set(distinct[i], rank);
  }
  const ranks = new Float64Array(texts.length);
  for (let i = 0; i < texts.length; i++) ranks[i] = rankOf.get(texts[i])!;
  return ranks;
}

/**
 * Sorts register rows by a column. Each row (a split parent with its lines,
 * too) moves as one; upcoming (projected) recurring rows stay a block on top
 * in their own order. Empty text sorts last in both directions. Ties keep the
 * register's default order (newest date first, then newest entry), and the
 * date column breaks its own ties by entry in the chosen direction. Keys are
 * computed once per call, so 100k rows sort by number, not by re-reading rows.
 */
export function sortTransactions(
  rows: GetTransactionsByAccountRow[],
  sort: TransactionSortState,
  context: TransactionSortContext
): GetTransactionsByAccountRow[] {
  if (!sort || rows.length < 2) return rows;

  const projected: GetTransactionsByAccountRow[] = [];
  const real: GetTransactionsByAccountRow[] = [];
  for (const row of rows) (row.IsProjected ? projected : real).push(row);

  const n = real.length;
  const ids = new Float64Array(n);
  const dates = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    ids[i] = real[i].ID;
    dates[i] = dateTimeKey(real[i]);
  }

  let keys: Float64Array;
  let empty: Uint8Array | null = null;
  switch (sort.column) {
    case 'date':
      keys = dates;
      break;
    case 'amount':
      keys = new Float64Array(n);
      for (let i = 0; i < n; i++) keys[i] = context.signedAmount(real[i]) || 0;
      break;
    case 'status':
      keys = new Float64Array(n);
      for (let i = 0; i < n; i++) keys[i] = transactionStatusRank(real[i]);
      break;
    default: {
      const texts = real.map((row) => transactionSortText(row, sort.column as TextColumn, context));
      keys = textRanks(texts, context.locale);
      empty = new Uint8Array(n);
      for (let i = 0; i < n; i++) empty[i] = texts[i] === '' ? 1 : 0;
    }
  }

  const dir = sort.direction === 'asc' ? 1 : -1;
  const isDate = sort.column === 'date';
  const order = Array.from({ length: n }, (_, i) => i);
  order.sort((a, b) => {
    if (empty && empty[a] !== empty[b]) return empty[a] - empty[b];
    const diff = keys[a] - keys[b];
    if (diff !== 0) return dir * diff;
    if (isDate) return dir * (ids[a] - ids[b]);
    return dates[b] - dates[a] || ids[b] - ids[a];
  });

  const sorted = new Array<GetTransactionsByAccountRow>(projected.length + n);
  for (let i = 0; i < projected.length; i++) sorted[i] = projected[i];
  for (let i = 0; i < n; i++) sorted[projected.length + i] = real[order[i]];
  return sorted;
}
