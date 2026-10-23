import { describe, expect, it, vi } from 'vitest';
import { MutationExecutor } from './mutation-executor';

function createDeps(capture: () => Promise<unknown>) {
  const build = vi.fn((_args: unknown, _result: unknown, before: unknown) => [
    { op: 'tx.restore', args: { value: (before as { value?: unknown } | undefined)?.value } },
  ]);
  return {
    build,
    deps: {
      executeOp: vi.fn(async () => ({ ok: true })),
      getUndoSpec: vi.fn(() => ({ capture: vi.fn(capture), build })),
      getInvalidatesForOp: vi.fn(() => []),
      getQueryClient: vi.fn(() => undefined),
      pushUndo: vi.fn(),
      recordHistory: vi.fn(),
      getActiveSpaceId: vi.fn(() => 'space-1'),
      getSpaceRole: vi.fn(() => 'owner'),
    },
  };
}

describe('MutationExecutor undo capture', () => {
  it('records no undo when the before-state capture throws', async () => {
    const { deps, build } = createDeps(async () => {
      throw new Error('row is gone');
    });
    const executor = new MutationExecutor(deps as never);

    await executor.execute({ op: 'tx.update', payload: { budgetId: 3 } });

    expect(deps.executeOp).toHaveBeenCalled();
    expect(build).not.toHaveBeenCalled();
    expect(deps.pushUndo).not.toHaveBeenCalled();
    expect(deps.recordHistory).toHaveBeenCalledWith(
      expect.objectContaining({ undoOps: null, redoOps: null })
    );
  });

  it('still records the undo when the capture succeeds', async () => {
    const { deps } = createDeps(async () => ({ value: 'old' }));
    const executor = new MutationExecutor(deps as never);

    await executor.execute({ op: 'tx.update', payload: { budgetId: 3 } });

    expect(deps.pushUndo).toHaveBeenCalledWith(
      expect.objectContaining({ undo: [{ op: 'tx.restore', args: { value: 'old', budgetId: 3 } }] })
    );
  });

  it('records no history row for an undo/redo replay', async () => {
    const { deps } = createDeps(async () => ({ value: 'old' }));
    const executor = new MutationExecutor(deps as never);

    await executor.execute({
      op: 'tx.update',
      payload: { budgetId: 3 },
      meta: { skipUndo: true, replay: 'undo' },
    });

    expect(deps.executeOp).toHaveBeenCalled();
    expect(deps.recordHistory).not.toHaveBeenCalled();
  });
});
