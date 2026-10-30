import { useEffect, useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getMaxSupportedSchemaVersion, MigrationRunner } from '@budgero/core/browser';
import { blobApi, spaceApi, syncApi, versionApi } from '@shared/api/api-client';
import { useActiveSpaceId, useRuntime } from '@shared/runtime/runtime-provider';
import { decodeLogEntry, type DecodedLogEntry } from '../lib/decode-log-entry';

export const MUTATION_LOG_PAGE_SIZE = 50;
const DIAGNOSTICS_KEY = 'syncDiagnostics';

type MigrationDatabase = ConstructorParameters<typeof MigrationRunner>[0];

export function useLocalSyncState() {
  const runtime = useRuntime();
  const spaceId = useActiveSpaceId();
  return useQuery({
    queryKey: [DIAGNOSTICS_KEY, 'local', spaceId],
    enabled: Boolean(spaceId),
    refetchInterval: 2000,
    queryFn: () => {
      const db = runtime.getDatabase();
      return {
        diagnostics: runtime.getSyncDiagnostics(),
        runtimeState: runtime.state(),
        schemaVersion: db
          ? new MigrationRunner(db as unknown as MigrationDatabase).getCurrentVersion()
          : undefined,
        supportedSchemaVersion: getMaxSupportedSchemaVersion(),
      };
    },
  });
}

export function useServerSyncState() {
  const spaceId = useActiveSpaceId();
  return useQuery({
    queryKey: [DIAGNOSTICS_KEY, 'server', spaceId],
    enabled: Boolean(spaceId),
    refetchInterval: 15_000,
    retry: false,
    queryFn: () => blobApi.getState(spaceId!),
  });
}

export function useServerVersion() {
  return useQuery({
    queryKey: [DIAGNOSTICS_KEY, 'version'],
    staleTime: 5 * 60 * 1000,
    retry: false,
    queryFn: () => versionApi.getLatest(),
  });
}

export function usePendingMutations() {
  const runtime = useRuntime();
  const spaceId = useActiveSpaceId();
  return useQuery({
    queryKey: [DIAGNOSTICS_KEY, 'pending', spaceId],
    enabled: Boolean(spaceId),
    refetchInterval: 3000,
    queryFn: () => runtime.getPendingMutations(),
  });
}

export function useSpaceMemberNames() {
  const spaceId = useActiveSpaceId();
  return useQuery({
    queryKey: [DIAGNOSTICS_KEY, 'members', spaceId],
    enabled: Boolean(spaceId),
    staleTime: 10 * 60 * 1000,
    retry: false,
    queryFn: async () => {
      const members = await spaceApi.listMembers(spaceId!);
      return new Map(members.map((m) => [m.user_id, m.user_name || m.user_email]));
    },
  });
}

/** Server log, newest first, decrypted on this device page by page. */
export function useMutationLog() {
  const runtime = useRuntime();
  const spaceId = useActiveSpaceId();
  return useInfiniteQuery({
    queryKey: [DIAGNOSTICS_KEY, 'log', spaceId],
    enabled: Boolean(spaceId),
    retry: false,
    initialPageParam: 0,
    queryFn: async ({ pageParam }): Promise<DecodedLogEntry[]> => {
      const page = await syncApi.getMutationLog(spaceId!, {
        before: pageParam || undefined,
        limit: MUTATION_LOG_PAGE_SIZE,
      });
      const encryption = runtime.getEncryption();
      return Promise.all(page.entries.map((entry) => decodeLogEntry(entry, encryption)));
    },
    getNextPageParam: (lastPage) => {
      const oldest = lastPage.at(-1)?.version;
      return lastPage.length === MUTATION_LOG_PAGE_SIZE && oldest && oldest > 1
        ? oldest
        : undefined;
    },
  });
}

export function useRedownloadFromServer() {
  const runtime = useRuntime();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => runtime.redownloadFromServer(),
    onSettled: () => queryClient.invalidateQueries({ queryKey: [DIAGNOSTICS_KEY] }),
  });
}

export function useLastSyncError(): string | null {
  const runtime = useRuntime();
  const [error, setError] = useState<string | null>(null);
  useEffect(
    () => runtime.onSyncStatus((status) => setError(status.syncError?.message ?? null)),
    [runtime]
  );
  return error;
}
