import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import {
  getFirstSteps,
  hideFirstSteps,
  resetFirstStepsForTests,
  startFirstSteps,
} from '@shared/lib/first-steps/first-steps';
import {
  flushSyncedState,
  receiveSyncedState,
  resetSyncedRuntime,
  SyncedRuntimeProvider,
} from '@/test/synced-runtime';
import { FirstStepsSettingsCard } from '../ui/FirstStepsSettingsCard';
import { isFirstStepsHidden, showFirstSteps, useShowFirstStepsMenuItems } from './visibility';

vi.mock('@shared/runtime/global', async () => (await import('@/test/synced-runtime')).globalMock());
vi.mock('@shared/runtime/runtime-provider', async () =>
  (await import('@/test/synced-runtime')).runtimeProviderMock()
);
vi.mock('@entities/user/api/useAuth', () => ({ useProfile: () => ({ data: { id: 'u1' } }) }));

const at =
  (path: string) =>
  ({ children }: { children: ReactNode }) => (
    <SyncedRuntimeProvider>
      <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>
    </SyncedRuntimeProvider>
  );

const start = () => startFirstSteps('space-1', 'u1');

beforeEach(() => {
  localStorage.clear();
  resetSyncedRuntime();
  resetFirstStepsForTests();
});

it('showFirstSteps() and isFirstStepsHidden() work on the open workspace', () => {
  expect(isFirstStepsHidden()).toBe(false);
  showFirstSteps(); // no list: nothing appears
  expect(getFirstSteps('space-1')).toBeNull();
  start();
  hideFirstSteps('space-1');
  expect(isFirstStepsHidden()).toBe(true);
  showFirstSteps();
  expect(isFirstStepsHidden()).toBe(false);
});

describe('the Help menu item', () => {
  it('is offered on the Budget page while the list is hidden, and brings it back', async () => {
    start();
    const { result } = renderHook(() => useShowFirstStepsMenuItems(), {
      wrapper: at('/budgeting'),
    });
    await flushSyncedState();
    expect(result.current).toEqual([]);
    act(() => hideFirstSteps('space-1'));
    expect(result.current).toEqual([
      { key: 'first-steps', label: 'Show first steps', onSelect: expect.any(Function) },
    ]);
    act(() => result.current[0].onSelect());
    expect(getFirstSteps('space-1')?.dismissed).toBe(false);
    expect(result.current).toEqual([]);
  });

  it('is not offered on other pages or for a workspace without a list', async () => {
    const { result } = renderHook(() => useShowFirstStepsMenuItems(), {
      wrapper: at('/budgeting'),
    });
    await flushSyncedState();
    expect(result.current).toEqual([]);
    start();
    hideFirstSteps('space-1');
    const other = renderHook(() => useShowFirstStepsMenuItems(), { wrapper: at('/accounts') });
    await flushSyncedState();
    expect(other.result.current).toEqual([]);
  });

  it('is offered once the list was hidden on another device', async () => {
    const { result } = renderHook(() => useShowFirstStepsMenuItems(), {
      wrapper: at('/budgeting'),
    });
    await receiveSyncedState('user:u1', 'firstSteps', {
      startedOn: '2026-11-01',
      dismissed: true,
    });
    expect(result.current).toHaveLength(1);
  });
});

describe('Budget Settings', () => {
  it('shows nothing for a workspace without a list', async () => {
    render(<FirstStepsSettingsCard />, { wrapper: at('/settings') });
    await flushSyncedState();
    expect(screen.queryByText('First steps')).toBeNull();
  });

  it('switches the list off and on', async () => {
    start();
    render(<FirstStepsSettingsCard />, { wrapper: at('/settings') });
    await flushSyncedState();
    const toggle = screen.getByRole('switch', { name: 'Show first steps on the Planning page' });
    expect(toggle).toBeChecked();
    fireEvent.click(toggle);
    expect(getFirstSteps('space-1')?.dismissed).toBe(true);
    expect(toggle).not.toBeChecked();
    fireEvent.click(toggle);
    expect(getFirstSteps('space-1')?.dismissed).toBe(false);
  });
});
