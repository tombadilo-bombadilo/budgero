import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { setDemoSpaceId } from '@shared/lib/demo-space';
import { TrialEndingBanner } from './TrialEndingBanner';

const { store, calls, env, client } = vi.hoisted(() => ({
  store: new Map<string, unknown>(),
  calls: [] as { op: string; payload: Record<string, unknown> }[],
  env: { initialized: true, trialEndsAt: '' },
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
    const { scope, key, value } = spec.payload as { scope: string; key: string; value: unknown };
    store.set(`${scope}|${key}`, value);
    await client.current.invalidateQueries({ queryKey: ['syncedState'] });
    return { result: undefined };
  },
};

vi.mock('@shared/lib/env', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  IS_SELF_HOSTABLE_BUILD: false,
}));
vi.mock('@shared/runtime/global', () => ({ getRuntime: () => runtime }));
vi.mock('@shared/runtime/runtime-provider', () => ({
  useRuntime: () => runtime,
  useRuntimeInitialized: () => env.initialized,
  useRuntimeState: () => (env.initialized ? 'Ready' : 'Initializing'),
  useActiveSpaceId: () => 'space-1',
}));
vi.mock('@entities/user/api/useAuth', () => ({
  useProfile: () => ({
    data: { id: 'u1', subscription_status: 'trialing', trial_ends_at: env.trialEndsAt },
  }),
}));

const KEY = 'user:u1|trialEndingDismissed';
const banner = () => screen.queryByText(/left in your trial/);

function view() {
  return (
    <QueryClientProvider client={client.current}>
      <MemoryRouter>
        <TrialEndingBanner />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function renderBanner() {
  client.current = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(view());
}

beforeEach(() => {
  localStorage.clear();
  setDemoSpaceId(null);
  store.clear();
  calls.length = 0;
  env.initialized = true;
  env.trialEndsAt = new Date(Date.now() + 36 * 3_600_000).toISOString();
});

it('shows in the trial’s last days and writes nothing on load', async () => {
  renderBanner();
  await waitFor(() => expect(banner()).toBeInTheDocument());
  expect(calls).toEqual([]);
});

it('stays hidden until the synced state is read', async () => {
  store.set(KEY, env.trialEndsAt);
  env.initialized = false;
  const { rerender } = renderBanner();
  expect(banner()).not.toBeInTheDocument();
  env.initialized = true;
  rerender(view());
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  expect(banner()).not.toBeInTheDocument();
});

it('syncs a dismissal for this trial end with one write', async () => {
  renderBanner();
  await waitFor(() => expect(banner()).toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss banner' }));
  expect(banner()).not.toBeInTheDocument();
  await waitFor(() => expect(calls).toHaveLength(1));
  expect(calls[0]!.payload).toEqual({
    scope: 'user:u1',
    key: 'trialEndingDismissed',
    value: env.trialEndsAt,
  });
});

it('shows again for a new trial end', async () => {
  store.set(KEY, new Date(Date.now() - 86_400_000).toISOString());
  renderBanner();
  await waitFor(() => expect(banner()).toBeInTheDocument());
});

it('moves a dismissal from this device into the synced state once', async () => {
  // The server's spelling (no milliseconds), as older builds read it.
  const serverIso = env.trialEndsAt.replace('.000Z', 'Z').replace(/\.\d{3}Z$/, 'Z');
  env.trialEndsAt = serverIso;
  localStorage.setItem(`budgero:trial_ending_dismissed:${serverIso}`, '1');
  const first = renderBanner();
  await waitFor(() => expect(calls).toHaveLength(1));
  expect(banner()).not.toBeInTheDocument();
  expect(calls[0]!.payload.value).toBe(new Date(serverIso).toISOString());
  first.unmount();
  renderBanner();
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  expect(calls).toHaveLength(1);
});
