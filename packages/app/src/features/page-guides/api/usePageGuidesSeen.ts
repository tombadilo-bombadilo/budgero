import { useCallback, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { executeSpaceMutation } from '@shared/runtime/mutation-router';
import {
  useActiveSpaceId,
  useRuntime,
  useRuntimeInitialized,
  useRuntimeState,
} from '@shared/runtime/runtime-provider';
import {
  cachedSeenPageGuides,
  cachePageGuidesSeen,
  hasSeenPageGuide,
  isPageGuideSeen,
  unsyncedGuideIds,
  type PageGuideId,
  type SyncedPageGuides,
} from '../model/page-guides';

export const PAGE_GUIDES_SEEN_QUERY = 'pageGuidesSeen';

type PageGuidesServices = { pageGuides?: { getSeen(userId: string): string[] } };

/** Writes in flight, per workspace + user + guide, so a refetch doesn't send them twice. */
const pending = new Set<string>();

export function resetPageGuidesSeenForTests(): void {
  pending.clear();
}

export interface PageGuidesSeen {
  /** The open workspace's synced state has loaded (or is unavailable, so the cache decides). */
  ready: boolean;
  /** Seen per the cache or the synced state; null while the synced state loads. */
  isSeen: (id: PageGuideId) => boolean | null;
  /** Remember a guide as seen: device cache now, synced state with one write if it's new there. */
  markSeen: (id: PageGuideId) => void;
}

/**
 * Seen page guides for `userId` in the open workspace. On load it merges the
 * synced list into the device cache and writes whatever only the cache has
 * (guides seen before this was synced, or elsewhere on this device) in one
 * mutation. `canWrite` false (demo, demo check pending) keeps it read-only.
 */
export function usePageGuidesSeen(userId: string | null, canWrite: boolean): PageGuidesSeen {
  const runtime = useRuntime();
  const runtimeInitialized = useRuntimeInitialized();
  const runtimeState = useRuntimeState();
  const spaceId = useActiveSpaceId();

  const query = useQuery<string[] | null>({
    queryKey: [PAGE_GUIDES_SEEN_QUERY, spaceId, userId],
    queryFn: () => {
      const services = runtime.services() as PageGuidesServices | null;
      return services?.pageGuides ? services.pageGuides.getSeen(userId!) : null;
    },
    enabled: runtimeInitialized && Boolean(spaceId) && Boolean(userId),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    retry: 2,
  });

  let synced: SyncedPageGuides;
  if (!spaceId || runtimeState === 'Error' || runtimeState === 'Destroyed') synced = 'unavailable';
  else if (query.isError || query.data === null) synced = 'unavailable';
  else if (query.data) synced = query.data as PageGuideId[];
  else synced = 'loading';

  const writable = canWrite && runtimeInitialized && Boolean(spaceId);

  const write = useCallback(
    (ids: readonly PageGuideId[]) => {
      if (!userId || !spaceId) return;
      const fresh = ids.filter((id) => !pending.has(`${spaceId}|${userId}|${id}`));
      if (fresh.length === 0) return;
      const keys = fresh.map((id) => `${spaceId}|${userId}|${id}`);
      keys.forEach((key) => pending.add(key));
      void executeSpaceMutation(runtime, {
        op: 'pageGuides.markSeen',
        payload: { userId, guides: fresh },
        meta: { skipUndo: true, label: 'Mark page guide seen' },
      })
        .catch(() => {
          /* the cache still has it; the next load writes it again */
        })
        .finally(() => keys.forEach((key) => pending.delete(key)));
    },
    [runtime, spaceId, userId]
  );

  // Synced → cache, and cache-only guides → one synced write.
  // query.data itself, so it keeps its identity until the list changes.
  const syncedList = Array.isArray(synced) ? synced : null;
  useEffect(() => {
    if (!userId || !syncedList) return;
    cachePageGuidesSeen(userId, syncedList);
    if (!writable) return;
    const missing = unsyncedGuideIds(cachedSeenPageGuides(userId), syncedList);
    if (missing.length > 0) write(missing);
  }, [userId, syncedList, writable, write]);

  // Read by the callbacks below, which the host calls from timers.
  const syncedRef = useRef(synced);
  const writableRef = useRef(writable);
  useEffect(() => {
    syncedRef.current = synced;
    writableRef.current = writable;
  });

  const isSeen = useCallback(
    (id: PageGuideId) =>
      userId ? isPageGuideSeen(id, hasSeenPageGuide(userId, id), syncedRef.current) : true,
    [userId]
  );

  const markSeen = useCallback(
    (id: PageGuideId) => {
      if (!userId) return;
      // Already cached: the load step above has written it (or will, once loaded).
      if (cachedSeenPageGuides(userId).includes(id)) return;
      cachePageGuidesSeen(userId, [id]);
      const { current } = syncedRef;
      // While loading, the load step above writes it once the list is known.
      if (writableRef.current && Array.isArray(current) && !current.includes(id)) write([id]);
    },
    [userId, write]
  );

  return { ready: synced !== 'loading', isSeen, markSeen };
}
