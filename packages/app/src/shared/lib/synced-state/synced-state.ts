/**
 * Synced app state: small per-user / per-workspace / per-budget values that
 * would otherwise sit in one browser's localStorage (dismissed banners, seen
 * intros, import routes, ...). Stored in the open workspace's encrypted
 * database (core SyncedStateService, ops syncedState.set / syncedState.merge),
 * so it reaches every device and survives cleared site data; the server only
 * relays opaque encrypted mutations.
 *
 * Which scope:
 * - userScope(userId): one person's own state (dismissals, seen intros,
 *   personal UI choices). Per workspace: a user with two workspaces has a
 *   separate value in each (there is no cross-workspace encrypted store).
 * - WORKSPACE_SCOPE: shared by every member (import routes, templates).
 * - budgetScope(budgetId): belongs to one budget (a savings target).
 *
 * Privacy: every member of a shared workspace can decrypt the whole database,
 * user-scoped rows included. Keep them to harmless UI state; never put
 * secrets, tokens or anything private to one member here.
 *
 * Writing: `set` replaces the value (newest write wins; null deletes).
 * `merge` edits a JSON object entry by entry, so two devices adding different
 * entries both keep theirs; use it for maps and sets (a set = {id: true}).
 * Use one or the other for a key. Values are JSON, at most 64 KB. Writes are
 * not undoable and not in the audit log; nothing is written in the demo
 * workspace (cached id or the seed's marker, see isDemoWorkspaceOpen) or when
 * no workspace is open. Keep writes rare: write on a user
 * action or a real change, never per render or per keystroke.
 */
import type { Services, SyncedStateMergePatch, SyncedStateScope } from '@budgero/core/browser';
import { getDemoSpaceId, holdsOnlyDemoBudgets } from '@shared/lib/demo-space';
import { getRuntime } from '@shared/runtime/global';

export type { SyncedStateMergePatch, SyncedStateScope };

export const WORKSPACE_SCOPE = 'workspace' as const satisfies SyncedStateScope;

export function userScope(userId: string): SyncedStateScope {
  return `user:${userId}`;
}

export function budgetScope(budgetId: number): SyncedStateScope {
  return `budget:${budgetId}`;
}

export const SYNCED_STATE_QUERY = 'syncedState';

type SyncedStateReader = {
  syncedState?: { get(scope: SyncedStateScope, key: string): unknown };
};

/** Minimal runtime surface the helpers use (AppRuntime satisfies it). */
export interface SyncedStateRuntime {
  services(): unknown;
  getActiveSpaceId(): string | null;
  isInitialized?(): boolean;
  executeMutation<T>(spec: {
    op: string;
    payload: Record<string, unknown>;
    spaceId?: string;
    meta?: { skipUndo?: boolean; label?: string };
  }): Promise<{ result: T }>;
}

function runtimeOrNull(runtime?: SyncedStateRuntime | null): SyncedStateRuntime | null {
  return runtime ?? (getRuntime() as unknown as SyncedStateRuntime | null);
}

/**
 * The stored value now, from the open workspace's database. `available` is
 * false when there is no database or synced store yet (offline first run,
 * runtime starting): callers then fall back to their own default or cache.
 */
export function readSyncedState<T>(
  scope: SyncedStateScope,
  key: string,
  runtime?: SyncedStateRuntime | null
): { available: boolean; value: T | undefined } {
  const rt = runtimeOrNull(runtime);
  try {
    const services = rt?.services() as SyncedStateReader | null | undefined;
    if (!rt?.getActiveSpaceId() || !services?.syncedState) {
      return { available: false, value: undefined };
    }
    return { available: true, value: services.syncedState.get(scope, key) as T | undefined };
  } catch {
    return { available: false, value: undefined };
  }
}

/**
 * The open workspace is the onboarding demo, read from its own data (the seed's
 * account marker), so it is known as soon as the database is, without waiting
 * for the device's cached demo id. That id still covers the seed's first
 * moments, before the marked accounts exist.
 */
export function isDemoWorkspaceOpen(runtime?: SyncedStateRuntime | null): boolean {
  const rt = runtimeOrNull(runtime);
  try {
    const spaceId = rt?.getActiveSpaceId();
    if (!spaceId) return false;
    if (spaceId === getDemoSpaceId()) return true;
    const services = rt!.services() as Partial<Pick<Services, 'budgets' | 'accounts'>> | null;
    return Boolean(
      services?.budgets &&
      services.accounts &&
      holdsOnlyDemoBudgets(services as Pick<Services, 'budgets' | 'accounts'>)
    );
  } catch {
    return false;
  }
}

/** Why a write would be refused here, or null when it may go ahead. */
export function syncedStateWriteBlocker(
  runtime?: SyncedStateRuntime | null
): 'no-runtime' | 'no-workspace' | 'no-store' | 'demo' | null {
  const rt = runtimeOrNull(runtime);
  if (!rt || rt.isInitialized?.() === false) return 'no-runtime';
  const spaceId = rt.getActiveSpaceId();
  if (!spaceId) return 'no-workspace';
  if (!readSyncedState('workspace', 'probe', rt).available) return 'no-store';
  if (isDemoWorkspaceOpen(rt)) return 'demo';
  return null;
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/**
 * Replaces a value (null deletes). Returns true when a write was sent; false
 * when it was refused (demo, no workspace) or would change nothing.
 */
export async function setSyncedState(
  scope: SyncedStateScope,
  key: string,
  value: unknown,
  runtime?: SyncedStateRuntime | null
): Promise<boolean> {
  const rt = runtimeOrNull(runtime);
  if (!rt || syncedStateWriteBlocker(rt)) return false;
  const current = readSyncedState(scope, key, rt);
  if (current.available && sameJson(current.value, value)) return false;
  await rt.executeMutation({
    op: 'syncedState.set',
    payload: { scope, key, value: value ?? null },
    spaceId: rt.getActiveSpaceId()!,
    meta: { skipUndo: true, label: `Synced state: ${key}` },
  });
  return true;
}

/**
 * Adds/replaces entries of a JSON object value and removes others by key.
 * Returns true when a write was sent; false when refused or a no-op.
 */
export async function mergeSyncedState(
  scope: SyncedStateScope,
  key: string,
  patch: SyncedStateMergePatch,
  runtime?: SyncedStateRuntime | null
): Promise<boolean> {
  const rt = runtimeOrNull(runtime);
  if (!rt || syncedStateWriteBlocker(rt)) return false;
  const current = readSyncedState<Record<string, unknown>>(scope, key, rt);
  if (current.available) {
    const stored = new Map(
      current.value && typeof current.value === 'object' && !Array.isArray(current.value)
        ? Object.entries(current.value)
        : []
    );
    const sets = Object.entries(patch.set ?? {}).filter(
      ([entry, value]) => !stored.has(entry) || !sameJson(stored.get(entry), value)
    );
    const removes = (patch.remove ?? []).filter((entry) => stored.has(entry));
    if (sets.length === 0 && removes.length === 0) return false;
    patch = {
      ...(sets.length ? { set: Object.fromEntries(sets) } : {}),
      ...(removes.length ? { remove: removes } : {}),
    };
  }
  await rt.executeMutation({
    op: 'syncedState.merge',
    payload: { scope, key, patch },
    spaceId: rt.getActiveSpaceId()!,
    meta: { skipUndo: true, label: `Synced state: ${key}` },
  });
  return true;
}

// ---------------------------------------------------------------------------
// Device cache (optional): the last synced value per workspace, for first paint
// ---------------------------------------------------------------------------

export const SYNCED_STATE_CACHE_KEY = 'budgero:synced-state';

type CacheShape = Record<string, Record<string, unknown>>;

function readCache(): CacheShape {
  try {
    const raw = localStorage.getItem(SYNCED_STATE_CACHE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? (parsed as CacheShape) : {};
  } catch {
    return {};
  }
}

const cacheEntry = (scope: SyncedStateScope, key: string) => `${scope}|${key}`;

export function readSyncedStateCache<T>(
  spaceId: string,
  scope: SyncedStateScope,
  key: string
): T | undefined {
  return readCache()[spaceId]?.[cacheEntry(scope, key)] as T | undefined;
}

export function writeSyncedStateCache(
  spaceId: string,
  scope: SyncedStateScope,
  key: string,
  value: unknown
): void {
  const all = readCache();
  const space = { ...all[spaceId] };
  const entry = cacheEntry(scope, key);
  if (value === undefined || value === null) {
    if (!(entry in space)) return;
    delete space[entry];
  } else {
    if (sameJson(space[entry], value)) return;
    space[entry] = value;
  }
  try {
    localStorage.setItem(SYNCED_STATE_CACHE_KEY, JSON.stringify({ ...all, [spaceId]: space }));
  } catch {
    /* storage blocked: the database still has it */
  }
}
