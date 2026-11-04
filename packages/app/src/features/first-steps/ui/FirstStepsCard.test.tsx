import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { GetMonthlyBudgetRow } from '@budgero/core/browser';
import {
  getFirstSteps,
  resetFirstStepsForTests,
  startFirstSteps,
} from '@shared/lib/first-steps/first-steps';
import { FirstStepsCard } from './FirstStepsCard';

const { toastSuccess } = vi.hoisted(() => ({ toastSuccess: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: toastSuccess } }));
vi.mock('@shared/runtime/runtime-provider', () => ({ useActiveSpaceId: () => 'space-1' }));

const row = (assigned: number) => ({ Assigned: assigned }) as unknown as GetMonthlyBudgetRow;

function renderCard(readyToAssign: number, rows: GetMonthlyBudgetRow[]) {
  return render(
    <MemoryRouter>
      <FirstStepsCard readyToAssign={readyToAssign} readyToAssignLabel="€2,340.00" rows={rows} />
    </MemoryRouter>
  );
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
