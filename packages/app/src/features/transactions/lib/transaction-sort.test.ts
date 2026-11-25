import { describe, expect, it } from 'vitest';
import { asMilli } from '@shared/lib/currency/milli';
import type { GetTransactionsByAccountRow } from '@budgero/core/browser';
import { makeAmountAccessors } from './amount-accessors';
import {
  nextTransactionSort,
  parseTransactionSort,
  sortTransactions,
  type TransactionSortContext,
  type TransactionSortState,
} from './transaction-sort';

function row(
  ID: number,
  Date: string,
  amount: number,
  extra: Partial<GetTransactionsByAccountRow> = {}
): GetTransactionsByAccountRow {
  return {
    ID,
    Date,
    CategoryID: 1,
    Category: 'Groceries',
    Memo: '',
    Reconciled: false,
    Cleared: false,
    InflowConverted: asMilli(Math.max(amount, 0)),
    OutflowConverted: asMilli(Math.max(-amount, 0)),
    RunningBalanceConverted: asMilli(0),
    ...extra,
  } as GetTransactionsByAccountRow;
}

function contextFor(display: 'budget' | 'account' = 'budget'): TransactionSortContext {
  const { getPrimaryInflow, getPrimaryOutflow } = makeAmountAccessors(display);
  return {
    signedAmount: (tx) => getPrimaryInflow(tx) - getPrimaryOutflow(tx),
    splitLabel: 'Split',
    transfersLabel: 'Transfers',
    locale: 'en',
  };
}

const ids = (rows: GetTransactionsByAccountRow[]) => rows.map((r) => r.ID);
const asc = (column: NonNullable<TransactionSortState>['column']) =>
  ({ column, direction: 'asc' }) as const;
const desc = (column: NonNullable<TransactionSortState>['column']) =>
  ({ column, direction: 'desc' }) as const;

describe('nextTransactionSort', () => {
  it('cycles ascending, descending, then back to the default order', () => {
    const first = nextTransactionSort(null, 'payee');
    expect(first).toEqual({ column: 'payee', direction: 'asc' });
    const second = nextTransactionSort(first, 'payee');
    expect(second).toEqual({ column: 'payee', direction: 'desc' });
    expect(nextTransactionSort(second, 'payee')).toBeNull();
  });

  it('starts a new column ascending', () => {
    expect(nextTransactionSort(desc('payee'), 'amount')).toEqual(asc('amount'));
  });
});

describe('parseTransactionSort', () => {
  it('accepts known columns and directions only', () => {
    expect(parseTransactionSort({ column: 'memo', direction: 'desc' })).toEqual(desc('memo'));
    expect(parseTransactionSort({ column: 'balance', direction: 'asc' })).toBeNull();
    expect(parseTransactionSort({ column: 'memo', direction: 'up' })).toBeNull();
    expect(parseTransactionSort(undefined)).toBeNull();
    expect(parseTransactionSort('memo')).toBeNull();
  });
});

describe('sortTransactions', () => {
  it('returns the rows untouched in the default order', () => {
    const rows = [row(2, '2026-10-02', -5), row(1, '2026-10-01', 10)];
    expect(sortTransactions(rows, null, contextFor())).toBe(rows);
  });

  it('sorts by date, oldest first, then by entry; and the reverse', () => {
    const rows = [
      row(3, '2026-10-02', 0),
      row(4, '2026-10-02', 0),
      row(1, '2026-09-30', 0),
      row(2, '2026-10-01', 0),
    ];
    expect(ids(sortTransactions(rows, asc('date'), contextFor()))).toEqual([1, 2, 3, 4]);
    expect(ids(sortTransactions(rows, desc('date'), contextFor()))).toEqual([4, 3, 2, 1]);
  });

  it('orders a day by time of day, untimed rows first when ascending', () => {
    const rows = [
      row(1, '2026-10-02', 0, { Time: '18:00' }),
      row(2, '2026-10-02', 0, { Time: null }),
      row(3, '2026-10-02', 0, { Time: '08:15' }),
    ];
    expect(ids(sortTransactions(rows, asc('date'), contextFor()))).toEqual([2, 3, 1]);
  });

  it('sorts by signed amount: biggest outflow first when ascending', () => {
    const rows = [
      row(1, '2026-10-01', 100),
      row(2, '2026-10-01', -50),
      row(3, '2026-10-01', -200),
      row(4, '2026-10-01', 0),
    ];
    expect(ids(sortTransactions(rows, asc('amount'), contextFor()))).toEqual([3, 2, 4, 1]);
    expect(ids(sortTransactions(rows, desc('amount'), contextFor()))).toEqual([1, 4, 2, 3]);
  });

  it('follows the currency toggle for amounts', () => {
    // In the budget currency #1 is the bigger outflow; in the account currency #2 is.
    const rows = [
      row(1, '2026-10-01', -100, { OutflowNative: asMilli(10) }),
      row(2, '2026-10-01', -50, { OutflowNative: asMilli(90) }),
    ];
    expect(ids(sortTransactions(rows, asc('amount'), contextFor('budget')))).toEqual([1, 2]);
    expect(ids(sortTransactions(rows, asc('amount'), contextFor('account')))).toEqual([2, 1]);
  });

  it('compares text case-insensitively and locale-aware, empty values last both ways', () => {
    const rows = [
      row(1, '2026-10-01', 0, { Payee: 'zara' }),
      row(2, '2026-10-01', 0, { Payee: '' }),
      row(3, '2026-10-01', 0, { Payee: 'Älska' }),
      row(4, '2026-10-01', 0, { Payee: 'apple' }),
      row(5, '2026-10-01', 0, { Payee: 'Banana' }),
    ];
    expect(ids(sortTransactions(rows, asc('payee'), contextFor()))).toEqual([3, 4, 5, 1, 2]);
    expect(ids(sortTransactions(rows, desc('payee'), contextFor()))).toEqual([1, 5, 4, 3, 2]);
  });

  it('breaks ties by the default order: newest date, then newest entry', () => {
    const rows = [
      row(1, '2026-10-01', 0, { Memo: 'rent' }),
      row(2, '2026-10-03', 0, { Memo: 'RENT' }),
      row(3, '2026-10-01', 0, { Memo: 'rent' }),
      row(4, '2026-10-02', 0, { Memo: 'coffee' }),
    ];
    expect(ids(sortTransactions(rows, asc('memo'), contextFor()))).toEqual([4, 2, 3, 1]);
    expect(ids(sortTransactions(rows, desc('memo'), contextFor()))).toEqual([2, 3, 1, 4]);
  });

  it('sorts payees of transfers and splits by the shown name, without the arrow', () => {
    const rows = [
      row(1, '2026-10-01', -10, { TransferID: 't1', TransferAccountName: 'Savings' }),
      row(2, '2026-10-01', 0, { Payee: 'Market' }),
      row(3, '2026-10-01', 10, { TransferID: 't2', TransferAccountName: 'Checking' }),
      row(4, '2026-10-01', -5, {
        Category: 'Split',
        SplitPayees: JSON.stringify([['Bakery', null, 0]]),
      }),
    ];
    expect(ids(sortTransactions(rows, asc('payee'), contextFor()))).toEqual([4, 3, 2, 1]);
  });

  it('sorts categories as shown: Split and Transfers by name, uncategorized last', () => {
    const rows = [
      row(1, '2026-10-01', 0, { CategoryID: 0, Category: 'Uncategorized' }),
      row(2, '2026-10-01', 0, { Category: 'Split', CategoryID: 0 }),
      row(3, '2026-10-01', 0, { Category: 'Rent' }),
      row(4, '2026-10-01', 0, { TransferID: 't', Category: '', CategoryID: 0 }),
      row(5, '2026-10-01', 0, { Category: 'Groceries' }),
    ];
    expect(ids(sortTransactions(rows, asc('category'), contextFor()))).toEqual([5, 3, 2, 4, 1]);
    expect(ids(sortTransactions(rows, desc('category'), contextFor()))).toEqual([4, 2, 3, 5, 1]);
  });

  it('sorts by account and label, empty last', () => {
    const rows = [
      row(1, '2026-10-01', 0, { Account: 'Wallet', Label: 'b' }),
      row(2, '2026-10-01', 0, { Account: 'bank', Label: null }),
      row(3, '2026-10-01', 0, { Account: 'Card', Label: 'A' }),
    ];
    expect(ids(sortTransactions(rows, asc('account'), contextFor()))).toEqual([2, 3, 1]);
    expect(ids(sortTransactions(rows, asc('label'), contextFor()))).toEqual([3, 1, 2]);
    expect(ids(sortTransactions(rows, desc('label'), contextFor()))).toEqual([1, 3, 2]);
  });

  it('sorts by status: uncleared, cleared, reconciled', () => {
    const rows = [
      row(1, '2026-10-01', 0, { Reconciled: true, Cleared: true }),
      row(2, '2026-10-01', 0, { Cleared: false }),
      row(3, '2026-10-01', 0, { Cleared: true }),
    ];
    expect(ids(sortTransactions(rows, asc('status'), contextFor()))).toEqual([2, 3, 1]);
    expect(ids(sortTransactions(rows, desc('status'), contextFor()))).toEqual([1, 3, 2]);
  });

  it('keeps a split parent as one row, by its total', () => {
    const split = row(2, '2026-10-01', -30, { Category: 'Split', CategoryID: 0 });
    const rows = [row(1, '2026-10-01', -10), split, row(3, '2026-10-01', -20)];
    const sorted = sortTransactions(rows, asc('amount'), contextFor());
    expect(ids(sorted)).toEqual([2, 3, 1]);
    expect(sorted[0]).toBe(split);
  });

  it('keeps upcoming recurring rows as a block on top, in their own order', () => {
    const rows = [
      row(-11, '2026-12-01', -500, { IsProjected: true }),
      row(-10, '2026-11-15', 5, { IsProjected: true }),
      row(2, '2026-10-02', -1, { Payee: 'b' }),
      row(1, '2026-10-01', -1000, { Payee: 'a' }),
    ];
    expect(ids(sortTransactions(rows, asc('amount'), contextFor()))).toEqual([-11, -10, 1, 2]);
    expect(ids(sortTransactions(rows, desc('payee'), contextFor()))).toEqual([-11, -10, 2, 1]);
  });

  it('is stable and quick enough for 100k rows', () => {
    const payees = ['Market', 'rent', 'Bakery', '', 'Coffee', 'Älska'];
    const rows = Array.from({ length: 100_000 }, (_, i) =>
      row(100_000 - i, `2026-${String((i % 12) + 1).padStart(2, '0')}-01`, (i % 997) - 500, {
        Payee: payees[i % payees.length],
      })
    );
    const started = performance.now();
    const sorted = sortTransactions(rows, asc('payee'), contextFor());
    const amount = sortTransactions(rows, desc('amount'), contextFor());
    const elapsed = performance.now() - started;
    expect(sorted).toHaveLength(rows.length);
    expect(amount).toHaveLength(rows.length);
    expect(sorted[0].Payee).toBe('Älska');
    expect(sorted[sorted.length - 1].Payee).toBe('');
    // Generous bound: the point is no per-comparison collation or row re-reads.
    expect(elapsed).toBeLessThan(3000);
  });
});
