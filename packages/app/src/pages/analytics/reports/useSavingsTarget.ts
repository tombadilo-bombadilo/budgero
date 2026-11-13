import { useCallback, useEffect, useRef, useState } from 'react';
import type { Services } from '@budgero/core/browser';
import { getDemoSpaceId } from '@shared/lib/demo-space';
import {
  budgetScope,
  readSyncedState,
  setSyncedState,
  syncedStateWriteBlocker,
  useSyncedState,
  type SyncedStateRuntime,
} from '@shared/lib/synced-state';
import { useAvailableSpaces, useRuntime } from '@shared/runtime/runtime-provider';

export const SAVINGS_TARGET_KEY = 'savingsTarget';

/** Before it synced, the target sat in one device's localStorage, keyed by budget id only. */
const LEGACY_PREFIX = 'budgero.analytics.savingsTarget.';
/** Typing settles for this long before the target is written (one write per change). */
const WRITE_DELAY_MS = 600;

export function parseSavingsTarget(raw: unknown): number | null {
  const parsed = typeof raw === 'number' ? raw : raw === '' || raw === null ? NaN : Number(raw);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 100 ? parsed : null;
}

/** The old per-device values: budget id → raw value. */
function readLegacyTargets(): Map<number, string> {
  const found = new Map<number, string>();
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key?.startsWith(LEGACY_PREFIX)) continue;
      found.set(Number(key.slice(LEGACY_PREFIX.length)), localStorage.getItem(key) ?? '');
    }
  } catch {
    /* storage blocked: nothing to move */
  }
  return found;
}

function removeLegacyTargets(budgetIds: Iterable<number>): void {
  try {
    for (const id of budgetIds) localStorage.removeItem(`${LEGACY_PREFIX}${id}`);
  } catch {
    /* storage blocked */
  }
}

let settling = false;

/**
 * The old per-device values have no workspace id, and budget ids repeat
 * across workspaces (the demo's first budget has the same id as your own). So
 * a value moves into the synced store only when it can only be this
 * workspace's: the user has exactly one workspace besides the demo, it is the
 * one open, the budget exists in it and has no synced target yet. Otherwise
 * the values are dropped. Nothing happens in the demo (the real workspace
 * opened later still gets to move them) or before the store and the
 * workspace list are known.
 */
export async function settleLegacySavingsTargets(
  spaces: readonly { space_id: string }[],
  rt: SyncedStateRuntime
): Promise<void> {
  const legacy = readLegacyTargets();
  if (settling || legacy.size === 0 || spaces.length === 0) return;
  // Also the demo (cached id or the seed's marker) and a store not open yet.
  if (syncedStateWriteBlocker(rt)) return;
  const spaceId = rt.getActiveSpaceId();
  settling = true;
  try {
    const demoId = getDemoSpaceId();
    const own = spaces.filter((space) => space.space_id !== demoId);
    if (own.length === 1 && own[0]!.space_id === spaceId) {
      const services = rt.services() as Pick<Services, 'budgets'>;
      const budgetIds = new Set(services.budgets.getAllBudgets().map((budget) => budget.ID));
      for (const [budgetId, raw] of legacy) {
        const value = parseSavingsTarget(raw);
        if (value === null || !budgetIds.has(budgetId)) continue;
        if (readSyncedState(budgetScope(budgetId), SAVINGS_TARGET_KEY, rt).value !== undefined) {
          continue;
        }
        await setSyncedState(budgetScope(budgetId), SAVINGS_TARGET_KEY, value, rt);
      }
    }
    removeLegacyTargets(legacy.keys());
  } catch {
    /* a write failed: the old values stay for the next try */
  } finally {
    settling = false;
  }
}

/**
 * The savings-rate target of a budget, shared by the workspace's members
 * through the synced store. Edits show at once and are written once typing
 * settles (or when the report closes).
 */
export function useSavingsTarget(budgetId: number) {
  const scope = budgetId ? budgetScope(budgetId) : null;
  const synced = useSyncedState<number>(scope, SAVINGS_TARGET_KEY, { cache: true });
  const stored = parseSavingsTarget(synced.value);
  // The value being typed, shown until the store moves off what it held when
  // typing started (our write landed, or another device's). Writes refused
  // (the demo) keep it for the visit.
  const [edit, setEdit] = useState<{
    budgetId: number;
    base: number | null;
    value: number | null;
  } | null>(null);
  const draft = edit?.budgetId === budgetId && edit.base === stored ? edit.value : undefined;
  const timer = useRef<number | undefined>(undefined);
  const flushRef = useRef<() => void>(() => {});

  const runtime = useRuntime() as unknown as SyncedStateRuntime;
  const spaces = useAvailableSpaces();
  useEffect(() => {
    if (synced.loaded && synced.available) void settleLegacySavingsTargets(spaces, runtime);
  }, [synced.loaded, synced.available, spaces, runtime]);

  const { set } = synced;
  const flush = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
    if (draft !== undefined) void set(draft);
  }, [draft, set]);
  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);

  // Write what's still pending when the report closes or the budget changes.
  useEffect(() => () => flushRef.current(), [budgetId]);

  const setTarget = useCallback(
    (raw: string) => {
      const next = parseSavingsTarget(raw);
      setEdit({ budgetId, base: stored, value: next });
      window.clearTimeout(timer.current);
      // flushRef: the write uses the latest store state, not this render's.
      timer.current = window.setTimeout(() => flushRef.current(), WRITE_DELAY_MS);
    },
    [budgetId, stored]
  );

  return { target: draft !== undefined ? draft : stored, setTarget };
}
