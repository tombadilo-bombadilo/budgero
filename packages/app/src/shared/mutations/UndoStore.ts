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

  push: (item) =>
    set((s) => ({
      past: [...s.past, item],
      future: [], // clear redo stack on new action
    })),

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
    } finally {
      set({ isReplaying: false });
    }
  },
}));
