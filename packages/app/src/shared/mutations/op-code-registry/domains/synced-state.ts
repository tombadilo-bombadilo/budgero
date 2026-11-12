import type { SyncedStateMergePatch, SyncedStateScope } from '@budgero/core/browser';
import { S, type OpCodeEntry } from '../shared';

type SyncedStateServices = {
  syncedState?: {
    checkSet(scope: unknown, key: unknown, value: unknown): void;
    checkMerge(scope: unknown, key: unknown, patch: unknown): void;
    set(scope: SyncedStateScope, key: string, value: unknown, at: string): boolean;
    merge(scope: SyncedStateScope, key: string, patch: SyncedStateMergePatch, at: string): boolean;
  };
};

function service(): NonNullable<SyncedStateServices['syncedState']> {
  const services = S() as SyncedStateServices;
  if (!services.syncedState) throw new Error('syncedState service not available');
  return services.syncedState;
}

/** The originating device's time; replays use the one in the args. */
function stamped(args: Record<string, unknown>): Record<string, unknown> {
  return typeof args.at === 'string' ? args : { ...args, at: new Date().toISOString() };
}

/**
 * Generic synced key/value state (core SyncedStateService; app helper in
 * shared/lib/synced-state). Writes are applied by their time, so replays in
 * any order agree; not undoable and not in the audit log. Size and shape are
 * checked once, on the device that makes the change (prepare), so a replay
 * never fails on another device.
 */
export const syncedStateOps = {
  'syncedState.set': {
    prepare: (args) => {
      service().checkSet(args.scope, args.key, args.value);
      return stamped(args);
    },
    execute: async (args) => ({
      changed: service().set(
        args.scope as SyncedStateScope,
        args.key as string,
        args.value ?? null,
        args.at as string
      ),
    }),
    invalidates: [['syncedState']],
    history: false,
  },
  'syncedState.merge': {
    prepare: (args) => {
      service().checkMerge(args.scope, args.key, args.patch);
      return stamped(args);
    },
    execute: async (args) => ({
      changed: service().merge(
        args.scope as SyncedStateScope,
        args.key as string,
        args.patch as SyncedStateMergePatch,
        args.at as string
      ),
    }),
    invalidates: [['syncedState']],
    history: false,
  },
} satisfies Record<string, OpCodeEntry>;
