import { describe, expect, it } from 'vitest';

import {
  DEFAULT_TRANSACTION_TABLE_COLUMNS,
  parseTransactionTableColumns,
  sameTransactionTableColumns,
  visibleColumnSort,
} from './table-columns';

describe('parseTransactionTableColumns', () => {
  it('shows Memo and Payee without wrapping by default', () => {
    expect(DEFAULT_TRANSACTION_TABLE_COLUMNS).toEqual({
      showMemo: true,
      showPayee: true,
      wrapMemo: false,
    });
    expect(parseTransactionTableColumns(undefined)).toEqual(DEFAULT_TRANSACTION_TABLE_COLUMNS);
    expect(parseTransactionTableColumns(null)).toEqual(DEFAULT_TRANSACTION_TABLE_COLUMNS);
    expect(parseTransactionTableColumns([])).toEqual(DEFAULT_TRANSACTION_TABLE_COLUMNS);
    expect(parseTransactionTableColumns('x')).toEqual(DEFAULT_TRANSACTION_TABLE_COLUMNS);
  });

  it('reads stored fields and keeps defaults for missing or invalid ones', () => {
    expect(parseTransactionTableColumns({ showMemo: false })).toEqual({
      showMemo: false,
      showPayee: true,
      wrapMemo: false,
    });
    expect(
      parseTransactionTableColumns({ showPayee: false, wrapMemo: true, showMemo: 'no', extra: 1 })
    ).toEqual({ showMemo: true, showPayee: false, wrapMemo: true });
  });

  it('compares every field', () => {
    const a = { showMemo: true, showPayee: false, wrapMemo: true };
    expect(sameTransactionTableColumns(a, { ...a })).toBe(true);
    expect(sameTransactionTableColumns(a, { ...a, wrapMemo: false })).toBe(false);
  });
});

describe('visibleColumnSort', () => {
  const all = DEFAULT_TRANSACTION_TABLE_COLUMNS;

  it('keeps a sort on a visible column', () => {
    expect(visibleColumnSort({ column: 'memo', direction: 'asc' }, all)).toEqual({
      column: 'memo',
      direction: 'asc',
    });
    expect(visibleColumnSort(null, all)).toBeNull();
  });

  it('falls back to the default order when the sorted column is hidden', () => {
    expect(
      visibleColumnSort({ column: 'memo', direction: 'desc' }, { ...all, showMemo: false })
    ).toBeNull();
    expect(
      visibleColumnSort({ column: 'payee', direction: 'asc' }, { ...all, showPayee: false })
    ).toBeNull();
    expect(
      visibleColumnSort({ column: 'amount', direction: 'asc' }, { ...all, showPayee: false })
    ).toEqual({ column: 'amount', direction: 'asc' });
  });
});
