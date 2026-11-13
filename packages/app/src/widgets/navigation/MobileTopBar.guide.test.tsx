import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import {
  getFirstSteps,
  hideFirstSteps,
  resetFirstStepsForTests,
  startFirstSteps,
} from '@shared/lib/first-steps/first-steps';
import { usePageGuideStore } from '@features/page-guides/model/page-guides';
import { flushSyncedState, resetSyncedRuntime, SyncedRuntimeProvider } from '@/test/synced-runtime';
import { MobileTopBar } from './MobileTopBar';

vi.mock('@shared/runtime/global', async () => (await import('@/test/synced-runtime')).globalMock());
vi.mock('@shared/runtime/runtime-provider', async () => ({
  ...(await import('@/test/synced-runtime')).runtimeProviderMock(),
  useActiveSpace: () => ({ role: 'owner' }),
}));
vi.mock('@entities/user/api/useAuth', async (importActual) => ({
  ...(await importActual<object>()),
  useProfile: () => ({ data: { id: 'u1' } }),
}));
vi.mock('@widgets/sync-status/ConnectivityStatus', () => ({ ConnectivityStatus: () => null }));
vi.mock('@features/budget-management/ui/WorkspaceBudgetList', () => ({
  WorkspaceBudgetList: () => null,
}));
vi.mock('@features/budget-management', () => ({ default: () => null }));

it.each(['/budgeting', '/accounts/all', '/accounts/3', '/settings/rules', '/settings/imports'])(
  'shows the "How this works" button on %s',
  (path) => {
    render(
      <SyncedRuntimeProvider>
        <MemoryRouter initialEntries={[path]}>
          <MobileTopBar />
        </MemoryRouter>
      </SyncedRuntimeProvider>
    );
    expect(screen.getByRole('button', { name: 'How this works' })).toBeVisible();
  }
);

it('has no button where there is no guide', () => {
  render(
    <SyncedRuntimeProvider>
      <MemoryRouter initialEntries={['/settings/about']}>
        <MobileTopBar />
      </MemoryRouter>
    </SyncedRuntimeProvider>
  );
  expect(screen.queryByRole('button', { name: 'How this works' })).toBeNull();
});

describe('"Show first steps" in the Help menu', () => {
  beforeEach(() => {
    localStorage.clear();
    resetSyncedRuntime();
    resetFirstStepsForTests();
  });

  const renderAt = async (path: string) => {
    render(
      <SyncedRuntimeProvider>
        <MemoryRouter initialEntries={[path]}>
          <MobileTopBar />
        </MemoryRouter>
      </SyncedRuntimeProvider>
    );
    await flushSyncedState();
  };

  it('is offered on the Budget page while the list is hidden, and brings it back', async () => {
    startFirstSteps('space-1', 'u1');
    hideFirstSteps('space-1');
    await renderAt('/budgeting');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'How this works' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Show first steps' }));
    expect(getFirstSteps('space-1')?.dismissed).toBe(false);
  });

  it('is not offered while the list is showing: the button opens the guide directly', async () => {
    startFirstSteps('space-1', 'u1');
    usePageGuideStore.setState({ request: null });
    await renderAt('/budgeting');
    await userEvent.setup().click(screen.getByRole('button', { name: 'How this works' }));
    expect(screen.queryByRole('menuitem', { name: 'Show first steps' })).toBeNull();
    expect(usePageGuideStore.getState().request?.id).toBe('budget');
  });
});
