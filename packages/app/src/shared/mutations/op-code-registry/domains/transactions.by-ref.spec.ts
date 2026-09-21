import { beforeEach, describe, expect, it, vi } from 'vitest';
import { executeMutationOp } from '@shared/mutations/op-code-registry';

const transactionMocks = vi.hoisted(() => ({
  updatePushedTransaction: vi.fn(),
  deleteTransaction: vi.fn(),
  getTransactionByID: vi.fn(),
}));
const importMocks = vi.hoisted(() => ({
  findOperation: vi.fn(),
}));

vi.mock('@shared/runtime/global', () => ({
  getRuntime: () => ({
    services: () => ({
      transactions: transactionMocks,
      importHistory: { duplicates: importMocks },
    }),
    mutationsRouter: () => ({ execute: vi.fn() }),
  }),
}));

describe('transactions.updateByRef / deleteByRef (Push API v2)', () => {
  beforeEach(() => {
    transactionMocks.updatePushedTransaction.mockReset().mockResolvedValue(['outflow', 'memo']);
    transactionMocks.deleteTransaction.mockReset().mockResolvedValue(undefined);
    transactionMocks.getTransactionByID.mockReset().mockReturnValue({ ID: 42 });
    importMocks.findOperation.mockReset();
  });

  it('updateByRef resolves push:<message_id> and updates each allowed field', async () => {
    importMocks.findOperation.mockReturnValue(42);
    const result = await executeMutationOp('transactions.updateByRef', {
      messageId: 'abc-123',
      fields: { outflow: 9990, memo: 'fixed' },
    });
    expect(importMocks.findOperation).toHaveBeenCalledWith('push:abc-123');
    expect(transactionMocks.updatePushedTransaction).toHaveBeenCalledExactlyOnceWith(42, {
      outflow: 9990,
      memo: 'fixed',
    });
    expect(result).toEqual({ transactionId: 42, updated: ['outflow', 'memo'] });
  });

  it('updateByRef with an unknown ref fails with a speaking error', async () => {
    importMocks.findOperation.mockReturnValue(undefined);
    await expect(
      executeMutationOp('transactions.updateByRef', { messageId: 'ghost', fields: { memo: 'x' } })
    ).rejects.toThrow(/No transaction found for push message_id "ghost"/);
  });

  it('rejects malformed fields before invoking the service', async () => {
    importMocks.findOperation.mockReturnValue(42);
    await expect(
      executeMutationOp('transactions.updateByRef', {
        messageId: 'abc',
        fields: [],
      })
    ).rejects.toThrow(/must be an object/);
    expect(transactionMocks.updatePushedTransaction).not.toHaveBeenCalled();
  });

  it('deleteByRef resolves the ref and truly deletes', async () => {
    importMocks.findOperation.mockReturnValue(42);
    const result = await executeMutationOp('transactions.deleteByRef', { messageId: 'abc-123' });
    expect(transactionMocks.deleteTransaction).toHaveBeenCalledWith(42);
    expect(result).toEqual({ transactionId: 42, deleted: true });
  });

  it('deleteByRef is idempotent after provenance has been cascade-deleted', async () => {
    importMocks.findOperation.mockReturnValue(undefined);
    const result = await executeMutationOp('transactions.deleteByRef', { messageId: 'abc-123' });
    expect(transactionMocks.deleteTransaction).not.toHaveBeenCalled();
    expect(result).toEqual({ deleted: false });
  });

  it('both ops require messageId', async () => {
    await expect(
      executeMutationOp('transactions.updateByRef', { fields: { memo: 'x' } })
    ).rejects.toThrow(/"messageId" is required/);
    await expect(executeMutationOp('transactions.deleteByRef', {})).rejects.toThrow(
      /"messageId" is required/
    );
  });
});
