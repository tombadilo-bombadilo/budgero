import { act, renderHook } from '@testing-library/react';
import {
  flushSyncedState,
  receiveSyncedState,
  resetSyncedRuntime,
  SyncedRuntimeProvider,
  syncedWrites,
} from '@/test/synced-runtime';
import { ACCOUNT_SHORT_LIST_KEY } from './account-short-list';
import { useAccountShortList } from './useAccountShortList';

vi.mock('@shared/runtime/global', async () => (await import('@/test/synced-runtime')).globalMock());
vi.mock('@shared/runtime/runtime-provider', async () =>
  (await import('@/test/synced-runtime')).runtimeProviderMock()
);
vi.mock('@entities/user/api/useAuth', () => ({
  useProfile: () => ({ data: { id: 'u1' } }),
}));

beforeEach(() => {
  localStorage.clear();
  resetSyncedRuntime();
});

it('pins and unpins through one synced merge each, per user', async () => {
  const { result } = renderHook(() => useAccountShortList(), { wrapper: SyncedRuntimeProvider });
  await flushSyncedState();
  expect(result.current.canEdit).toBe(true);
  expect(result.current.pinnedIds.size).toBe(0);

  await act(async () => result.current.togglePinned(12));
  await flushSyncedState();
  expect([...result.current.pinnedIds]).toEqual([12]);

  await act(async () => result.current.togglePinned(12));
  await flushSyncedState();
  expect(result.current.pinnedIds.size).toBe(0);

  const writes = syncedWrites(ACCOUNT_SHORT_LIST_KEY);
  expect(writes.map((call) => call.op)).toEqual(['syncedState.merge', 'syncedState.merge']);
  expect(writes[0]!.payload).toMatchObject({ scope: 'user:u1', patch: { set: { 12: true } } });
  expect(writes[1]!.payload).toMatchObject({ patch: { remove: ['12'] } });
});

it('shows pins made on another device', async () => {
  const { result } = renderHook(() => useAccountShortList(), { wrapper: SyncedRuntimeProvider });
  await flushSyncedState();
  await receiveSyncedState('user:u1', ACCOUNT_SHORT_LIST_KEY, { 3: true, 9: true });
  expect([...result.current.pinnedIds].sort()).toEqual([3, 9]);
});
