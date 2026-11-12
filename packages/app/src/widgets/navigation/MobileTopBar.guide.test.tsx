import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
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
