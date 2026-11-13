import { useCallback, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useDemoSpaceId } from '@shared/lib/demo-space';
import {
  useActiveSpaceId,
  useRuntime,
  useRuntimeInitialized,
  useRuntimeState,
} from '@shared/runtime/runtime-provider';
import {
  isDemoWorkspaceOpen,
  mergeSyncedState,
  readSyncedState,
  readSyncedStateCache,
  setSyncedState,
  SYNCED_STATE_QUERY,
  writeSyncedStateCache,
  type SyncedStateMergePatch,
  type SyncedStateRuntime,
  type SyncedStateScope,
} from './synced-state';

export interface UseSyncedStateOptions {
  /** Keep a localStorage copy per workspace and show it until the database is read. */
  cache?: boolean;
  /** Extra condition that blocks writes (e.g. the caller's own read-only state). */
  readOnly?: boolean;
}

export interface SyncedState<T> {
  /** The stored value; the cached copy (if `cache`) until `loaded`; undefined when unset. */
  value: T | undefined;
  /**
   * The open workspace's state has been read, or can't be (no database / no
   * workspace / runtime failed: then `available` is false and `value` is the
   * cache). Don't act on "not set yet" before this is true.
   */
  loaded: boolean;
  /** `value` comes from the synced database. */
  available: boolean;
  /**
   * Writes would be sent: state loaded from the database, not read-only, and
   * not the demo (by its cached id or, once loaded, its own data).
   */
  canWrite: boolean;
  /** Replace the value (null deletes). Resolves false when refused or nothing changes. */
  set: (value: T | null) => Promise<boolean>;
  /** Entry-wise edit of an object value. Resolves false when refused or nothing changes. */
  merge: (patch: SyncedStateMergePatch) => Promise<boolean>;
}

/**
 * Reads one synced state key of the open workspace reactively (refreshes when
 * any device changes it) and writes it through the synced mutation path. See
 * synced-state.ts for scopes, privacy and write rules. `scope` null (e.g. the
 * user id isn't known yet) reads nothing and reports not loaded.
 */
export function useSyncedState<T>(
  scope: SyncedStateScope | null,
  key: string,
  options: UseSyncedStateOptions = {}
): SyncedState<T> {
  const runtime = useRuntime() as unknown as SyncedStateRuntime;
  const runtimeInitialized = useRuntimeInitialized();
  const runtimeState = useRuntimeState();
  const spaceId = useActiveSpaceId();
  const demoSpaceId = useDemoSpaceId();
  const { cache = false, readOnly = false } = options;

  const query = useQuery<{ available: boolean; value: T | null; demo: boolean }>({
    queryKey: [SYNCED_STATE_QUERY, spaceId, scope, key],
    queryFn: () => {
      const read = readSyncedState<T>(scope!, key, runtime);
      // react-query can't hold undefined. The demo check rides along, so there
      // is no moment where the state is loaded but the demo status unknown.
      const demo = read.available && isDemoWorkspaceOpen(runtime);
      return { available: read.available, value: read.value ?? null, demo };
    },
    enabled: runtimeInitialized && Boolean(spaceId) && scope !== null,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    retry: 2,
  });

  const failed = runtimeState === 'Error' || runtimeState === 'Destroyed' || query.isError;
  const noWorkspace = !spaceId && runtimeInitialized;
  const { data } = query;
  const loaded = scope !== null && (Boolean(data) || failed || noWorkspace);
  const available = Boolean(data?.available);

  useEffect(() => {
    if (cache && spaceId && scope && data?.available) {
      writeSyncedStateCache(spaceId, scope, key, data.value);
    }
  }, [cache, spaceId, scope, key, data]);

  let value: T | undefined;
  if (available) value = data!.value ?? undefined;
  else if (cache && spaceId && scope) value = readSyncedStateCache<T>(spaceId, scope, key);

  const canWrite =
    !readOnly && available && !data!.demo && Boolean(spaceId) && spaceId !== demoSpaceId && !failed;

  const set = useCallback(
    async (next: T | null) => {
      if (!canWrite || !scope) return false;
      const sent = await setSyncedState(scope, key, next, runtime);
      if (sent && cache && spaceId) writeSyncedStateCache(spaceId, scope, key, next);
      return sent;
    },
    [canWrite, scope, key, runtime, cache, spaceId]
  );

  const merge = useCallback(
    async (patch: SyncedStateMergePatch) => {
      if (!canWrite || !scope) return false;
      return mergeSyncedState(scope, key, patch, runtime);
    },
    [canWrite, scope, key, runtime]
  );

  return { value, loaded, available, canWrite, set, merge };
}
