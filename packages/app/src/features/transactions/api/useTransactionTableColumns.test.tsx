import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TRANSACTION_TABLE_COLUMNS_KEY } from '@features/transactions/lib/table-columns';
import { useTransactionTableColumns } from './useTransactionTableColumns';

const synced = vi.hoisted(() => ({
  value: undefined as Record<string, unknown> | undefined,
  canWrite: true,
  merge: vi.fn(async () => true),
  scope: null as string | null,
  key: null as string | null,
}));

vi.mock('@entities/user/api/useAuth', () => ({
  useProfile: () => ({ data: { id: 'u1' } }),
}));

vi.mock('@shared/lib/synced-state', () => ({
  userScope: (id: string) => `user:${id}`,
  useSyncedState: (scope: string | null, key: string) => {
    synced.scope = scope;
    synced.key = key;
    return {
      value: synced.value,
      loaded: true,
      available: true,
      canWrite: synced.canWrite,
      set: vi.fn(),
      merge: synced.merge,
    };
  },
}));

describe('useTransactionTableColumns', () => {
  beforeEach(() => {
    synced.value = undefined;
    synced.canWrite = true;
    synced.merge.mockClear();
  });

  it('reads the user scope entry, with defaults when nothing is stored', () => {
    const { result } = renderHook(() => useTransactionTableColumns());
    expect(synced.scope).toBe('user:u1');
    expect(synced.key).toBe(TRANSACTION_TABLE_COLUMNS_KEY);
    expect(TRANSACTION_TABLE_COLUMNS_KEY).toBe('transactionTableColumns');
    expect(result.current.columns).toEqual({ showMemo: true, showPayee: true, wrapMemo: false });
  });

  it('reads stored options', () => {
    synced.value = { showPayee: false, wrapMemo: true };
    const { result } = renderHook(() => useTransactionTableColumns());
    expect(result.current.columns).toEqual({ showMemo: true, showPayee: false, wrapMemo: true });
  });

  it('shows a change at once and merges only the changed field', () => {
    const { result } = renderHook(() => useTransactionTableColumns());
    act(() => result.current.update({ showMemo: false }));
    expect(result.current.columns.showMemo).toBe(false);
    expect(synced.merge).toHaveBeenCalledWith({ set: { showMemo: false } });
    act(() => result.current.update({ wrapMemo: true }));
    expect(result.current.columns).toEqual({ showMemo: false, showPayee: true, wrapMemo: true });
    expect(synced.merge).toHaveBeenLastCalledWith({ set: { wrapMemo: true } });
  });

  it('follows the store once it changes (our write landed, or another device)', () => {
    const { result, rerender } = renderHook(() => useTransactionTableColumns());
    act(() => result.current.update({ showMemo: false }));
    synced.value = { showPayee: false };
    rerender();
    expect(result.current.columns).toEqual({ showMemo: true, showPayee: false, wrapMemo: false });
  });

  it('keeps a change for the visit when writes are refused (demo)', () => {
    synced.canWrite = false;
    const { result } = renderHook(() => useTransactionTableColumns());
    act(() => result.current.update({ showPayee: false }));
    expect(result.current.columns.showPayee).toBe(false);
    expect(synced.merge).not.toHaveBeenCalled();
  });
});
