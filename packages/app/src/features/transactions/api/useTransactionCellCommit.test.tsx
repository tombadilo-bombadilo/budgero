import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useTransactionCellCommit } from './useTransactionCellCommit';

const mocks = vi.hoisted(() => ({ mutate: vi.fn(), toastError: vi.fn() }));

vi.mock('@entities/transaction/api/useTransactions', () => ({
  useUpdateTransactionColumn: () => ({ mutate: mocks.mutate, mutateAsync: vi.fn() }),
}));
vi.mock('@shared/lib/errors', () => ({ toastError: mocks.toastError }));

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
});
