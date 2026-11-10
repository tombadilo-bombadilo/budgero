import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { GetMonthlyBudgetRow } from '@budgero/core/browser';
import {
  getFirstSteps,
  markFirstStep,
  resetFirstStepsForTests,
  startFirstSteps,
} from '@shared/lib/first-steps/first-steps';
import { FirstStepsCard } from './FirstStepsCard';

const { toastSuccess } = vi.hoisted(() => ({ toastSuccess: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: toastSuccess } }));
vi.mock('@shared/runtime/runtime-provider', () => ({ useActiveSpaceId: () => 'space-1' }));

const row = (assigned: number) => ({ Assigned: assigned }) as unknown as GetMonthlyBudgetRow;

function card(
  readyToAssign: number,
  rows: GetMonthlyBudgetRow[],
  extra: { settled?: boolean; variant?: 'card' | 'bar' } = {}
) {
  return (
    <MemoryRouter>
      <FirstStepsCard
        readyToAssign={readyToAssign}
        readyToAssignLabel="€2,340.00"
        rows={rows}
        {...extra}
      />
    </MemoryRouter>
  );
}

function renderCard(
  readyToAssign: number,
  rows: GetMonthlyBudgetRow[],
  extra: { settled?: boolean; variant?: 'card' | 'bar' } = {}
) {
  return render(card(readyToAssign, rows, extra));
}

beforeEach(() => {
  localStorage.clear();
  resetFirstStepsForTests();
  toastSuccess.mockReset();
});

it('shows nothing for a workspace that did not start the checklist', () => {
  renderCard(2_340_000, []);
  expect(screen.queryByTestId('first-steps')).toBeNull();
});

it('guides the first assignment with the real amount', () => {
  startFirstSteps('space-1');
  renderCard(2_340_000, [row(0)]);
  expect(screen.getByText('Your first steps')).toBeInTheDocument();
  expect(screen.getByText('€2,340.00')).toBeInTheDocument();
  expect(screen.getByText('0 of 3 done')).toBeInTheDocument();
});

it('ticks the first step when Ready to Assign reaches zero after assigning', () => {
  startFirstSteps('space-1');
  const { rerender } = renderCard(0, [row(0)]);
  expect(getFirstSteps('space-1')?.done.assign).toBe(false);
  rerender(
    <MemoryRouter>
      <FirstStepsCard readyToAssign={0} readyToAssignLabel="€0.00" rows={[row(2_340_000)]} />
    </MemoryRouter>
  );
  expect(getFirstSteps('space-1')?.done.assign).toBe(true);
  expect(toastSuccess).toHaveBeenCalledTimes(1);
  expect(screen.getByText('Add a transaction')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Go to transactions' })).toHaveAttribute(
    'href',
    '/accounts/all'
  );
});

it('can be hidden', () => {
  startFirstSteps('space-1');
  renderCard(100, [row(0)]);
  fireEvent.click(screen.getByRole('button', { name: 'Hide first steps' }));
  expect(screen.queryByTestId('first-steps')).toBeNull();
});

it('offers sharing as an optional step that does not count toward the three', () => {
  startFirstSteps('space-1');
  renderCard(100, [row(0)]);
  const link = screen.getByRole('link', { name: 'Invite someone' });
  expect(link).toHaveAttribute('href', '/settings/workspaces');
  // Opening the invite page isn't inviting anyone.
  fireEvent.click(link);
  expect(getFirstSteps('space-1')?.done.share).toBeFalsy();
  // An invite that was created is (useCreateSpaceInvite marks it).
  act(() => markFirstStep('space-1', 'share'));
  expect(getFirstSteps('space-1')?.done.share).toBe(true);
  expect(screen.queryByRole('link', { name: 'Invite someone' })).toBeNull();
  expect(screen.getByText('0 of 3 done')).toBeInTheDocument();
});

it('with nothing to assign yet, says so and shows the next thing to do', () => {
  startFirstSteps('space-1');
  renderCard(0, [row(0)]);
  expect(screen.getByText(/Nothing to assign yet/)).toBeInTheDocument();
  expect(screen.queryByText(/to assign\. Type an amount/)).toBeNull();
  // The transaction step is open with its action, not hidden behind step 1.
  expect(screen.getByRole('link', { name: 'Go to transactions' })).toBeInTheDocument();
  expect(getFirstSteps('space-1')?.done.assign).toBe(false);
});

it("doesn't tick from a loading default or last month's placeholder", () => {
  startFirstSteps('space-1');
  const { rerender } = renderCard(0, [row(500_000)], { settled: false });
  expect(getFirstSteps('space-1')?.done.assign).toBe(false);
  expect(toastSuccess).not.toHaveBeenCalled();
  rerender(card(0, [row(500_000)], { settled: true }));
  expect(getFirstSteps('space-1')?.done.assign).toBe(true);
});

describe('on a phone', () => {
  it('is one compact row that opens the full list', () => {
    startFirstSteps('space-1');
    renderCard(2_340_000, [row(0)], { variant: 'bar' });
    const bar = screen.getByTestId('first-steps');
    expect(bar.tagName).toBe('BUTTON');
    expect(bar).toHaveTextContent('Give every coin a job');
    expect(bar).toHaveTextContent('0/3');
    expect(screen.queryByText('Budget with someone?')).toBeNull();
    fireEvent.click(bar);
    expect(screen.getByText('Budget with someone?')).toBeInTheDocument();
    // Phone wording: no "Assigned column" there.
    expect(screen.getByText(/Tap a category and enter an amount/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Hide first steps' }));
    expect(getFirstSteps('space-1')?.dismissed).toBe(true);
  });

  it('goes away on its own once all three are done', () => {
    vi.useFakeTimers();
    try {
      startFirstSteps('space-1');
      for (const step of ['assign', 'transaction', 'return'] as const)
        markFirstStep('space-1', step);
      renderCard(0, [row(100)], { variant: 'bar' });
      expect(screen.getByTestId('first-steps')).toHaveTextContent('You’re set up');
      act(() => vi.advanceTimersByTime(5000));
      expect(getFirstSteps('space-1')?.dismissed).toBe(true);
      expect(screen.queryByTestId('first-steps')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

it('the desktop card also goes away on its own once all three are done', () => {
  vi.useFakeTimers();
  try {
    startFirstSteps('space-1');
    for (const step of ['assign', 'transaction', 'return'] as const) markFirstStep('space-1', step);
    renderCard(0, [row(100)]);
    expect(screen.getByTestId('first-steps')).toHaveTextContent('You’re set up');
    act(() => vi.advanceTimersByTime(5000));
    expect(getFirstSteps('space-1')?.dismissed).toBe(true);
    expect(screen.queryByTestId('first-steps')).toBeNull();
  } finally {
    vi.useRealTimers();
  }
});
