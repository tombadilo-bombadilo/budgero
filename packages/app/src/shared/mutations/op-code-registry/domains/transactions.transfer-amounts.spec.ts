import { beforeEach, describe, expect, it, vi } from 'vitest';
import { executeMutationOp, getUndoSpec } from '@shared/mutations/op-code-registry';

const transactionMocks = vi.hoisted(() => ({
  getTransferRateDetails: vi.fn(),
  updateTransferAmounts: vi.fn(),
  updateTransferRate: vi.fn(),
  captureRestoreSnapshot: vi.fn() as ReturnType<typeof vi.fn> | undefined,
}));

vi.mock('@shared/runtime/global', () => ({
  getRuntime: () => ({ services: () => ({ transactions: transactionMocks }) }),
}));

const details = (reconciled: { source?: boolean; destination?: boolean } = {}) => ({
  transferId: 'transfer-1',
  rate: 0.8,
  transferRateOverride: false,
  hasRateOverride: false,
  hasReconciledLeg: Boolean(reconciled.source || reconciled.destination),
  source: {
    transactionId: 11,
    amount: 10_000,
    rateOverride: false,
    reconciled: Boolean(reconciled.source),
  },
  destination: {
    transactionId: 12,
    amount: 8_000,
    rateOverride: true,
    reconciled: Boolean(reconciled.destination),
  },
});

/** Both legs as captured before the edit, with their status. */
const snapshot = {
  version: 1,
  transactions: [
    { ID: 11, OutflowNative: 10_000, Reconciled: 1, Cleared: 1 },
    { ID: 12, InflowNative: 8_000, Reconciled: 0, Cleared: 1 },
  ],
  dependents: [],
  links: [],
};

describe('transactions.updateTransferAmounts', () => {
  beforeEach(() => {
    transactionMocks.getTransferRateDetails.mockReset();
    transactionMocks.updateTransferAmounts.mockReset().mockResolvedValue(undefined);
    transactionMocks.captureRestoreSnapshot = vi.fn().mockReturnValue(snapshot);
  });

  it('forwards both amounts; undo puts both legs back exactly, status included', async () => {
    transactionMocks.getTransferRateDetails.mockResolvedValue(details({ source: true }));
    const args = { transferId: 'transfer-1', sentAmount: 12_000, receivedAmount: 9_000 };

    const undo = getUndoSpec('transactions.updateTransferAmounts');
    const before = await undo?.capture?.(args);
    await executeMutationOp('transactions.updateTransferAmounts', args);
    const inverse = undo?.build(args, undefined, before);

    expect(transactionMocks.updateTransferAmounts).toHaveBeenCalledWith(
      'transfer-1',
      12_000,
      9_000,
      undefined,
      undefined
    );
    expect(transactionMocks.captureRestoreSnapshot).toHaveBeenCalledWith([11]);
    expect(inverse).toEqual([{ op: 'transactions.restore', args: { snapshot, replace: true } }]);
  });

  it('rejects decimal amounts at the op boundary', async () => {
    await expect(
      executeMutationOp('transactions.updateTransferAmounts', {
        transferId: 'transfer-1',
        sentAmount: 12.5,
        receivedAmount: 9_000,
      })
    ).rejects.toThrow(/integer milliunit/);
    expect(transactionMocks.updateTransferAmounts).not.toHaveBeenCalled();
  });

  it('without an exact snapshot, undo writes the previous amounts and overrides back', async () => {
    transactionMocks.captureRestoreSnapshot = undefined;
    transactionMocks.getTransferRateDetails.mockResolvedValue(details());
    const args = { transferId: 'transfer-1', sentAmount: 12_000, receivedAmount: 9_000 };

    const undo = getUndoSpec('transactions.updateTransferAmounts');
    const before = await undo?.capture?.(args);

    expect(undo?.build(args, undefined, before)).toEqual([
      {
        op: 'transactions.updateTransferAmounts',
        args: {
          transferId: 'transfer-1',
          sentAmount: 10_000,
          receivedAmount: 8_000,
          sourceRateOverride: false,
          destinationRateOverride: true,
        },
      },
    ]);
  });
});

describe('transactions.updateTransferRate with a reconciled leg', () => {
  beforeEach(() => {
    transactionMocks.getTransferRateDetails.mockReset();
    transactionMocks.updateTransferRate.mockReset().mockResolvedValue(undefined);
    transactionMocks.captureRestoreSnapshot = vi.fn().mockReturnValue(snapshot);
  });

  it('undo restores both legs exactly (the new rate can unlock the received leg)', async () => {
    transactionMocks.getTransferRateDetails.mockResolvedValue(details({ destination: true }));
    const args = { transferId: 'transfer-1', rate: 0.9, transferRateOverride: true };

    const undo = getUndoSpec('transactions.updateTransferRate');
    const before = await undo?.capture?.(args);

    expect(undo?.build(args, undefined, before)).toEqual([
      { op: 'transactions.restore', args: { snapshot, replace: true } },
    ]);
  });

  it('without a reconciled leg, undo still writes the previous rate back', async () => {
    transactionMocks.getTransferRateDetails.mockResolvedValue(details());
    const args = { transferId: 'transfer-1', rate: 0.9, transferRateOverride: true };

    const undo = getUndoSpec('transactions.updateTransferRate');
    const before = await undo?.capture?.(args);

    expect(transactionMocks.captureRestoreSnapshot).not.toHaveBeenCalled();
    expect(undo?.build(args, undefined, before)).toEqual([
      {
        op: 'transactions.updateTransferRate',
        args: {
          transferId: 'transfer-1',
          rate: 0.8,
          transferRateOverride: false,
          sourceRateOverride: false,
          destinationRateOverride: true,
        },
      },
    ]);
  });
});
