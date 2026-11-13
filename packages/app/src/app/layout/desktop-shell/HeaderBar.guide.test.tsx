import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { usePageGuideStore } from '@features/page-guides/model/page-guides';
import {
  getFirstSteps,
  hideFirstSteps,
  resetFirstStepsForTests,
  startFirstSteps,
} from '@shared/lib/first-steps/first-steps';
import { SidebarProvider } from '@shared/ui/sidebar';
import { flushSyncedState, resetSyncedRuntime, SyncedRuntimeProvider } from '@/test/synced-runtime';
import { HeaderBar } from './HeaderBar';

vi.mock('@shared/runtime/global', async () => (await import('@/test/synced-runtime')).globalMock());
vi.mock('@shared/runtime/runtime-provider', async () =>
  (await import('@/test/synced-runtime')).runtimeProviderMock()
);
vi.mock('@entities/user/api/useAuth', async (importActual) => ({
  ...(await importActual<object>()),
  useProfile: () => ({ data: { id: 'u1' } }),
}));
vi.mock('@widgets/sync-status/ConnectivityStatus', () => ({ ConnectivityStatus: () => null }));

beforeEach(() => {
  localStorage.clear();
  resetSyncedRuntime();
  resetFirstStepsForTests();
  usePageGuideStore.setState({ request: null });
});

const renderAt = async (path: string) => {
  render(
    <SyncedRuntimeProvider>
      <MemoryRouter initialEntries={[path]}>
        <SidebarProvider>
          <HeaderBar breadcrumbs={[]} />
        </SidebarProvider>
      </MemoryRouter>
    </SyncedRuntimeProvider>
  );
  await flushSyncedState();
};

it('offers "Show first steps" on the Budget page while the list is hidden', async () => {
  startFirstSteps('space-1', 'u1');
  hideFirstSteps('space-1');
  await renderAt('/budgeting');
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'How this works' }));
  await user.click(await screen.findByRole('menuitem', { name: 'Show first steps' }));
  expect(getFirstSteps('space-1')?.dismissed).toBe(false);
});

it('opens the guide directly while the list is showing', async () => {
  startFirstSteps('space-1', 'u1');
  await renderAt('/budgeting');
  await userEvent.setup().click(screen.getByRole('button', { name: 'How this works' }));
  expect(screen.queryByRole('menuitem', { name: 'Show first steps' })).toBeNull();
  expect(usePageGuideStore.getState().request?.id).toBe('budget');
});

it('offers nothing extra on other pages', async () => {
  startFirstSteps('space-1', 'u1');
  hideFirstSteps('space-1');
  await renderAt('/accounts');
  await userEvent.setup().click(screen.getByRole('button', { name: 'How this works' }));
  expect(screen.queryByRole('menuitem', { name: 'Show first steps' })).toBeNull();
  expect(usePageGuideStore.getState().request?.id).toBe('accounts');
});
