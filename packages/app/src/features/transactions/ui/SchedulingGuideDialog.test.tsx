import { act, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { setDemoSpaceId } from '@shared/lib/demo-space';
import {
  requestSchedulingGuide,
  useSchedulingGuideStore,
} from '@shared/store/useSchedulingGuideStore';
import { SchedulingGuideDialog } from './SchedulingGuideDialog';

const { store, calls, env, client } = vi.hoisted(() => ({
  store: new Map<string, unknown>(),
  calls: [] as { op: string; payload: Record<string, unknown> }[],
  env: { initialized: true, userId: 'u1' as string | null },
  client: { current: null as unknown as import('@tanstack/react-query').QueryClient },
}));

const runtime = {
  services: () => ({
    syncedState: { get: (scope: string, key: string) => store.get(`${scope}|${key}`) },
  }),
  getActiveSpaceId: () => 'space-1',
  isInitialized: () => env.initialized,
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

const SEEN = 'user:u1|schedulingGuidesSeen';
const title = () => screen.queryByRole('dialog', { name: /dated in the future/ });

function renderDialog() {
  client.current = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client.current}>
      <MemoryRouter>
        <SchedulingGuideDialog />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const settle = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(500);
  });

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  setDemoSpaceId(null);
  store.clear();
  calls.length = 0;
  env.initialized = true;
  env.userId = 'u1';
  useSchedulingGuideStore.setState({ request: null, pending: null });
});

afterEach(() => {
  vi.useRealTimers();
});

it('shows a budget’s guide once and records it as seen with one write', async () => {
  renderDialog();
  await settle();
  act(() => requestSchedulingGuide('future', 'space-1', 1));
  await settle();
  expect(title()).toBeInTheDocument();
  expect(calls).toEqual([
    expect.objectContaining({
      op: 'syncedState.merge',
      payload: {
        scope: 'user:u1',
        key: 'schedulingGuidesSeen',
        patch: { set: { 'future:1': true } },
      },
    }),
  ]);
  act(() => useSchedulingGuideStore.getState().dismiss());
  act(() => requestSchedulingGuide('future', 'space-1', 1));
  await settle();
  expect(title()).not.toBeInTheDocument();
  expect(calls).toHaveLength(1);
});

it('stays closed when another device has seen it', async () => {
  store.set(SEEN, { 'future:1': true });
  renderDialog();
  act(() => requestSchedulingGuide('future', 'space-1', 1));
  await settle();
  expect(title()).not.toBeInTheDocument();
  expect(calls).toEqual([]);
  // Cached now: the next request stops before reaching the dialog.
  act(() => requestSchedulingGuide('future', 'space-1', 1));
  expect(useSchedulingGuideStore.getState().request).toBeNull();
});

it('shows nothing before the synced list has loaded', async () => {
  store.set(SEEN, { 'future:1': true });
  env.initialized = false;
  const view = renderDialog();
  act(() => requestSchedulingGuide('future', 'space-1', 1));
  await settle();
  expect(title()).not.toBeInTheDocument();
  expect(useSchedulingGuideStore.getState().request).not.toBeNull();
  env.initialized = true;
  view.rerender(
    <QueryClientProvider client={client.current}>
      <MemoryRouter>
        <SchedulingGuideDialog />
      </MemoryRouter>
    </QueryClientProvider>
  );
  await settle();
  expect(title()).not.toBeInTheDocument();
  expect(useSchedulingGuideStore.getState().request).toBeNull();
});

it('writes guides seen on this device before syncing once, and nothing on a plain load', async () => {
  localStorage.setItem('budgero:scheduling-guide:future:space-1:1', '1');
  localStorage.setItem('budgero:scheduling-guide:future:space-1:2', '1');
  localStorage.setItem('budgero:scheduling-guide:future:other-space:3', '1');
  const first = renderDialog();
  await settle();
  expect(calls).toHaveLength(1);
  expect(calls[0]!.payload.patch).toEqual({ set: { 'future:1': true, 'future:2': true } });
  first.unmount();

  renderDialog();
  await settle();
  expect(calls).toHaveLength(1);
});

it('decides from the device cache alone without a profile', async () => {
  env.userId = null;
  renderDialog();
  act(() => requestSchedulingGuide('future', 'space-1', 4));
  await settle();
  expect(title()).toBeInTheDocument();
  expect(calls).toEqual([]);
});
