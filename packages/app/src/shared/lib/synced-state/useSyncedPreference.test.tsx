import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { setDemoSpaceId } from '@shared/lib/demo-space';
import {
  saveSyncedPreference,
  setSyncedPreferencesUser,
  type SyncedPreference,
} from './synced-preferences';
import { useSyncedPreference } from './useSyncedPreference';

const { store, calls, env } = vi.hoisted(() => ({
  store: new Map<string, unknown>(),
  calls: [] as { op: string; payload: Record<string, unknown> }[],
  env: { initialized: true, spaceId: 'space-1' as string | null },
}));

const runtime = {
  services: () => ({
    syncedState: { get: (scope: string, key: string) => store.get(`${scope}|${key}`) },
  }),
  getActiveSpaceId: () => env.spaceId,
  isInitialized: () => env.initialized,
  executeMutation: async (spec: { op: string; payload: Record<string, unknown> }) => {
    calls.push(spec);
    const { scope, key, value } = spec.payload as { scope: string; key: string; value: unknown };
    store.set(`${scope}|${key}`, value);
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

/** A device's cached value: `explicit` mirrors "the cache key is present". */
function device(value: string, explicit: boolean) {
  const local = { value, explicit, applied: [] as string[] };
  const pref: SyncedPreference<string> = {
    key: 'language',
    readLocal: () => ({ value: local.value, explicit: local.explicit }),
    isValid: (v): v is string => typeof v === 'string',
    apply: (v) => {
      local.applied.push(v);
      local.value = v;
      local.explicit = true;
    },
  };
  return { local, pref };
}

function render(pref: SyncedPreference<string>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(() => useSyncedPreference('u1', pref), { wrapper });
}

const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  setDemoSpaceId(null);
  setSyncedPreferencesUser(null);
  store.clear();
  calls.length = 0;
  env.initialized = true;
  env.spaceId = 'space-1';
});

it('applies the synced value over the cache once the database is read', async () => {
  store.set('user:u1|language', 'de');
  env.initialized = false;
  const { local, pref } = device('en', true);
  const { rerender } = render(pref);
  await settle();
  expect(local.applied).toEqual([]);
  env.initialized = true;
  rerender();
  await waitFor(() => expect(local.applied).toEqual(['de']));
  expect(calls).toEqual([]);
});

it('never writes a default up', async () => {
  const { local, pref } = device('en', false);
  render(pref);
  await settle();
  await settle();
  expect(calls).toEqual([]);
  expect(local.applied).toEqual([]);
});

it('writes an explicit device value once when nothing is synced', async () => {
  const { local, pref } = device('fr', true);
  const { rerender } = render(pref);
  await waitFor(() => expect(calls).toHaveLength(1));
  rerender();
  await settle();
  expect(calls).toEqual([
    expect.objectContaining({
      op: 'syncedState.set',
      payload: { scope: 'user:u1', key: 'language', value: 'fr' },
    }),
  ]);
  expect(local.applied).toEqual([]);
});

it('writes nothing in the demo', async () => {
  setDemoSpaceId('space-1');
  const { pref } = device('fr', true);
  render(pref);
  await settle();
  await settle();
  saveSyncedPreference('language', 'nl');
  setSyncedPreferencesUser('u1');
  saveSyncedPreference('language', 'nl');
  await settle();
  expect(calls).toEqual([]);
});

it("sends a user's change once, and nothing without a signed-in user", async () => {
  saveSyncedPreference('language', 'nl');
  await settle();
  expect(calls).toEqual([]);
  setSyncedPreferencesUser('u1');
  saveSyncedPreference('language', 'nl');
  await settle();
  saveSyncedPreference('language', 'nl');
  await settle();
  expect(calls).toEqual([
    expect.objectContaining({
      op: 'syncedState.set',
      payload: { scope: 'user:u1', key: 'language', value: 'nl' },
    }),
  ]);
});
