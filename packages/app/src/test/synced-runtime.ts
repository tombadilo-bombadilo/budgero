/**
 * A fake runtime with an in-memory synced state store (set / merge like core's
 * SyncedStateService, minus the clocks) for component tests of code that uses
 * synced state. Mock the runtime modules with it:
 *
 *   vi.mock('@shared/runtime/global', async () =>
 *     (await import('@/test/synced-runtime')).globalMock());
 *   vi.mock('@shared/runtime/runtime-provider', async () =>
 *     (await import('@/test/synced-runtime')).runtimeProviderMock());
 *
 * and render inside <SyncedRuntimeProvider> (or `wrapper: SyncedRuntimeProvider`).
 * Call resetSyncedRuntime() in beforeEach. Writes apply at once and refresh
 * the synced state queries, like a local mutation does.
 */
import { createElement, type ReactNode } from 'react';
import { act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

type Call = { op: string; payload: Record<string, unknown> };

export const syncedRuntime = {
  store: new Map<string, unknown>(),
  calls: [] as Call[],
  spaceId: 'space-1' as string | null,
  initialized: true,
  /** Rows services.transactions.getAllTransactions returns. */
  transactions: [] as { Payee?: string }[],
  role: 'owner' as string | undefined,
  client: new QueryClient({ defaultOptions: { queries: { retry: false } } }),
};

const entry = (scope: string, key: string) => `${scope}|${key}`;

/** Store a value as if it had synced in from another device (refreshes queries). */
export async function receiveSyncedState(
  scope: string,
  key: string,
  value: unknown
): Promise<void> {
  syncedRuntime.store.set(entry(scope, key), value);
  await act(async () => {
    await syncedRuntime.client.invalidateQueries({ queryKey: ['syncedState'] });
  });
  await flushSyncedState();
}

export const fakeRuntime = {
  services: () => ({
    syncedState: {
      get: (scope: string, key: string) => syncedRuntime.store.get(entry(scope, key)),
    },
    transactions: {
      getAllTransactions: (_budgetId: number, limit?: number) =>
        syncedRuntime.transactions.slice(0, limit),
    },
  }),
  getActiveSpaceId: () => syncedRuntime.spaceId,
  isInitialized: () => syncedRuntime.initialized,
  listSpaces: () =>
    syncedRuntime.spaceId ? [{ space_id: syncedRuntime.spaceId, role: syncedRuntime.role }] : [],
  executeMutation: async (spec: Call) => {
    syncedRuntime.calls.push({ op: spec.op, payload: spec.payload });
    const { scope, key } = spec.payload as { scope: string; key: string };
    if (spec.op === 'syncedState.set') {
      syncedRuntime.store.set(entry(scope, key), spec.payload.value ?? undefined);
    } else if (spec.op === 'syncedState.merge') {
      const patch = spec.payload.patch as { set?: Record<string, unknown>; remove?: string[] };
      const next = {
        ...(syncedRuntime.store.get(entry(scope, key)) as object | undefined),
      } as Record<string, unknown>;
      Object.assign(next, patch.set);
      for (const removed of patch.remove ?? []) delete next[removed];
      syncedRuntime.store.set(entry(scope, key), next);
    }
    await syncedRuntime.client.invalidateQueries({ queryKey: ['syncedState'] });
    return { result: undefined };
  },
};

export function resetSyncedRuntime(): void {
  syncedRuntime.store.clear();
  syncedRuntime.calls.length = 0;
  syncedRuntime.spaceId = 'space-1';
  syncedRuntime.initialized = true;
  syncedRuntime.transactions = [];
  syncedRuntime.role = 'owner';
  syncedRuntime.client.clear();
}

/** The synced-state writes sent so far, as merge/set patches. */
export function syncedWrites(key?: string): Call[] {
  return syncedRuntime.calls.filter(
    (call) => call.op.startsWith('syncedState.') && (!key || call.payload.key === key)
  );
}

export function globalMock() {
  return { getRuntime: () => fakeRuntime };
}

export function runtimeProviderMock() {
  return {
    useRuntime: () => fakeRuntime,
    useRuntimeInitialized: () => syncedRuntime.initialized,
    useRuntimeState: () => (syncedRuntime.initialized ? 'Ready' : 'Initializing'),
    useActiveSpaceId: () => syncedRuntime.spaceId,
  };
}

export function SyncedRuntimeProvider({ children }: { children: ReactNode }) {
  return createElement(QueryClientProvider, { client: syncedRuntime.client }, children);
}

/** Let the synced state queries resolve (and the writes they cause land). */
export async function flushSyncedState(): Promise<void> {
  for (let i = 0; i < 3; i += 1) {
    await act(async () => {
      if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(0);
      else await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}
