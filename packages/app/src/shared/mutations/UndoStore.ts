import { create } from 'zustand';
import { getRuntime } from '@shared/runtime/global';
import { APPLY_OPS, getInvalidatesForOp } from '@shared/mutations/op-code-registry';
import type { MutationSpec } from '@shared/runtime/mutation-router';
import type { OpCall } from '@shared/mutations/op-code-registry/shared';

export type { OpCall };

export type UndoItem = {
  id: string;
  label?: string;
  undo: OpCall[];
  redo: OpCall[];
  ts: number;
  /**
   * Mutation ids this entry reverses (history rows to mark undone/redone).
   * Absent for a single mutation, where it is `id`.
   */
  mutationIds?: string[];
};

export type ReplayDirection = 'undo' | 'redo';

const HISTORY_KEYS: string[][] = [['mutationHistory'], ['mutationHistoryCount']];

/**
 * Run the ops of one undo/redo entry as ONE mutation: a single op as itself,
 * several as `history.applyOps`, which reverts the steps it already applied
 * when a later one fails. So an entry applies completely or not at all, and
 * only a complete one is synced.
 */
export async function applyReplayOps(
  ops: OpCall[],
  direction: ReplayDirection,
  label?: string
): Promise<void> {
  const router = getRuntime()?.mutationsRouter();
  if (!router) {
    throw new Error('Runtime mutations router not available');
  }
  if (ops.length === 0) return;
  const [single] = ops;
  const call: OpCall = ops.length === 1 && single ? single : { op: APPLY_OPS, args: { ops } };
  const spec: MutationSpec = {
    op: call.op,
    payload: call.args,
    invalidates: [...(getInvalidatesForOp(call.op, call.args) ?? []), ...HISTORY_KEYS],
    meta: { skipUndo: true, forceInvalidate: true, replay: direction, label },
  };
  await router.execute(spec);
}

/** Mark the history rows of an entry undone (or redone). Best effort. */
export function markHistory(mutationIds: string[], direction: ReplayDirection): void {
  try {
    const history = getRuntime()?.services?.()?.mutationHistory;
    if (!history) return;
    for (const mutationId of mutationIds) {
      if (direction === 'undo') history.markUndone(mutationId);
      else history.markRedone(mutationId);
    }
  } catch (error) {
    console.warn('[UndoStore] Failed to update mutation history', error);
  }
}

export function undoItemMutationIds(item: UndoItem): string[] {
  return item.mutationIds?.length ? item.mutationIds : [item.id];
}

/** Ops of `next` run after `prev`'s, so they are undone first. */
function mergeItems(prev: UndoItem, next: UndoItem): UndoItem {
  return {
    ...prev,
    undo: [...next.undo, ...prev.undo],
    redo: [...prev.redo, ...next.redo],
    mutationIds: [...undoItemMutationIds(prev), ...undoItemMutationIds(next)],
  };
}

interface FailedReplay {
  item: UndoItem;
  direction: ReplayDirection;
}

interface UndoState {
  past: UndoItem[];
  future: UndoItem[];
  isReplaying: boolean;
  /**
   * The last entry whose undo/redo failed. Nothing of it was applied (see
   * applyReplayOps), so it can be retried; any new action discards it.
   */
  failed: FailedReplay | null;
  /** Open undo groups (see runInUndoGroup) and the entry they collect into. */
  groupDepth: number;
  groupItemId: string | null;
  push: (item: UndoItem) => void;
  clear: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  /** Undo the newest entry; resolves with it (undefined when nothing ran). */
  undo: () => Promise<UndoItem | undefined>;
  redo: () => Promise<UndoItem | undefined>;
  /**
   * Undo a specific entry (e.g. from its toast). Only the newest entry can be
   * undone: an older one's inverse may overwrite later changes.
   */
  undoItem: (id: string) => Promise<UndoItem>;
  redoItem: (id: string) => Promise<UndoItem>;
  /** Retry the failed undo/redo (only while nothing else happened since). */
  retryFailed: () => Promise<UndoItem | undefined>;
  /** Drop an entry that was reverted elsewhere (Audit Log). */
  remove: (id: string) => void;
  beginGroup: () => void;
  endGroup: () => void;
}

export class UndoNotAvailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UndoNotAvailableError';
  }
}

export const useUndoStore = create<UndoState>((set, get) => {
  const replay = async (
    item: UndoItem,
    direction: ReplayDirection,
    stack: 'past' | 'future'
  ): Promise<UndoItem> => {
    set({ isReplaying: true });
    try {
      await applyReplayOps(direction === 'undo' ? item.undo : item.redo, direction, item.label);
    } catch (error) {
      // The entry was not applied (applyReplayOps is all-or-nothing). Take it
      // off the stack so it doesn't block older entries, but keep it for retry.
      set((s) => ({
        [stack]: s[stack].filter((entry) => entry !== item),
        failed: { item, direction },
      }));
      throw error;
    } finally {
      set({ isReplaying: false });
    }
    markHistory(undoItemMutationIds(item), direction);
    set((s) =>
      direction === 'undo'
        ? {
            past: s.past.filter((entry) => entry !== item),
            future: [...s.future, item],
            failed: null,
          }
        : {
            future: s.future.filter((entry) => entry !== item),
            past: [...s.past, item],
            failed: null,
          }
    );
    return item;
  };

  return {
    past: [],
    future: [],
    isReplaying: false,
    failed: null,
    groupDepth: 0,
    groupItemId: null,

    push: (item) =>
      set((s) => {
        const top = s.past[s.past.length - 1];
        if (s.groupDepth > 0 && s.groupItemId && top?.id === s.groupItemId) {
          return {
            past: [...s.past.slice(0, -1), mergeItems(top, item)],
            future: [],
            failed: null,
          };
        }
        return {
          past: [...s.past, item],
          future: [], // clear redo stack on new action
          failed: null,
          groupItemId: s.groupDepth > 0 ? item.id : s.groupItemId,
        };
      }),

    clear: () => set({ past: [], future: [], failed: null }),

    canUndo: () => get().past.length > 0,
    canRedo: () => get().future.length > 0,

    undo: async () => {
      const { past, isReplaying } = get();
      const item = past[past.length - 1];
      if (isReplaying || !item) return undefined;
      return replay(item, 'undo', 'past');
    },

    redo: async () => {
      const { future, isReplaying } = get();
      const item = future[future.length - 1];
      if (isReplaying || !item) return undefined;
      return replay(item, 'redo', 'future');
    },

    undoItem: async (id) => {
      const { past, isReplaying } = get();
      const item = past[past.length - 1];
      if (isReplaying) throw new UndoNotAvailableError('Another undo is in progress.');
      if (!item || item.id !== id) {
        throw new UndoNotAvailableError(
          past.some((entry) => entry.id === id)
            ? 'Newer changes were made since. Undo them first.'
            : 'This action can no longer be undone.'
        );
      }
      return replay(item, 'undo', 'past');
    },

    redoItem: async (id) => {
      const { future, isReplaying } = get();
      const item = future[future.length - 1];
      if (isReplaying) throw new UndoNotAvailableError('Another undo is in progress.');
      if (!item || item.id !== id) {
        throw new UndoNotAvailableError('This action can no longer be redone.');
      }
      return replay(item, 'redo', 'future');
    },

    retryFailed: async () => {
      const { failed, isReplaying } = get();
      if (isReplaying || !failed) return undefined;
      // Put it back where it was, then replay it as usual.
      set((s) =>
        failed.direction === 'undo'
          ? { past: [...s.past, failed.item], failed: null }
          : { future: [...s.future, failed.item], failed: null }
      );
      return replay(failed.item, failed.direction, failed.direction === 'undo' ? 'past' : 'future');
    },

    remove: (id) =>
      set((s) => ({
        past: s.past.filter((entry) => !undoItemMutationIds(entry).includes(id)),
        future: s.future.filter((entry) => !undoItemMutationIds(entry).includes(id)),
      })),

    beginGroup: () =>
      set((s) => ({
        groupDepth: s.groupDepth + 1,
        groupItemId: s.groupDepth === 0 ? null : s.groupItemId,
      })),

    endGroup: () =>
      set((s) => {
        const groupDepth = Math.max(0, s.groupDepth - 1);
        return { groupDepth, groupItemId: groupDepth === 0 ? null : s.groupItemId };
      }),
  };
});

/**
 * Run `fn` so every undo entry its mutations push becomes ONE entry: one
 * Ctrl+Z reverts the whole user action (an import, a bank review), applied
 * atomically by applyReplayOps.
 */
export async function runInUndoGroup<T>(fn: () => Promise<T>): Promise<T> {
  const store = useUndoStore.getState();
  store.beginGroup();
  try {
    return await fn();
  } finally {
    useUndoStore.getState().endGroup();
  }
}

/** Id of the newest undo entry, to target it later with undoItem. */
export function latestUndoId(): string | undefined {
  const { past } = useUndoStore.getState();
  return past[past.length - 1]?.id;
}

/**
 * Runs several mutations as one undoable action named `label` (see
 * runInUndoGroup). If a step throws, the steps that already applied are undone
 * and their entry dropped before the error is rethrown, so a failed action
 * leaves nothing half-done. A nested call joins the outer group.
 */
export async function runUndoGroup<T>(label: string, work: () => Promise<T>): Promise<T> {
  if (useUndoStore.getState().groupDepth > 0) return work();

  const before = latestUndoId();
  try {
    const result = await runInUndoGroup(work);
    const id = latestUndoId();
    if (id && id !== before) {
      useUndoStore.setState((s) => ({
        past: s.past.map((entry) => (entry.id === id ? { ...entry, label } : entry)),
      }));
    }
    return result;
  } catch (error) {
    const id = latestUndoId();
    if (id && id !== before) {
      try {
        await useUndoStore.getState().undo();
      } catch {
        // Best effort: keep the original failure as the one the caller sees.
      }
      useUndoStore.getState().remove(id);
    }
    throw error;
  }
}
