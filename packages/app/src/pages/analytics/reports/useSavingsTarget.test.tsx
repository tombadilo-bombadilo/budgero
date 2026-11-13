import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { setDemoSpaceId } from '@shared/lib/demo-space';
import { useSavingsTarget } from './useSavingsTarget';

const { store, calls, env } = vi.hoisted(() => ({
  store: new Map<string, unknown>(),
  calls: [] as { op: string; payload: Record<string, unknown> }[],
  env: {
    initialized: true,
    spaceId: 'space-1' as string | null,
    spaces: [{ space_id: 'space-1' }] as { space_id: string }[],
    demo: false,
  },
}));

const runtime = {
  services: () => ({
    syncedState: { get: (scope: string, key: string) => store.get(`${scope}|${key}`) },
    budgets: { getAllBudgets: () => [{ ID: 1 }, { ID: 2 }] },
    accounts: {
      listAccounts: () => [{ Metadata: env.demo ? '{"demo_budget":true}' : '{}' }],
    },
  }),
  getActiveSpaceId: () => env.spaceId,
  isInitialized: () => env.initialized,
  executeMutation: async (spec: { op: string; payload: Record<string, unknown> }) => {
    calls.push(spec);
    const { scope, key, value } = spec.payload as { scope: string; key: string; value: unknown };
    store.set(`${scope}|${key}`, value);
    await client.invalidateQueries({ queryKey: ['syncedState'] });
    return { result: undefined };
  },
};

vi.mock('@shared/runtime/global', () => ({ getRuntime: () => runtime }));
vi.mock('@shared/runtime/runtime-provider', () => ({
  useRuntime: () => runtime,
  useRuntimeInitialized: () => env.initialized,
  useRuntimeState: () => (env.initialized ? 'Ready' : 'Initializing'),
  useActiveSpaceId: () => env.spaceId,
  useAvailableSpaces: () => env.spaces,
}));

let client: QueryClient;

function render(budgetId = 1) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(({ id }) => useSavingsTarget(id), { wrapper, initialProps: { id: budgetId } });
}

beforeEach(() => {
  localStorage.clear();
  setDemoSpaceId(null);
  store.clear();
  calls.length = 0;
  env.initialized = true;
  env.spaceId = 'space-1';
  env.spaces = [{ space_id: 'space-1' }];
  env.demo = false;
});

afterEach(() => {
  vi.useRealTimers();
});

it('reads the budget target from the synced store and writes nothing on load', async () => {
  store.set('budget:1|savingsTarget', 25);
  const { result } = render();
  await waitFor(() => expect(result.current.target).toBe(25));
  expect(calls).toEqual([]);
});

it('writes once when typing settles', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const { result } = render();
  await vi.waitFor(() => expect(result.current.target).toBeNull());
  act(() => result.current.setTarget('2'));
  act(() => result.current.setTarget('20'));
  expect(result.current.target).toBe(20);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(700);
  });
  expect(calls).toEqual([
    expect.objectContaining({
      op: 'syncedState.set',
      payload: { scope: 'budget:1', key: 'savingsTarget', value: 20 },
    }),
  ]);
  expect(result.current.target).toBe(20);
});

it('writes a pending edit when the report closes', async () => {
  const { result, unmount } = render();
  await waitFor(() => expect(result.current.target).toBeNull());
  act(() => result.current.setTarget('15'));
  unmount();
  await waitFor(() => expect(calls).toHaveLength(1));
  expect(calls[0]!.payload).toMatchObject({ scope: 'budget:1', value: 15 });
});

const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });

it('moves old values into the only workspace once, for budgets it has', async () => {
  localStorage.setItem('budgero.analytics.savingsTarget.1', '30');
  localStorage.setItem('budgero.analytics.savingsTarget.2', '10');
  localStorage.setItem('budgero.analytics.savingsTarget.7', '15');
  store.set('budget:2|savingsTarget', 40);
  // The demo, when the device knows it, doesn't count as a second workspace.
  setDemoSpaceId('demo-space');
  env.spaces = [{ space_id: 'space-1' }, { space_id: 'demo-space' }];
  const first = render();
  await waitFor(() => expect(first.result.current.target).toBe(30));
  expect(calls).toEqual([
    expect.objectContaining({
      op: 'syncedState.set',
      payload: { scope: 'budget:1', key: 'savingsTarget', value: 30 },
    }),
  ]);
  for (const id of [1, 2, 7]) {
    expect(localStorage.getItem(`budgero.analytics.savingsTarget.${id}`)).toBeNull();
  }
  first.unmount();
  render();
  await settle();
  expect(calls).toHaveLength(1);
});

it('drops old values when the user has two workspaces', async () => {
  localStorage.setItem('budgero.analytics.savingsTarget.1', '30');
  env.spaces = [{ space_id: 'space-1' }, { space_id: 'space-2' }];
  const { result } = render();
  await settle();
  expect(result.current.target).toBeNull();
  expect(localStorage.getItem('budgero.analytics.savingsTarget.1')).toBeNull();
  expect(calls).toEqual([]);
});

it('leaves old values alone while the demo is open', async () => {
  localStorage.setItem('budgero.analytics.savingsTarget.1', '30');
  // Not cached as the demo yet: its accounts carry the seed's marker.
  env.demo = true;
  render();
  await settle();
  expect(localStorage.getItem('budgero.analytics.savingsTarget.1')).toBe('30');
  expect(calls).toEqual([]);
});
