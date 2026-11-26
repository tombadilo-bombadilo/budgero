import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TRANSACTION_SORT_KEY, useTransactionSort } from './useTransactionSort';

const synced = vi.hoisted(() => ({
  value: undefined as Record<string, unknown> | undefined,
  available: true,
  canWrite: true,
  merge: vi.fn(async () => true),
  scope: null as string | null,
}));

vi.mock('@entities/user/api/useAuth', () => ({
  useProfile: () => ({ data: { id: 'u1' } }),
}));

vi.mock('@shared/lib/synced-state', () => ({
  userScope: (id: string) => `user:${id}`,
  useSyncedState: (scope: string | null) => {
    synced.scope = scope;
    return {
      value: synced.value,
      loaded: true,
      available: synced.available,
      canWrite: synced.canWrite,
      set: vi.fn(),
      merge: synced.merge,
    };
  },
}));

describe('useTransactionSort', () => {
  beforeEach(() => {
    synced.value = undefined;
    synced.available = true;
    synced.canWrite = true;
    synced.merge.mockClear();
  });

  it('reads the stored sort of this register from the user scope', () => {
    synced.value = {
      'account:7': { column: 'amount', direction: 'desc' },
      'all:1': { column: 'payee', direction: 'asc' },
    };
    const { result } = renderHook(() => useTransactionSort('account:7'));
    expect(TRANSACTION_SORT_KEY).toBe('transactionSort');
    expect(synced.scope).toBe('user:u1');
    expect(result.current.sort).toEqual({ column: 'amount', direction: 'desc' });
  });

  it('ignores a stored sort it does not understand', () => {
    synced.value = { 'all:1': { column: 'balance', direction: 'asc' } };
    const { result } = renderHook(() => useTransactionSort('all:1'));
    expect(result.current.sort).toBeNull();
  });

  it('shows a change at once and writes only this register entry', () => {
    const { result } = renderHook(() => useTransactionSort('all:1'));
    act(() => result.current.setSort({ column: 'memo', direction: 'asc' }));
    expect(result.current.sort).toEqual({ column: 'memo', direction: 'asc' });
    expect(synced.merge).toHaveBeenCalledWith({
      set: { 'all:1': { column: 'memo', direction: 'asc' } },
    });
  });

  it('removes the entry when going back to the default order', () => {
    synced.value = { 'all:1': { column: 'memo', direction: 'desc' } };
    const { result } = renderHook(() => useTransactionSort('all:1'));
    act(() => result.current.setSort(null));
    expect(result.current.sort).toBeNull();
    expect(synced.merge).toHaveBeenCalledWith({ remove: ['all:1'] });
  });

  it('keeps the sort for the visit when writes are refused (demo)', () => {
    synced.canWrite = false;
    const { result } = renderHook(() => useTransactionSort('all:1'));
    act(() => result.current.setSort({ column: 'date', direction: 'asc' }));
    expect(result.current.sort).toEqual({ column: 'date', direction: 'asc' });
    expect(synced.merge).not.toHaveBeenCalled();
  });

  it('keeps registers apart', () => {
    const { result, rerender } = renderHook(({ key }) => useTransactionSort(key), {
      initialProps: { key: 'account:1' },
    });
    act(() => result.current.setSort({ column: 'payee', direction: 'asc' }));
    rerender({ key: 'account:2' });
    expect(result.current.sort).toBeNull();
  });

  it('follows the store once it moves (write landed, or another device)', () => {
    const { result, rerender } = renderHook(() => useTransactionSort('all:1'));
    act(() => result.current.setSort({ column: 'memo', direction: 'asc' }));
    synced.value = { 'all:1': { column: 'amount', direction: 'desc' } };
    rerender();
    expect(result.current.sort).toEqual({ column: 'amount', direction: 'desc' });
  });
});
