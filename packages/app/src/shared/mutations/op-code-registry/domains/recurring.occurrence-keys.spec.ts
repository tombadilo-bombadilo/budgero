import { beforeEach, describe, expect, it, vi } from 'vitest';
import { executeMutationOp, getUndoSpec } from '@shared/mutations/op-code-registry';

const mocks = vi.hoisted(() => ({
  recurring: {
    markOccurrenceReady: vi.fn(),
    skipOccurrence: vi.fn(),
    markOccurrenceNotified: vi.fn(),
    resetOccurrence: vi.fn(),
    resolveOccurrenceId: vi.fn(),
    getOccurrenceWithTemplate: vi.fn(),
  },
}));

vi.mock('@shared/runtime/global', () => ({
  getRuntime: () => ({
    services: () => mocks,
    mutationsRouter: () => ({ execute: vi.fn() }),
  }),
}));

const key = { recurringTransactionId: 3, dueDate: '2026-11-01' };

async function undoFor(op: string, args: Record<string, unknown>, result?: unknown) {
  const spec = getUndoSpec(op)!;
  return spec.build(args, result, await spec.capture?.(args));
}

describe('recurring occurrence ops carry the (template, due date) key', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('hands keyed and legacy refs to the core', async () => {
    await executeMutationOp('recurring.skip', { id: 44, ...key });
    expect(mocks.recurring.skipOccurrence).toHaveBeenCalledWith({ occurrenceId: 44, ...key });

    await executeMutationOp('recurring.skip', { id: 44 });
    expect(mocks.recurring.skipOccurrence).toHaveBeenLastCalledWith({
      occurrenceId: 44,
      recurringTransactionId: undefined,
      dueDate: undefined,
    });

    await executeMutationOp('recurring.markNotified', { id: 44, ...key });
    expect(mocks.recurring.markOccurrenceNotified).toHaveBeenCalledWith({
      occurrenceId: 44,
      ...key,
    });

    await executeMutationOp('recurring.resetOccurrence', { id: 44, ...key });
    expect(mocks.recurring.resetOccurrence).toHaveBeenCalledWith({ occurrenceId: 44, ...key });

    const options = { occurrenceId: 44, ...key, transactionDate: '2026-11-02' };
    await executeMutationOp('recurring.markReady', { options });
    expect(mocks.recurring.markOccurrenceReady).toHaveBeenCalledWith(options);
  });

  it('markReady undo resets the occurrence by key, even for a legacy op', async () => {
    const result = {
      transactionId: 91,
      occurrence: { id: 44, recurringTransactionId: 3, dueDate: '2026-11-01' },
    };
    expect(await undoFor('recurring.markReady', { options: { occurrenceId: 44 } }, result)).toEqual(
      [
        { op: 'transactions.delete', args: { id: 91 } },
        { op: 'recurring.resetOccurrence', args: { id: 44, ...key } },
      ]
    );
  });

  it('skip undo keeps the key', async () => {
    expect(await undoFor('recurring.skip', { id: 44, ...key })).toEqual([
      { op: 'recurring.resetOccurrence', args: { id: 44, ...key } },
    ]);
    expect(
      await undoFor(
        'recurring.skip',
        { id: 44 },
        { id: 44, recurringTransactionId: 3, dueDate: key.dueDate }
      )
    ).toEqual([{ op: 'recurring.resetOccurrence', args: { id: 44, ...key } }]);
  });
});
