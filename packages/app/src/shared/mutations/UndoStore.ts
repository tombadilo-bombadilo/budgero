import { create } from 'zustand';
import { getRuntime } from '@shared/runtime/global';
import { getInvalidatesForOp } from '@shared/mutations/op-code-registry';
import type { MutationSpec } from '@shared/runtime/mutation-router';
import type { OpCall } from '@shared/mutations/op-code-registry/shared';

export type { OpCall };

export type UndoItem = {
  id: string;
  label?: string;
  undo: OpCall[];
  redo: OpCall[];
  ts: number;
};

// While a group is open, history entries are collected here instead of being pushed.
let activeGroup: UndoItem[] | null = null;

interface UndoState {
  past: UndoItem[];
  future: UndoItem[];
  isReplaying: boolean;
  push: (item: UndoItem) => void;
  clear: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
}

export const useUndoStore = create<UndoState>((set, get) => ({
  past: [],
  future: [],
  isReplaying: false,

  push: (item) => {
    if (activeGroup) {
      activeGroup.push(item);
      return;
    }
    set((s) => ({
      past: [...s.past, item],
      future: [], // clear redo stack on new action
    }));
  },

  clear: () => set({ past: [], future: [] }),

  canUndo: () => get().past.length > 0,
  canRedo: () => get().future.length > 0,

  undo: async () => {
    const { past, future, isReplaying } = get();
    if (isReplaying || past.length === 0) return;
    const item = past[past.length - 1];
    set({ isReplaying: true });
    try {
      const manager = getRuntime()?.mutationsRouter();
      if (!manager) {
        throw new Error('Runtime mutations router not available');
      }
      for (const call of item.undo) {
        const spec: MutationSpec = {
          op: call.op,
          payload: call.args,
          invalidates: getInvalidatesForOp(call.op),
          meta: { skipUndo: true, forceInvalidate: true },
        };
        await manager.execute(spec);
      }
      set({ past: past.slice(0, -1), future: [...future, item] });
    } catch (error) {
      // Drop the entry so one failed step doesn't block everything older.
      set({ past: past.slice(0, -1) });
      throw error;
    } finally {
      set({ isReplaying: false });
    }
  },

  redo: async () => {
    const { past, future, isReplaying } = get();
    if (isReplaying || future.length === 0) return;
    const item = future[future.length - 1];
    set({ isReplaying: true });
    try {
      const manager = getRuntime()?.mutationsRouter();
      if (!manager) {
        throw new Error('Runtime mutations router not available');
      }
      for (const call of item.redo) {
        const spec: MutationSpec = {
          op: call.op,
          payload: call.args,
          invalidates: getInvalidatesForOp(call.op),
          meta: { skipUndo: true, forceInvalidate: true },
        };
        await manager.execute(spec);
      }
      set({ future: future.slice(0, -1), past: [...past, item] });
    } catch (error) {
      set({ future: future.slice(0, -1) });
      throw error;
    } finally {
      set({ isReplaying: false });
    }
  },
}));

async function replayCalls(calls: OpCall[]): Promise<void> {
  const manager = getRuntime()?.mutationsRouter();
  if (!manager) {
    throw new Error('Runtime mutations router not available');
  }
  for (const call of calls) {
    const spec: MutationSpec = {
      op: call.op,
      payload: call.args,
      invalidates: getInvalidatesForOp(call.op),
      meta: { skipUndo: true, forceInvalidate: true },
    };
    await manager.execute(spec);
  }
}

/**
 * Runs several ordinary mutations as one undoable action. Each mutation still records
 * its own undo/redo as usual; they are merged into a single history entry, so one undo
 * reverts the whole action (newest step first) and one redo replays it in order.
 *
 * If a step throws, the steps that already applied are undone before the error is
 * rethrown, so a failed multi-step action leaves nothing half-done and no entry behind.
 *
 * The group captures every history entry pushed while `work` runs, so await only the
 * action's own mutations inside it. A nested call joins the outer group.
 */
export async function runUndoGroup<T>(label: string, work: () => Promise<T>): Promise<T> {
  if (activeGroup) return work();

  const items: UndoItem[] = [];
  activeGroup = items;
  let result: T;
  try {
    result = await work();
  } catch (error) {
    activeGroup = null;
    for (const item of [...items].reverse()) {
      try {
        await replayCalls(item.undo);
      } catch {
        // Best effort: keep the original failure as the one the caller sees.
      }
    }
    throw error;
  }
  activeGroup = null;

  if (items.length > 0) {
    useUndoStore.getState().push({
      id: items[0].id,
      label,
      undo: [...items].reverse().flatMap((item) => item.undo),
      redo: items.flatMap((item) => item.redo),
      ts: Date.now(),
    });
  }
  return result;
}
