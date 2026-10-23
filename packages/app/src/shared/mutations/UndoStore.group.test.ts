import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runUndoGroup, useUndoStore, type UndoItem } from './UndoStore';

const execute = vi.hoisted(() => vi.fn());

vi.mock('@shared/runtime/global', () => ({
  getRuntime: () => ({ mutationsRouter: () => ({ execute }) }),
}));
vi.mock('@shared/mutations/op-code-registry', () => ({
  APPLY_OPS: 'history.applyOps',
  getInvalidatesForOp: () => undefined,
}));

const item = (id: string, undoOp: string, redoOp: string): UndoItem => ({
  id,
  undo: [{ op: undoOp, args: { id } }],
  redo: [{ op: redoOp, args: { id } }],
  ts: 1,
});

// A multi-step undo/redo runs as one atomic history.applyOps; list its steps.
const executedOps = () =>
  execute.mock.calls.flatMap(([spec]) =>
    spec.op === 'history.applyOps'
      ? (spec.payload.ops as { op: string }[]).map((call) => call.op)
      : [spec.op]
  );

beforeEach(() => {
  execute.mockReset();
  execute.mockResolvedValue({ result: undefined });
  useUndoStore.getState().clear();
});

describe('runUndoGroup', () => {
  it('merges the steps into one entry: undo newest first, redo in order', async () => {
    await runUndoGroup('Convert', async () => {
      useUndoStore.getState().push(item('a', 'undo.a', 'redo.a'));
      useUndoStore.getState().push(item('b', 'undo.b', 'redo.b'));
    });

    const { past } = useUndoStore.getState();
    expect(past).toHaveLength(1);
    expect(past[0].label).toBe('Convert');
    expect(past[0].undo.map((call) => call.op)).toEqual(['undo.b', 'undo.a']);
    expect(past[0].redo.map((call) => call.op)).toEqual(['redo.a', 'redo.b']);
  });

  it('reverts the whole action with a single undo, then replays it with a single redo', async () => {
    await runUndoGroup('Convert', async () => {
      useUndoStore.getState().push(item('a', 'undo.a', 'redo.a'));
      useUndoStore.getState().push(item('b', 'undo.b', 'redo.b'));
    });

    await useUndoStore.getState().undo();
    expect(executedOps()).toEqual(['undo.b', 'undo.a']);
    expect(useUndoStore.getState().past).toHaveLength(0);

    execute.mockClear();
    await useUndoStore.getState().redo();
    expect(executedOps()).toEqual(['redo.a', 'redo.b']);
    expect(useUndoStore.getState().past).toHaveLength(1);
  });

  it('returns the work result and records nothing when no step was undoable', async () => {
    await expect(runUndoGroup('Noop', async () => 42)).resolves.toBe(42);
    expect(useUndoStore.getState().past).toHaveLength(0);
  });

  it('undoes the steps that already applied when a later step fails', async () => {
    await expect(
      runUndoGroup('Convert', async () => {
        useUndoStore.getState().push(item('a', 'undo.a', 'redo.a'));
        useUndoStore.getState().push(item('b', 'undo.b', 'redo.b'));
        throw new Error('step failed');
      })
    ).rejects.toThrow('step failed');

    expect(executedOps()).toEqual(['undo.b', 'undo.a']);
    expect(execute.mock.calls.every(([spec]) => spec.meta.skipUndo === true)).toBe(true);
    expect(useUndoStore.getState().past).toHaveLength(0);
  });

  it('still throws the original error when a rollback step fails', async () => {
    execute.mockRejectedValueOnce(new Error('rollback failed'));

    await expect(
      runUndoGroup('Convert', async () => {
        useUndoStore.getState().push(item('a', 'undo.a', 'redo.a'));
        useUndoStore.getState().push(item('b', 'undo.b', 'redo.b'));
        throw new Error('step failed');
      })
    ).rejects.toThrow('step failed');

    // The failed first rollback does not stop the remaining one.
    expect(executedOps()).toEqual(['undo.b', 'undo.a']);
  });

  it('stops capturing after a failure, so later entries are recorded normally', async () => {
    await expect(
      runUndoGroup('Convert', async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');

    useUndoStore.getState().push(item('later', 'undo.later', 'redo.later'));
    expect(useUndoStore.getState().past.map((entry) => entry.id)).toEqual(['later']);
  });

  it('leaves entries pushed outside a group alone', async () => {
    useUndoStore.getState().push(item('before', 'undo.before', 'redo.before'));
    await runUndoGroup('Convert', async () => {
      useUndoStore.getState().push(item('a', 'undo.a', 'redo.a'));
    });

    expect(useUndoStore.getState().past.map((entry) => entry.id)).toEqual(['before', 'a']);
  });

  it('lets a nested group join the outer one', async () => {
    await runUndoGroup('Outer', async () => {
      useUndoStore.getState().push(item('a', 'undo.a', 'redo.a'));
      await runUndoGroup('Inner', async () => {
        useUndoStore.getState().push(item('b', 'undo.b', 'redo.b'));
      });
    });

    const { past } = useUndoStore.getState();
    expect(past).toHaveLength(1);
    expect(past[0].label).toBe('Outer');
    expect(past[0].undo.map((call) => call.op)).toEqual(['undo.b', 'undo.a']);
  });
});
