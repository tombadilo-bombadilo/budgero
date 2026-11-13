import { act, render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { setDemoSpaceId } from '@shared/lib/demo-space';
import { formatDateISO } from '@shared/lib/date-utils';
import { BankAutoSync } from './BankAutoSync';

const { store, calls, env, client, toast } = vi.hoisted(() => ({
  store: new Map<string, unknown>(),
  calls: [] as { op: string; payload: Record<string, unknown> }[],
  env: { initialized: true, userId: 'u1' as string | null },
  client: { current: null as unknown as import('@tanstack/react-query').QueryClient },
  toast: { warning: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

const soon = new Date(Date.now() + 2 * 86_400_000).toISOString();
const connection = {
  Provider: 'enable_banking',
  LastSyncAt: new Date().toISOString(),
  sessions: [{ sessionId: 's1', validUntil: soon, aspsp: { name: 'Bank A' } }],
};

const runtime = {
  services: () => ({
    syncedState: { get: (scope: string, key: string) => store.get(`${scope}|${key}`) },
    bankSync: { listConnections: () => [connection], listLinks: () => [{}] },
  }),
  getActiveSpaceId: () => 'space-1',
  isInitialized: () => env.initialized,
  waitForInitialSync: async () => ({ connected: false, synced: false }),
  executeMutation: async (spec: { op: string; payload: Record<string, unknown> }) => {
    calls.push(spec);
    const { scope, key, patch } = spec.payload as {
      scope: string;
      key: string;
      patch: { set: Record<string, unknown> };
    };
    const prev = (store.get(`${scope}|${key}`) as Record<string, unknown>) ?? {};
    store.set(`${scope}|${key}`, { ...prev, ...patch.set });
    await client.current.invalidateQueries({ queryKey: ['syncedState'] });
    return { result: undefined };
  },
};

vi.mock('sonner', () => ({ toast }));
vi.mock('@budgero/core/browser', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  parseEnableBankingConfig: (c: typeof connection) => ({ sessions: c.sessions }),
}));
vi.mock('../api/useBankSync', () => ({
  invalidateAfterBankSync: vi.fn(),
  useBankConnections: () => ({ data: [connection] }),
  useBankLinks: () => ({ data: [{}] }),
}));
vi.mock('../model/run-bank-sync', () => ({ isSyncDue: () => false, runBankSync: vi.fn() }));
vi.mock('@shared/store/useUiStore', () => ({
  useUiStore: (select: (state: unknown) => unknown) => select({ selectedBudget: { ID: 1 } }),
}));
vi.mock('@shared/runtime/global', () => ({ getRuntime: () => runtime }));
vi.mock('@shared/runtime/runtime-provider', () => ({
  useRuntime: () => runtime,
  useRuntimeInitialized: () => env.initialized,
  useRuntimeState: () => (env.initialized ? 'Ready' : 'Initializing'),
  useActiveSpaceId: () => 'space-1',
}));
vi.mock('@entities/user/api/useAuth', () => ({
  useProfile: () => ({ data: env.userId ? { id: env.userId } : undefined, isLoading: false }),
}));

const KEY = 'user:u1|bankExpiryReminders';
const today = () => formatDateISO(new Date());

function view() {
  return (
    <QueryClientProvider client={client.current}>
      <BankAutoSync />
    </QueryClientProvider>
  );
}

async function renderSync() {
  client.current = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const result = render(view());
  await settle();
  return result;
}

const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });

beforeEach(() => {
  localStorage.clear();
  setDemoSpaceId(null);
  store.clear();
  calls.length = 0;
  toast.warning.mockReset();
  env.initialized = true;
  env.userId = 'u1';
});

it('reminds once a day and records it for the user’s other devices with one write', async () => {
  const first = await renderSync();
  expect(toast.warning).toHaveBeenCalledTimes(1);
  expect(calls).toEqual([
    expect.objectContaining({
      op: 'syncedState.merge',
      payload: { scope: 'user:u1', key: 'bankExpiryReminders', patch: { set: { s1: today() } } },
    }),
  ]);
  first.unmount();
  await renderSync();
  expect(toast.warning).toHaveBeenCalledTimes(1);
  expect(calls).toHaveLength(1);
});

it('stays quiet when another device reminded today', async () => {
  store.set(KEY, { s1: today() });
  await renderSync();
  expect(toast.warning).not.toHaveBeenCalled();
  expect(calls).toEqual([]);
});

it('reminds again on a later day', async () => {
  store.set(KEY, { s1: '2020-01-01' });
  await renderSync();
  expect(toast.warning).toHaveBeenCalledTimes(1);
});

it('waits for the synced state before reminding', async () => {
  store.set(KEY, { s1: today() });
  env.initialized = false;
  const result = await renderSync();
  expect(toast.warning).not.toHaveBeenCalled();
  env.initialized = true;
  result.rerender(view());
  await settle();
  expect(toast.warning).not.toHaveBeenCalled();
});

it('moves today’s reminder from this device into the synced state once', async () => {
  localStorage.setItem('budgero.bankSync.expiryReminder', JSON.stringify({ s1: today() }));
  const first = await renderSync();
  expect(toast.warning).not.toHaveBeenCalled();
  expect(calls).toHaveLength(1);
  expect(calls[0]!.payload.patch).toEqual({ set: { s1: today() } });
  first.unmount();
  await renderSync();
  expect(calls).toHaveLength(1);
});
