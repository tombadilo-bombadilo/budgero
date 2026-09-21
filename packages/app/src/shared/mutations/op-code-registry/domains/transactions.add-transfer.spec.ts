import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MutationExecutor, type UndoEntry } from '@budgero/runtime';
import {
  executeMutationOp,
  getInvalidatesForOp,
  getUndoSpec,
} from '@shared/mutations/op-code-registry';
import { useUndoStore } from '@shared/mutations/UndoStore';

const transactionMocks = vi.hoisted(() => ({
  addTransaction: vi.fn(),
  deleteTransaction: vi.fn(),
  getTransactionsByTransferID: vi.fn(),
}));
const runtimeMocks = vi.hoisted(() => ({ executeMutation: vi.fn() }));

vi.mock('@shared/runtime/global', () => ({
  getRuntime: () => ({
    services: () => ({ transactions: transactionMocks }),
    mutationsRouter: () => ({ execute: runtimeMocks.executeMutation }),
  }),
}));

const transferPayload = {
  budgetId: 7,
  transferId: 'transfer-123',
  source: {
    inflow: 0,
    outflow: 1_234_567,
    accountId: 10,
    categoryId: 20,
    labelId: 30,
    date: '2026-08-29',
    memo: 'Cross-currency transfer',
    payee: 'Destination account',
    exchangeRateOverride: 0.913_456_789,
  },
  destination: {
    inflow: 48_765_432,
    outflow: 0,
    accountId: 11,
    categoryId: 21,
    labelId: 30,
    date: '2026-08-29',
    memo: 'Cross-currency transfer',
    payee: 'Source account',
    exchangeRateOverride: 0.023_456_789,
  },
};

describe('transactions.addTransfer', () => {
  beforeEach(() => {
    transactionMocks.addTransaction.mockReset();
    transactionMocks.deleteTransaction.mockReset();
    transactionMocks.getTransactionsByTransferID.mockReset().mockResolvedValue([]);
    runtimeMocks.executeMutation.mockReset();
    useUndoStore.getState().clear();
  });

  it('forwards both multi-currency legs unchanged and records one replayable undo item', async () => {
    transactionMocks.addTransaction
      .mockResolvedValueOnce(101)
      .mockResolvedValueOnce(202)
      .mockResolvedValueOnce(303)
      .mockResolvedValueOnce(404)
      .mockResolvedValueOnce(505)
      .mockResolvedValueOnce(606);

    const executor = new MutationExecutor({
      executeOp: executeMutationOp,
      getUndoSpec,
      getInvalidatesForOp,
      getQueryClient: () => undefined,
      pushUndo: (entry: UndoEntry) => useUndoStore.getState().push(entry),
      recordHistory: () => {},
      getActiveSpaceId: () => 'space-1',
      getSpaceRole: () => 'owner',
    });
    runtimeMocks.executeMutation.mockImplementation((spec) => executor.execute(spec));
    transactionMocks.getTransactionsByTransferID
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ ID: 202 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ ID: 404 }])
      .mockResolvedValueOnce([]);

    await executor.execute({ op: 'transactions.addTransfer', payload: transferPayload });

    expect(transactionMocks.addTransaction).toHaveBeenNthCalledWith(
      1,
      0,
      transferPayload.source.outflow,
      transferPayload.source.accountId,
      transferPayload.source.categoryId,
      transferPayload.budgetId,
      transferPayload.source.date,
      transferPayload.source.memo,
      transferPayload.transferId,
      transferPayload.source.payee,
      transferPayload.source.labelId,
      transferPayload.source.exchangeRateOverride
    );
    expect(transactionMocks.addTransaction).toHaveBeenNthCalledWith(
      2,
      transferPayload.destination.inflow,
      0,
      transferPayload.destination.accountId,
      transferPayload.destination.categoryId,
      transferPayload.budgetId,
      transferPayload.destination.date,
      transferPayload.destination.memo,
      transferPayload.transferId,
      transferPayload.destination.payee,
      transferPayload.destination.labelId,
      transferPayload.destination.exchangeRateOverride
    );

    expect(useUndoStore.getState().past).toHaveLength(1);
    const item = useUndoStore.getState().past[0]!;
    expect(item.undo).toEqual([
      {
        op: 'transactions.deleteTransfer',
        args: { transferId: transferPayload.transferId, budgetId: transferPayload.budgetId },
      },
    ]);
    expect(item.redo).toEqual([{ op: 'transactions.addTransfer', args: transferPayload }]);

    await useUndoStore.getState().undo();
    await useUndoStore.getState().redo();
    await useUndoStore.getState().undo();
    await useUndoStore.getState().redo();

    expect(transactionMocks.deleteTransaction).toHaveBeenCalledTimes(2);
    expect(transactionMocks.deleteTransaction.mock.calls).toEqual([[202], [404]]);
    expect(transactionMocks.getTransactionsByTransferID).toHaveBeenCalledTimes(5);
    expect(transactionMocks.getTransactionsByTransferID).toHaveBeenCalledWith(
      transferPayload.transferId
    );
    expect(transactionMocks.addTransaction).toHaveBeenCalledTimes(6);
    expect(transactionMocks.addTransaction.mock.calls.slice(2, 4)).toEqual(
      transactionMocks.addTransaction.mock.calls.slice(0, 2)
    );
    expect(transactionMocks.addTransaction.mock.calls.slice(4, 6)).toEqual(
      transactionMocks.addTransaction.mock.calls.slice(0, 2)
    );
    expect(useUndoStore.getState().past).toHaveLength(1);
    expect(useUndoStore.getState().future).toHaveLength(0);
  });

  it('keeps same-currency source and destination amounts identical', async () => {
    transactionMocks.addTransaction.mockResolvedValueOnce(101).mockResolvedValueOnce(202);
    const sameCurrencyPayload = {
      ...transferPayload,
      source: {
        ...transferPayload.source,
        outflow: 50_000,
        exchangeRateOverride: null,
      },
      destination: {
        ...transferPayload.destination,
        inflow: 50_000,
        exchangeRateOverride: null,
      },
    };

    await executeMutationOp('transactions.addTransfer', sameCurrencyPayload);

    expect(transactionMocks.addTransaction.mock.calls[0]?.[1]).toBe(50_000);
    expect(transactionMocks.addTransaction.mock.calls[1]?.[0]).toBe(50_000);
    expect(transactionMocks.addTransaction.mock.calls[0]?.[10]).toBeNull();
    expect(transactionMocks.addTransaction.mock.calls[1]?.[10]).toBeNull();
  });

  it('removes the source leg if creating the destination leg fails', async () => {
    const failure = new Error('destination insert failed');
    transactionMocks.addTransaction.mockResolvedValueOnce(101).mockRejectedValueOnce(failure);

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(executeMutationOp('transactions.addTransfer', transferPayload)).rejects.toBe(
      failure
    );
    expect(transactionMocks.deleteTransaction).toHaveBeenCalledOnce();
    expect(transactionMocks.deleteTransaction).toHaveBeenCalledWith(101);
    consoleError.mockRestore();
  });
  it('rejects duplicate transfer IDs without inserting or deleting any leg', async () => {
    transactionMocks.getTransactionsByTransferID.mockResolvedValueOnce([{ ID: 99 }]);
    await expect(executeMutationOp('transactions.addTransfer', transferPayload)).rejects.toThrow(
      /already in use/
    );
    expect(transactionMocks.addTransaction).not.toHaveBeenCalled();
    expect(transactionMocks.deleteTransaction).not.toHaveBeenCalled();
  });

  it.each(['', ' ', null, 123])('rejects invalid transfer handles: %j', async (transferId) => {
    await expect(
      executeMutationOp('transactions.addTransfer', { ...transferPayload, transferId })
    ).rejects.toThrow(/transferId/);
    await expect(executeMutationOp('transactions.deleteTransfer', { transferId })).rejects.toThrow(
      /transferId/
    );
    expect(transactionMocks.addTransaction).not.toHaveBeenCalled();
    expect(transactionMocks.deleteTransaction).not.toHaveBeenCalled();
  });

  it('rejects transfers to the same account before writing', async () => {
    await expect(
      executeMutationOp('transactions.addTransfer', {
        ...transferPayload,
        destination: {
          ...transferPayload.destination,
          accountId: transferPayload.source.accountId,
        },
      })
    ).rejects.toThrow(/must differ/);
    expect(transactionMocks.addTransaction).not.toHaveBeenCalled();
  });
});
