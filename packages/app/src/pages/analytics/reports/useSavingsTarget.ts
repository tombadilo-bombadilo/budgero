import { useCallback, useEffect, useRef, useState } from 'react';
import { budgetScope, useSyncedState } from '@shared/lib/synced-state';

export const SAVINGS_TARGET_KEY = 'savingsTarget';

/** Before it synced, the target sat in one device's localStorage, keyed by budget id only. */
const LEGACY_PREFIX = 'budgero.analytics.savingsTarget.';
/** Typing settles for this long before the target is written (one write per change). */
const WRITE_DELAY_MS = 600;

export function parseSavingsTarget(raw: unknown): number | null {
  const parsed = typeof raw === 'number' ? raw : raw === '' || raw === null ? NaN : Number(raw);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 100 ? parsed : null;
}

/**
 * The old per-device keys have no workspace id, and budget ids repeat across
 * workspaces (the demo's first budget has the same id as your own), so a value
 * there can't be tied to this budget safely: drop them rather than migrate.
 */
function dropLegacyTargets(): void {
  try {
    const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i));
    for (const key of keys) {
      if (key?.startsWith(LEGACY_PREFIX)) localStorage.removeItem(key);
    }
  } catch {
    /* storage blocked: nothing to drop */
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

  useEffect(dropLegacyTargets, []);

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
