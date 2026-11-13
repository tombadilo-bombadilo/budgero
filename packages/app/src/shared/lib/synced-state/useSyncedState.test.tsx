import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { setDemoSpaceId } from '@shared/lib/demo-space';
import { writeSyncedStateCache } from './synced-state';
import { useSyncedState } from './useSyncedState';

const { store, calls, env } = vi.hoisted(() => ({
  store: new Map<string, unknown>(),
  calls: [] as { op: string; payload: Record<string, unknown> }[],
  env: { initialized: true, spaceId: 'space-1' as string | null, hasStore: true, demo: false },
}));

const runtime = {
  services: () =>
    env.hasStore
      ? {
          syncedState: { get: (scope: string, key: string) => store.get(`${scope}|${key}`) },
          budgets: { getAllBudgets: () => [{ ID: 1 }] },
          accounts: {
            listAccounts: () => [{ Metadata: env.demo ? '{"demo_budget":true}' : '{}' }],
          },
        }
      : {},
  getActiveSpaceId: () => env.spaceId,
  isInitialized: () => env.initialized,
  executeMutation: async (spec: { op: string; payload: Record<string, unknown> }) => {
    calls.push(spec);
    return { result: undefined };
  },
};

vi.mock('@shared/runtime/global', () => ({ getRuntime: () => runtime }));
vi.mock('@shared/runtime/runtime-provider', () => ({
  useRuntime: () => runtime,
  useRuntimeInitialized: () => env.initialized,
  useRuntimeState: () => (env.initialized ? 'Ready' : 'Initializing'),
  useActiveSpaceId: () => env.spaceId,
}));

function render<T>(scope: 'workspace' | `user:${string}` | null, key: string, cache = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(() => useSyncedState<T>(scope, key, { cache }), { wrapper });
}

beforeEach(() => {
  localStorage.clear();
  setDemoSpaceId(null);
  store.clear();
  calls.length = 0;
  env.initialized = true;
  env.spaceId = 'space-1';
  env.hasStore = true;
  env.demo = false;
});

it('is not loaded until the workspace database is read', async () => {
  env.initialized = false;
  const { result, rerender } = render<string>('user:u1', 'introSeen');
  expect(result.current.loaded).toBe(false);
  expect(result.current.canWrite).toBe(false);
  env.initialized = true;
  store.set('user:u1|introSeen', 'yes');
  rerender();
  await waitFor(() => expect(result.current.loaded).toBe(true));
  expect(result.current.available).toBe(true);
  expect(result.current.value).toBe('yes');
});

it('shows the cached copy first, then the database value, and refreshes the cache', async () => {
  writeSyncedStateCache('space-1', 'workspace', 'banner', 'cached');
  store.set('workspace|banner', 'synced');
  env.initialized = false;
  const { result, rerender } = render<string>('workspace', 'banner', true);
  expect(result.current.value).toBe('cached');
  env.initialized = true;
  rerender();
  await waitFor(() => expect(result.current.value).toBe('synced'));
  expect(JSON.parse(localStorage.getItem('budgero:synced-state')!)).toEqual({
    'space-1': { 'workspace|banner': 'synced' },
  });
});

it('is loaded but unavailable without a synced store, and writes nothing', async () => {
  env.hasStore = false;
  const { result } = render<boolean>('workspace', 'k');
  await waitFor(() => expect(result.current.loaded).toBe(true));
  expect(result.current.available).toBe(false);
  await act(async () => {
    expect(await result.current.set(true)).toBe(false);
  });
  expect(calls).toEqual([]);
});

it('writes through the synced op, and never in the demo', async () => {
  const { result, unmount } = render<boolean>('user:u1', 'dismissed');
  await waitFor(() => expect(result.current.loaded).toBe(true));
  await act(async () => {
    await result.current.set(true);
    await result.current.merge({ set: { a: 1 } });
  });
  expect(calls.map((c) => c.op)).toEqual(['syncedState.set', 'syncedState.merge']);
  unmount();

  calls.length = 0;
  setDemoSpaceId('space-1');
  const demo = render<boolean>('user:u1', 'dismissed');
  await waitFor(() => expect(demo.result.current.loaded).toBe(true));
  expect(demo.result.current.canWrite).toBe(false);
  await act(async () => {
    expect(await demo.result.current.set(true)).toBe(false);
  });
  expect(calls).toEqual([]);
});

it('refuses writes in the demo before its id is cached, from the seed’s marker', async () => {
  env.demo = true;
  const { result } = render<boolean>('user:u1', 'dismissed');
  await waitFor(() => expect(result.current.loaded).toBe(true));
  expect(result.current.canWrite).toBe(false);
  await act(async () => {
    expect(await result.current.set(true)).toBe(false);
    expect(await result.current.merge({ set: { a: 1 } })).toBe(false);
  });
  expect(calls).toEqual([]);
});

it('reads nothing while the scope is unknown', () => {
  const { result } = render<string>(null, 'k');
  expect(result.current.loaded).toBe(false);
  expect(result.current.value).toBeUndefined();
});
