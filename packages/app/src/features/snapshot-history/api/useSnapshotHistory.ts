import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { blobApi } from '@shared/api/api-client';
import { toErrorCode } from '@shared/lib/analytics/error-codes';
import { track } from '@shared/lib/analytics/track';
import { useActiveSpaceId, useRuntime } from '@shared/runtime/runtime-provider';
import { summarizeSnapshot, type SnapshotSummary } from '../lib/snapshot-summary';

const HISTORY_KEY = 'snapshotHistory';

export function useSnapshotHistory() {
  const spaceId = useActiveSpaceId();
  return useQuery({
    queryKey: [HISTORY_KEY, spaceId],
    enabled: Boolean(spaceId),
    retry: false,
    queryFn: () => blobApi.listHistory(spaceId!),
  });
}

/**
 * Restore an earlier snapshot: the server makes it the workspace snapshot
 * (and tells the other devices to reload), then this device reloads it too.
 * Changes made after that copy are still in the change log and are replayed
 * on top, so the result is the earlier copy plus every later edit.
 */
export function useRestoreSnapshot() {
  const spaceId = useActiveSpaceId();
  const runtime = useRuntime();
  const queryClient = useQueryClient();
  return useMutation({
    meta: { label: 'snapshot.restore' },
    mutationFn: async (entryId: number) => {
      if (!spaceId) throw new Error('No active workspace');
      const result = await blobApi.restoreHistory(spaceId, entryId);
      await runtime.redownloadFromServer();
      return result;
    },
    onSuccess: () => {
      track('snapshot_restore', { outcome: 'ok', error_code: 'none' });
      void queryClient.invalidateQueries();
    },
    onError: (error) => {
      track('snapshot_restore', { outcome: 'error', error_code: toErrorCode(error) });
    },
  });
}

/**
 * Download one copy (an earlier one by id, or the current one with 'current'),
 * decrypt it on this device and count what is inside. Copies don't change, so
 * the result is cached for the session.
 */
export function useSnapshotSummary(entry: number | 'current', enabled = true) {
  const spaceId = useActiveSpaceId();
  const runtime = useRuntime();
  return useQuery<SnapshotSummary | null>({
    queryKey: [HISTORY_KEY, spaceId, 'summary', entry],
    enabled: Boolean(spaceId) && enabled,
    staleTime: Infinity,
    retry: false,
    queryFn: async () => {
      const blob =
        entry === 'current'
          ? await blobApi.downloadBlob(spaceId!)
          : await blobApi.downloadHistory(spaceId!, entry);
      if (!blob) return null;
      return summarizeSnapshot(await runtime.decryptSnapshot(blob.data));
    },
  });
}
