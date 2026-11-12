import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { resetFirstStepsForTests, startFirstSteps } from '@shared/lib/first-steps/first-steps';
import { markPageGuideSeen, openPageGuide, usePageGuideStore } from '../model/page-guides';
import { PageGuideHost } from './PageGuideHost';

const { track, profile, demo } = vi.hoisted(() => ({
  track: vi.fn(),
  profile: { current: undefined as { id: string; created_at: string } | undefined },
  demo: { current: { isDemo: false, checking: false } },
}));
vi.mock('@shared/lib/analytics/track', () => ({ track }));
vi.mock('@entities/user/api/useAuth', () => ({ useProfile: () => ({ data: profile.current }) }));
vi.mock('@features/demo-budget/lib/useIsDemoSpace', () => ({
  useDemoSpaceStatus: () => demo.current,
}));
vi.mock('@shared/runtime/runtime-provider', () => ({ useActiveSpaceId: () => 'space-1' }));

const recent = () => new Date().toISOString();
const longAgo = () => new Date(Date.now() - 400 * 86_400_000).toISOString();

function renderHost(path = '/budgeting') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <PageGuideHost />
    </MemoryRouter>
  );
}

const settle = () => act(() => vi.advanceTimersByTime(1500));

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  resetFirstStepsForTests();
  usePageGuideStore.setState({ request: null });
  track.mockReset();
  profile.current = { id: 'u1', created_at: recent() };
  demo.current = { isDemo: false, checking: false };
});

afterEach(() => {
  vi.useRealTimers();
});

it('opens the page’s guide on a new user’s first visit, once', () => {
  const { unmount } = renderHost();
  settle();
  expect(screen.getByRole('dialog', { name: 'Give every coin a job' })).toBeInTheDocument();
  expect(track).toHaveBeenCalledWith('page_guide_shown', { guide: 'budget' });

  fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(track).toHaveBeenCalledWith('page_guide_skipped', { guide: 'budget' });
  unmount();

  renderHost();
  settle();
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('shows nothing by itself to someone who used Budgero before', () => {
  profile.current = { id: 'u1', created_at: longAgo() };
  renderHost();
  settle();
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('counts a workspace set up from scratch on this device as new', () => {
  profile.current = { id: 'u1', created_at: longAgo() };
  startFirstSteps('space-1');
  renderHost('/dashboard');
  settle();
  expect(screen.getByRole('dialog', { name: 'Your money at a glance' })).toBeInTheDocument();
});

it('stays closed in the demo and while the demo check is pending', () => {
  demo.current = { isDemo: true, checking: false };
  const { unmount } = renderHost();
  settle();
  expect(screen.queryByRole('dialog')).toBeNull();
  unmount();
  demo.current = { isDemo: false, checking: true };
  renderHost();
  settle();
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('does not open a guide the user has seen, or on a page without one', () => {
  markPageGuideSeen('u1', 'budget');
  const { unmount } = renderHost();
  settle();
  expect(screen.queryByRole('dialog')).toBeNull();
  unmount();
  renderHost('/settings/appearance');
  settle();
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('waits for another open dialog to close first', () => {
  const other = document.createElement('div');
  other.setAttribute('role', 'dialog');
  other.setAttribute('data-state', 'open');
  document.body.appendChild(other);
  renderHost('/accounts/all');
  settle();
  expect(screen.queryByTestId('page-guide')).toBeNull();
  other.remove();
  act(() => vi.advanceTimersByTime(300));
  expect(screen.getByRole('dialog', { name: 'Add a transaction' })).toBeInTheDocument();
});

it('opens the transactions guide on one register only, not again on another', () => {
  const { unmount } = renderHost('/accounts/all');
  settle();
  expect(screen.getByRole('dialog', { name: 'Add a transaction' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
  expect(track).toHaveBeenCalledWith('page_guide_skipped', { guide: 'transactions' });
  unmount();
  renderHost('/accounts/5');
  settle();
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('gives the accounts overview its own guide', () => {
  markPageGuideSeen('u1', 'transactions');
  renderHost('/accounts');
  settle();
  expect(screen.getByRole('dialog', { name: 'Add an account' })).toBeInTheDocument();
});

it.each([
  ['/settings/rules', 'What a rule does'],
  ['/settings/recurring', 'Bills and pay on a schedule'],
  ['/settings/imports', 'Bring in a file from your bank'],
  ['/settings/workspaces', 'Workspaces hold budgets'],
  ['/settings/security', 'Only you can read your budget'],
  ['/settings/currencies', 'One budget, many currencies'],
])('opens a guide on %s', (path, title) => {
  renderHost(path);
  settle();
  expect(screen.getByRole('dialog', { name: title })).toBeInTheDocument();
});

it('reopens on request at a given card, also for existing users', () => {
  profile.current = { id: 'u1', created_at: longAgo() };
  renderHost();
  act(() => openPageGuide('budget', { card: 'goals' }));
  expect(screen.getByRole('dialog', { name: 'Goals' })).toBeInTheDocument();
  expect(screen.getByText('Step 3 of 4')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Back' }));
  expect(screen.getByRole('dialog', { name: 'Assigned, Activity, Available' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  expect(screen.queryByRole('button', { name: 'Skip' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Done' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(track).toHaveBeenCalledWith('page_guide_completed', { guide: 'budget' });
});

it('closes with Escape as skipped', () => {
  renderHost('/reports');
  settle();
  expect(screen.getByRole('dialog', { name: 'Reports answer questions' })).toBeInTheDocument();
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(track).toHaveBeenCalledWith('page_guide_skipped', { guide: 'reports' });
});
