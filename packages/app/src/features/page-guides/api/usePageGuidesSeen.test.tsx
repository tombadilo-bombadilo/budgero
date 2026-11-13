import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { cachedSeenPageGuides, markPageGuideSeen } from '../model/page-guides';
import {
  PAGE_GUIDES_SEEN_QUERY,
  resetPageGuidesSeenForTests,
  usePageGuidesSeen,
} from './usePageGuidesSeen';

type Call = { op: string; payload: { userId: string; guides: string[] } };

const { db, calls, env, client } = vi.hoisted(() => ({
  // The workspace database: user id -> seen guide ids (a stand-in for PageGuidesService).
  db: { current: new Map<string, Set<string>>(), available: true },
  calls: [] as Call[],
  env: { spaceId: 'space-1' as string | null },
  client: { current: null as QueryClient | null },
}));

vi.mock('@shared/runtime/runtime-provider', () => ({
  useRuntime: () => ({
    services: () =>
      db.available
        ? { pageGuides: { getSeen: (u: string) => [...(db.current.get(u) ?? [])].sort() } }
        : {},
  }),
  useRuntimeInitialized: () => true,
  useRuntimeState: () => 'Ready',
  useActiveSpaceId: () => env.spaceId,
}));

vi.mock('@shared/runtime/mutation-router', () => ({
  executeSpaceMutation: async (_runtime: unknown, spec: Call) => {
    calls.push(spec);
    const { userId, guides } = spec.payload;
    const seen = db.current.get(userId) ?? new Set<string>();
    guides.forEach((g) => seen.add(g));
    db.current.set(userId, seen);
    // What the executor does with the op's `invalidates`.
    await client.current!.invalidateQueries({ queryKey: [PAGE_GUIDES_SEEN_QUERY] });
    return { added: guides };
  },
}));

function render(userId: string | null, canWrite = true) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.current = queryClient;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return renderHook(({ id, write }) => usePageGuidesSeen(id, write), {
    wrapper,
    initialProps: { id: userId, write: canWrite },
  });
}

const flush = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

beforeEach(() => {
  localStorage.clear();
  db.current = new Map();
  db.available = true;
  calls.length = 0;
  env.spaceId = 'space-1';
  resetPageGuidesSeenForTests();
});

it('is not ready, and seen is unknown, until the synced state has loaded', async () => {
  const { result } = render('u1');
  expect(result.current.ready).toBe(false);
  expect(result.current.isSeen('budget')).toBeNull();
  await waitFor(() => expect(result.current.ready).toBe(true));
  expect(result.current.isSeen('budget')).toBe(false);
});

it('counts a guide seen on another device and copies it into the cache', async () => {
  db.current.set('u1', new Set(['budget']));
  const { result } = render('u1');
  await waitFor(() => expect(result.current.ready).toBe(true));
  expect(result.current.isSeen('budget')).toBe(true);
  expect(cachedSeenPageGuides('u1')).toEqual(['budget']);
  expect(calls).toEqual([]);
});

it('moves cached guides into the synced state once, in one write', async () => {
  markPageGuideSeen('u1', 'budget');
  markPageGuideSeen('u1', 'home');
  db.current.set('u1', new Set(['home', 'reports']));
  const { result, rerender } = render('u1');
  await waitFor(() => expect(calls).toHaveLength(1));
  expect(calls[0]).toMatchObject({
    op: 'pageGuides.markSeen',
    payload: { userId: 'u1', guides: ['budget'] },
    meta: { skipUndo: true },
  });
  await flush();
  rerender({ id: 'u1', write: true });
  await flush();
  expect(calls).toHaveLength(1);
  expect([...db.current.get('u1')!].sort()).toEqual(['budget', 'home', 'reports']);
  expect(cachedSeenPageGuides('u1').sort()).toEqual(['budget', 'home', 'reports']);
  expect(result.current.isSeen('reports')).toBe(true);
});

it('writes nothing when everything is already synced', async () => {
  markPageGuideSeen('u1', 'budget');
  db.current.set('u1', new Set(['budget']));
  const { result } = render('u1');
  await waitFor(() => expect(result.current.ready).toBe(true));
  act(() => result.current.markSeen('budget'));
  await flush();
  expect(calls).toEqual([]);
});

it('writes a newly seen guide once, however often it is marked', async () => {
  const { result } = render('u1');
  await waitFor(() => expect(result.current.ready).toBe(true));
  act(() => {
    result.current.markSeen('rules');
    result.current.markSeen('rules');
  });
  await flush();
  act(() => result.current.markSeen('rules'));
  await flush();
  expect(calls.map((c) => c.payload)).toEqual([{ userId: 'u1', guides: ['rules'] }]);
});

it('keeps two members of a shared workspace apart', async () => {
  db.current.set('u2', new Set(['budget']));
  const first = render('u1');
  await waitFor(() => expect(first.result.current.ready).toBe(true));
  expect(first.result.current.isSeen('budget')).toBe(false);
  act(() => first.result.current.markSeen('home'));
  await flush();
  first.unmount();

  const second = render('u2');
  await waitFor(() => expect(second.result.current.ready).toBe(true));
  expect(second.result.current.isSeen('budget')).toBe(true);
  expect(second.result.current.isSeen('home')).toBe(false);
  expect([...db.current.get('u1')!]).toEqual(['home']);
  expect([...db.current.get('u2')!]).toEqual(['budget']);
});

it('writes nothing where it may not (demo, demo check pending)', async () => {
  markPageGuideSeen('u1', 'budget');
  const { result } = render('u1', false);
  await waitFor(() => expect(result.current.ready).toBe(true));
  act(() => result.current.markSeen('home'));
  await flush();
  expect(calls).toEqual([]);
  expect(cachedSeenPageGuides('u1')).toEqual(['budget', 'home']);
});

it('falls back to the cache when the database has no synced store', async () => {
  db.available = false;
  markPageGuideSeen('u1', 'budget');
  const { result } = render('u1');
  await waitFor(() => expect(result.current.ready).toBe(true));
  expect(result.current.isSeen('budget')).toBe(true);
  expect(result.current.isSeen('home')).toBe(false);
  act(() => result.current.markSeen('home'));
  await flush();
  expect(calls).toEqual([]);
});

it('is ready with the cache alone when no workspace is open', () => {
  env.spaceId = null;
  const { result } = render('u1');
  expect(result.current.ready).toBe(true);
  expect(result.current.isSeen('budget')).toBe(false);
});

it('marks a guide seen while loading and writes it once the list is known', async () => {
  const { result } = render('u1');
  act(() => result.current.markSeen('imports'));
  await waitFor(() => expect(calls).toHaveLength(1));
  expect(calls[0].payload).toEqual({ userId: 'u1', guides: ['imports'] });
});
