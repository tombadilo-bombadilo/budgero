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
import { HeaderBar } from './HeaderBar';

vi.mock('@shared/runtime/runtime-provider', () => ({ useActiveSpaceId: () => 'space-1' }));
vi.mock('@widgets/sync-status/ConnectivityStatus', () => ({ ConnectivityStatus: () => null }));

beforeEach(() => {
  localStorage.clear();
  resetFirstStepsForTests();
  usePageGuideStore.setState({ request: null });
});

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <SidebarProvider>
        <HeaderBar breadcrumbs={[]} />
      </SidebarProvider>
    </MemoryRouter>
  );

it('offers "Show first steps" on the Budget page while the list is hidden', async () => {
  startFirstSteps('space-1');
  hideFirstSteps('space-1');
  renderAt('/budgeting');
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'How this works' }));
  await user.click(await screen.findByRole('menuitem', { name: 'Show first steps' }));
  expect(getFirstSteps('space-1')?.dismissed).toBe(false);
});

it('opens the guide directly while the list is showing', async () => {
  startFirstSteps('space-1');
  renderAt('/budgeting');
  await userEvent.setup().click(screen.getByRole('button', { name: 'How this works' }));
  expect(screen.queryByRole('menuitem', { name: 'Show first steps' })).toBeNull();
  expect(usePageGuideStore.getState().request?.id).toBe('budget');
});

it('offers nothing extra on other pages', async () => {
  startFirstSteps('space-1');
  hideFirstSteps('space-1');
  renderAt('/accounts');
  await userEvent.setup().click(screen.getByRole('button', { name: 'How this works' }));
  expect(screen.queryByRole('menuitem', { name: 'Show first steps' })).toBeNull();
  expect(usePageGuideStore.getState().request?.id).toBe('accounts');
});
