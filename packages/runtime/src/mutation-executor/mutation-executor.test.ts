import { describe, expect, it, vi } from 'vitest';
import { MutationExecutor } from './mutation-executor';

function createDeps() {
  const invalidateQueries = vi.fn(async () => undefined);
  return {
    deps: {
      executeOp: vi.fn(async () => ({ ok: true })),
      getUndoSpec: vi.fn(() => ({
        capture: vi.fn(async () => ({ before: 1 })),
        build: vi.fn(() => [{ op: 'undo.x', args: { id: 1 } }]),
      })),
      getInvalidatesForOp: vi.fn(() => [['budgets'], ['space', 'other', 'stats']]),
      getQueryClient: vi.fn(() => ({ invalidateQueries })),
      pushUndo: vi.fn(),
      recordHistory: vi.fn(),
      resolveHistoryBudgetId: vi.fn(() => null),
      getActiveSpaceId: vi.fn(() => 'space-1'),
      getSpaceRole: vi.fn(() => 'owner'),
      onAnalyticsEvent: vi.fn(),
    },
    invalidateQueries,
  };
}

describe('MutationExecutor', () => {
  it('executes local mutation with undo/history/analytics', async () => {
    const { deps } = createDeps();
    const executor = new MutationExecutor(deps as never);

    const result = await executor.execute({
      op: 'budgets.create',
      payload: { budgetId: 12 },
      meta: { label: 'Create budget' },
    });

    expect(result.isReceiver).toBe(false);
    expect(deps.pushUndo).toHaveBeenCalled();
    expect(deps.recordHistory).toHaveBeenCalledWith(
      expect.objectContaining({ budgetId: 12, origin: 'local' })
    );
    expect(deps.onAnalyticsEvent).toHaveBeenCalledWith('budgets.create');
  });

  it('executes receiver mutation and invalidates mapped keys', async () => {
    const { deps, invalidateQueries } = createDeps();
    const executor = new MutationExecutor(deps as never);

    const result = await executor.execute({
      op: 'budgets.update',
      payload: { budget_id: 2 },
      mutationId: 'server-id',
    });

    expect(result.isReceiver).toBe(true);
    expect(deps.pushUndo).not.toHaveBeenCalled();
    expect(invalidateQueries).toHaveBeenCalled();
  });

  it('invalidates local mutations from the op invalidation map (single source of truth)', async () => {
    const { deps, invalidateQueries } = createDeps();
    const executor = new MutationExecutor(deps as never);

    // No mutationId → local mutator; no explicit invalidates on the spec.
    const result = await executor.execute({
      op: 'budgets.update',
      payload: { budget_id: 2 },
    });

    expect(result.isReceiver).toBe(false);
    expect(deps.getInvalidatesForOp).toHaveBeenCalledWith('budgets.update');
    expect(invalidateQueries).toHaveBeenCalled();
  });

  it('honors meta.skipInvalidate to opt a mutation out of invalidation', async () => {
    const { deps, invalidateQueries } = createDeps();
    const executor = new MutationExecutor(deps as never);

    await executor.execute({
      op: 'budgets.update',
      payload: { budget_id: 2 },
      meta: { skipInvalidate: true },
    });

    expect(invalidateQueries).not.toHaveBeenCalled();
  });

  it('rejects budget edits for non-owner local mutators', async () => {
    const { deps } = createDeps();
    deps.getSpaceRole.mockReturnValue('viewer');
    const executor = new MutationExecutor(deps as never);

    await expect(
      executor.execute({
        op: 'budgets.update',
        payload: { budgetId: 2 },
      })
    ).rejects.toThrow('Only the workspace owner');
  });

  it('handles forced invalidation for local mutation and wildcard keys', async () => {
    const { deps, invalidateQueries } = createDeps();
    deps.getInvalidatesForOp.mockReturnValue(undefined);
    const executor = new MutationExecutor(deps as never);

    await executor.execute({
      op: 'tx.create',
      payload: { budget_id: 1 },
      invalidates: [['transactions', '*']],
      meta: { forceInvalidate: true },
    });

    expect(invalidateQueries).toHaveBeenCalled();
  });

  it('throws on invalid spec or missing active space', async () => {
    const { deps } = createDeps();
    const executor = new MutationExecutor(deps as never);

    await expect(executor.execute({} as never)).rejects.toThrow('Invalid spec');

    deps.getActiveSpaceId.mockReturnValue(null);
    await expect(
      executor.execute({
        op: 'tx.create',
        payload: {},
      })
    ).rejects.toThrow('No active budget space');
  });

  it('swallows undo/history errors', async () => {
    const { deps } = createDeps();
    deps.getUndoSpec.mockReturnValue({
      capture: vi.fn(async () => {
        throw new Error('capture failed');
      }),
      build: vi.fn(() => {
        throw new Error('build failed');
      }),
    });
    deps.recordHistory.mockImplementation(() => {
      throw new Error('history failed');
    });

    const executor = new MutationExecutor(deps as never);
    const out = await executor.execute({
      op: 'tx.create',
      payload: { budget_id: 7 },
    });

    expect(out.result).toEqual({ ok: true });
  });

  it('covers invalidation helper branches and analytics failure path', async () => {
    const { deps, invalidateQueries } = createDeps();
    deps.onAnalyticsEvent.mockImplementation(() => {
      throw new Error('analytics failed');
    });
    deps.getInvalidatesForOp.mockReturnValue([
      [],
      ['space', 'space-1', 'stats'],
      ['transactions', '*'],
      ['space', 'other', 'totals'],
      ['space:space-1', 'view'],
    ]);
    const executor = new MutationExecutor(deps as never);

    await executor.execute({
      op: 'tx.update',
      payload: { BudgetID: 9 },
      mutationId: 'receiver',
    });

    expect(invalidateQueries).toHaveBeenCalled();
    expect(deps.recordHistory).toHaveBeenCalledWith(
      expect.objectContaining({ budgetId: 9, origin: 'remote' })
    );
  });

  it('covers query client missing and keysEqual helper paths', async () => {
    const { deps } = createDeps();
    deps.getQueryClient.mockReturnValue(null);
    const executor = new MutationExecutor(deps as never);

    await expect(
      executor.execute({
        op: 'tx.create',
        payload: { budget_id: 4 },
        invalidates: [['budgets']],
        mutationId: 'receiver',
      })
    ).resolves.toEqual(expect.objectContaining({ isReceiver: true }));

    expect(
      (
        executor as unknown as {
          keysEqual: (a: string[], b: string[]) => boolean;
        }
      ).keysEqual(['a'], ['a'])
    ).toBe(true);
  });

  it('resolves history budget id via injected resolver and enriches undo/redo ops', async () => {
    const { deps } = createDeps();
    deps.resolveHistoryBudgetId = vi.fn(() => 77);
    deps.getUndoSpec.mockReturnValue({
      capture: vi.fn(async () => ({ oldValue: 'x' })),
      build: vi.fn(() => [{ op: 'transactions.delete', args: { id: 10 } }]),
    });
    const executor = new MutationExecutor(deps as never);

    await executor.execute({
      op: 'transactions.updateColumn',
      payload: { id: 10, columnName: 'memo', newValue: 'next' },
    });

    expect(deps.resolveHistoryBudgetId).toHaveBeenCalled();
    expect(deps.recordHistory).toHaveBeenCalledWith(
      expect.objectContaining({
        budgetId: 77,
        undoOps: [{ op: 'transactions.delete', args: { id: 10, budgetId: 77 } }],
        redoOps: [
          {
            op: 'transactions.updateColumn',
            args: { id: 10, columnName: 'memo', newValue: 'next', budgetId: 77 },
          },
        ],
      })
    );
    expect(deps.pushUndo).toHaveBeenCalledWith(
      expect.objectContaining({
        undo: [{ op: 'transactions.delete', args: { id: 10, budgetId: 77 } }],
        redo: [
          {
            op: 'transactions.updateColumn',
            args: { id: 10, columnName: 'memo', newValue: 'next', budgetId: 77 },
          },
        ],
      })
    );
  });

  it('records budgets.create history from numeric result when payload has no budget id', async () => {
    const { deps } = createDeps();
    deps.executeOp.mockResolvedValue(91);
    deps.getUndoSpec.mockReturnValue(undefined);
    const executor = new MutationExecutor(deps as never);

    await executor.execute({
      op: 'budgets.create',
      payload: { name: 'My Budget' },
    });

    expect(deps.recordHistory).toHaveBeenCalledWith(expect.objectContaining({ budgetId: 91 }));
  });
});
