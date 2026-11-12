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
import { MobileTopBar } from './MobileTopBar';

vi.mock('@shared/runtime/runtime-provider', () => ({
  useActiveSpace: () => ({ role: 'owner' }),
  useActiveSpaceId: () => 'space-1',
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
      <MemoryRouter initialEntries={[path]}>
        <MobileTopBar />
      </MemoryRouter>
    );
    expect(screen.getByRole('button', { name: 'How this works' })).toBeVisible();
  }
);

it('has no button where there is no guide', () => {
  render(
    <MemoryRouter initialEntries={['/settings/about']}>
      <MobileTopBar />
    </MemoryRouter>
  );
  expect(screen.queryByRole('button', { name: 'How this works' })).toBeNull();
});

describe('"Show first steps" in the Help menu', () => {
  beforeEach(() => {
    localStorage.clear();
    resetFirstStepsForTests();
  });

  const renderAt = (path: string) =>
    render(
      <MemoryRouter initialEntries={[path]}>
        <MobileTopBar />
      </MemoryRouter>
    );

  it('is offered on the Budget page while the list is hidden, and brings it back', async () => {
    startFirstSteps('space-1');
    hideFirstSteps('space-1');
    renderAt('/budgeting');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'How this works' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Show first steps' }));
    expect(getFirstSteps('space-1')?.dismissed).toBe(false);
  });

  it('is not offered while the list is showing: the button opens the guide directly', async () => {
    startFirstSteps('space-1');
    usePageGuideStore.setState({ request: null });
    renderAt('/budgeting');
    await userEvent.setup().click(screen.getByRole('button', { name: 'How this works' }));
    expect(screen.queryByRole('menuitem', { name: 'Show first steps' })).toBeNull();
    expect(usePageGuideStore.getState().request?.id).toBe('budget');
  });
});
