import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useTransactionCellCommit } from './useTransactionCellCommit';
import { useReconciledEditConfirmStore } from '../ui/reconciled-edit/reconciled-edit-confirm';

const mocks = vi.hoisted(() => ({
  mutate: vi.fn(),
  mutateAsync: vi.fn(),
  toastError: vi.fn(),
  unlocked: [] as number[],
}));

vi.mock('@entities/transaction/api/useTransactions', () => ({
  useUpdateTransactionColumn: () => ({ mutate: mocks.mutate, mutateAsync: mocks.mutateAsync }),
}));
vi.mock('@shared/lib/errors', () => ({ toastError: mocks.toastError }));
vi.mock('@shared/runtime/global', () => ({
  getRuntime: () => ({
    services: () => ({
      transactions: { reconciledRowsUnlockedByEdit: () => mocks.unlocked },
    }),
  }),
}));

describe('useTransactionCellCommit', () => {
  it('says why an account move was refused', () => {
    const { result } = renderHook(() => useTransactionCellCommit());
    result.current.mutate(10, 'AccountID', 2, { accountId: 1 });
    const [, options] = mocks.mutate.mock.calls[0];
    const error = new Error("A split line can't transfer to the transaction's own account.");
    options.onError(error);
    expect(mocks.toastError).toHaveBeenCalledWith('Could not move the transaction', error);
  });

  it('leaves other columns to their callers', () => {
    const { result } = renderHook(() => useTransactionCellCommit());
    result.current.mutate(10, 'Memo', 'x', { accountId: 1 });
    expect(mocks.mutate.mock.calls.at(-1)?.[1]).toBeUndefined();
  });

  it('asks before an amount edit that unlocks a reconciled row; cancel saves nothing', async () => {
    mocks.unlocked = [10];
    mocks.mutate.mockClear();
    const { result } = renderHook(() => useTransactionCellCommit());

    let patch: unknown;
    act(() => {
      patch = result.current.mutate(10, 'OutflowConverted', 2000, { accountId: 1 });
    });
    expect(patch).toBeNull();
    expect(useReconciledEditConfirmStore.getState().pending?.kind).toBe('row');
    await act(async () => useReconciledEditConfirmStore.getState().settle(false));
    expect(mocks.mutate).not.toHaveBeenCalled();

    act(() => {
      result.current.mutate(10, 'OutflowConverted', 2000, { accountId: 1 });
    });
    await act(async () => useReconciledEditConfirmStore.getState().settle(true));
    expect(mocks.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ transactionId: 10, column: 'OutflowConverted', value: 2000 }),
      undefined
    );
  });

  it('saves straight away when no reconciled row is affected', async () => {
    mocks.unlocked = [];
    mocks.mutateAsync.mockClear();
    const { result } = renderHook(() => useTransactionCellCommit());
    await act(() => result.current.mutateAsync(10, 'OutflowConverted', 2000, { accountId: 1 }));
    expect(useReconciledEditConfirmStore.getState().pending).toBeNull();
    expect(mocks.mutateAsync).toHaveBeenCalledTimes(1);
  });
});
