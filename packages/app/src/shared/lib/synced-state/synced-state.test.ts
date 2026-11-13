import { setDemoSpaceId } from '@shared/lib/demo-space';
import {
  budgetScope,
  mergeSyncedState,
  readSyncedState,
  readSyncedStateCache,
  setSyncedState,
  syncedStateWriteBlocker,
  userScope,
  writeSyncedStateCache,
  type SyncedStateRuntime,
} from './synced-state';

vi.mock('@shared/runtime/global', () => ({ getRuntime: () => null }));

function fakeRuntime(stored: Record<string, unknown> = {}, spaceId: string | null = 'space-1') {
  const calls: { op: string; payload: Record<string, unknown> }[] = [];
  const runtime: SyncedStateRuntime = {
    services: () => ({
      syncedState: { get: (scope: string, key: string) => stored[`${scope}|${key}`] },
    }),
    getActiveSpaceId: () => spaceId,
    isInitialized: () => true,
    executeMutation: async (spec) => {
      calls.push({ op: spec.op, payload: spec.payload });
      return { result: undefined as never };
    },
  };
  return { runtime, calls };
}

beforeEach(() => {
  localStorage.clear();
  setDemoSpaceId(null);
});

it('builds scopes', () => {
  expect(userScope('u1')).toBe('user:u1');
  expect(budgetScope(4)).toBe('budget:4');
});

it('sends a set through the synced op, without undo', async () => {
  const { runtime, calls } = fakeRuntime();
  expect(await setSyncedState('workspace', 'k', { a: 1 }, runtime)).toBe(true);
  expect(calls).toEqual([
    { op: 'syncedState.set', payload: { scope: 'workspace', key: 'k', value: { a: 1 } } },
  ]);
});

it('sends nothing when the value is unchanged', async () => {
  const { runtime, calls } = fakeRuntime({ 'workspace|k': { a: 1 } });
  expect(await setSyncedState('workspace', 'k', { a: 1 }, runtime)).toBe(false);
  expect(await setSyncedState('workspace', 'gone', null, runtime)).toBe(false);
  expect(calls).toEqual([]);
});

it('sends only the entries a merge changes, nothing when none do', async () => {
  const { runtime, calls } = fakeRuntime({ 'workspace|m': { a: 1, b: 2 } });
  expect(await mergeSyncedState('workspace', 'm', { set: { a: 1 }, remove: ['z'] }, runtime)).toBe(
    false
  );
  expect(
    await mergeSyncedState('workspace', 'm', { set: { a: 1, c: 3 }, remove: ['b'] }, runtime)
  ).toBe(true);
  expect(calls).toEqual([
    {
      op: 'syncedState.merge',
      payload: { scope: 'workspace', key: 'm', patch: { set: { c: 3 }, remove: ['b'] } },
    },
  ]);
});

it('refuses writes when the open workspace holds only demo-seeded budgets', async () => {
  const { runtime, calls } = fakeRuntime();
  const services = runtime.services() as Record<string, unknown>;
  const marked = { Metadata: JSON.stringify({ demo_budget: true }) };
  runtime.services = () => ({
    ...services,
    budgets: { getAllBudgets: () => [{ ID: 1 }, { ID: 2 }] },
    accounts: { listAccounts: (id: number) => (id === 1 ? [marked] : [marked, {}]) },
  });
  expect(syncedStateWriteBlocker(runtime)).toBe('demo');
  expect(await setSyncedState('workspace', 'k', 1, runtime)).toBe(false);
  // A budget of the user's own in the same workspace: not the demo.
  runtime.services = () => ({
    ...services,
    budgets: { getAllBudgets: () => [{ ID: 1 }, { ID: 2 }] },
    accounts: { listAccounts: (id: number) => (id === 1 ? [marked] : [{}]) },
  });
  expect(syncedStateWriteBlocker(runtime)).toBeNull();
  expect(calls).toEqual([]);
});

it('writes nothing in the demo workspace or with no workspace open', async () => {
  setDemoSpaceId('space-1');
  const demo = fakeRuntime();
  expect(syncedStateWriteBlocker(demo.runtime)).toBe('demo');
  expect(await setSyncedState('workspace', 'k', 1, demo.runtime)).toBe(false);
  expect(await mergeSyncedState('workspace', 'k', { set: { a: 1 } }, demo.runtime)).toBe(false);
  expect(demo.calls).toEqual([]);

  const none = fakeRuntime({}, null);
  expect(syncedStateWriteBlocker(none.runtime)).toBe('no-workspace');
  expect(await setSyncedState('workspace', 'k', 1, none.runtime)).toBe(false);
  expect(syncedStateWriteBlocker(null)).toBe('no-runtime');
});

it('reads as unavailable without a synced store', () => {
  const { runtime } = fakeRuntime();
  expect(readSyncedState('workspace', 'k', { ...runtime, services: () => ({}) })).toEqual({
    available: false,
    value: undefined,
  });
  expect(readSyncedState('workspace', 'missing', runtime)).toEqual({
    available: true,
    value: undefined,
  });
});

it('caches values per workspace and drops deleted ones', () => {
  writeSyncedStateCache('s1', 'user:u1', 'k', { x: 1 });
  expect(readSyncedStateCache('s1', 'user:u1', 'k')).toEqual({ x: 1 });
  expect(readSyncedStateCache('s2', 'user:u1', 'k')).toBeUndefined();
  writeSyncedStateCache('s1', 'user:u1', 'k', null);
  expect(readSyncedStateCache('s1', 'user:u1', 'k')).toBeUndefined();
});
