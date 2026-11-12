import { act, fireEvent, render, screen } from '@testing-library/react';
import { useUiStore } from '@shared/store/useUiStore';
import { openPageGuide } from '@features/page-guides';
import { MemoryRouter } from 'react-router-dom';
import type { GetMonthlyBudgetRow } from '@budgero/core/browser';
import {
  getFirstSteps,
  markFirstStep,
  noteFirstStepsMutation,
  resetFirstStepsForTests,
  setFirstStepsCollapsed,
  showFirstSteps,
  startFirstSteps,
} from '@shared/lib/first-steps/first-steps';
import { FirstStepsCard } from './FirstStepsCard';

const { toastSuccess } = vi.hoisted(() => ({ toastSuccess: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: toastSuccess } }));
vi.mock('@shared/runtime/runtime-provider', () => ({ useActiveSpaceId: () => 'space-1' }));
vi.mock('@features/page-guides', () => ({ openPageGuide: vi.fn() }));

const row = (assigned: number, categoryId = 11) =>
  ({
    Assigned: assigned,
    CategoryID: categoryId,
    Category: 'Rent',
  }) as unknown as GetMonthlyBudgetRow;

type Extra = {
  settled?: boolean;
  variant?: 'card' | 'bar';
  onStepAction?: Partial<Record<'assign' | 'goal' | 'transaction' | 'return', () => void>>;
};

function card(readyToAssign: number, rows: GetMonthlyBudgetRow[], extra: Extra = {}) {
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

function renderCard(readyToAssign: number, rows: GetMonthlyBudgetRow[], extra: Extra = {}) {
  return render(card(readyToAssign, rows, extra));
}

beforeEach(() => {
  vi.mocked(openPageGuide).mockClear();
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
  expect(screen.getByText('0 of 4 done')).toBeInTheDocument();
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
  // The ticked step stays, ticked; the goal is next and says why it matters.
  expect(screen.getByText('Give every coin a job')).toHaveClass('line-through');
  expect(screen.getByText('1 of 4 done')).toBeInTheDocument();
  expect(screen.getByText(/A goal says what a category needs/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Set a goal' })).toBeInTheDocument();
});

it('reads as a lesson: assign, goal, transaction, come back', () => {
  startFirstSteps('space-1');
  renderCard(100, [row(0)]);
  const titles = [...screen.getByTestId('first-steps').querySelectorAll('ol > li')].map(
    (li) => li.textContent
  );
  expect(titles[0]).toMatch(/^Give every coin a job/);
  expect(titles[1]).toMatch(/^Set a goal for one category/);
  expect(titles[2]).toMatch(/^Add a transaction/);
  expect(titles[3]).toMatch(/^Come back tomorrow/);
});

it('the goal step points at a category and ticks once a goal is created', () => {
  startFirstSteps('space-1');
  markFirstStep('space-1', 'assign');
  renderCard(0, [row(0, 11), row(500, 12)]);
  fireEvent.click(screen.getByRole('button', { name: 'Set a goal' }));
  // The category with money in it, selected and its goal button highlighted.
  expect(useUiStore.getState().focusCategoryId).toBe(12);
  expect(useUiStore.getState().highlightGoalCategoryId).toBe(12);
  expect(openPageGuide).toHaveBeenCalledWith('budget', { card: 'goals' });
  act(() => noteFirstStepsMutation('space-1', 'goals.create'));
  expect(screen.getByText('Set a goal for one category')).toHaveClass('line-through');
  expect(screen.getByText('Go to transactions')).toBeInTheDocument();
});

it('a page can take over a step’s button', () => {
  startFirstSteps('space-1');
  markFirstStep('space-1', 'assign');
  const goal = vi.fn();
  renderCard(0, [row(500)], { onStepAction: { goal } });
  useUiStore.setState({ focusCategoryId: null });
  fireEvent.click(screen.getByRole('button', { name: 'Set a goal' }));
  expect(goal).toHaveBeenCalledOnce();
  expect(openPageGuide).not.toHaveBeenCalled();
  expect(useUiStore.getState().focusCategoryId).toBeNull();
});

it('a checklist stored before the goal step gets it as not done', () => {
  localStorage.setItem(
    'budgero:first-steps',
    JSON.stringify({
      'space-1': {
        startedOn: '2026-11-01',
        done: { assign: true, transaction: true, return: true },
        dismissed: false,
      },
    })
  );
  resetFirstStepsForTests();
  renderCard(0, [row(100)]);
  expect(screen.getByText('3 of 4 done')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Set a goal' })).toBeInTheDocument();
});

it('a checklist hidden by the old ✕ before it was finished comes back once', () => {
  localStorage.setItem(
    'budgero:first-steps',
    JSON.stringify({
      'space-1': {
        startedOn: '2026-11-01',
        done: { assign: true, transaction: true, return: true },
        dismissed: true,
      },
    })
  );
  resetFirstStepsForTests();
  renderCard(0, [row(100)]);
  // The goal step came later, so this list wasn't finished.
  expect(screen.getByText('3 of 4 done')).toBeInTheDocument();
});

it('a finished checklist closed before this update stays closed', () => {
  localStorage.setItem(
    'budgero:first-steps',
    JSON.stringify({
      'space-1': {
        startedOn: '2026-11-01',
        done: { assign: true, goal: true, transaction: true, return: true },
        dismissed: true,
      },
    })
  );
  resetFirstStepsForTests();
  renderCard(0, [row(100)]);
  expect(screen.queryByTestId('first-steps')).toBeNull();
});

it('follows another tab', () => {
  startFirstSteps('space-1');
  renderCard(100, [row(0)]);
  const all = JSON.parse(localStorage.getItem('budgero:first-steps')!);
  all['space-1'].done.goal = true;
  localStorage.setItem('budgero:first-steps', JSON.stringify(all));
  act(() => {
    window.dispatchEvent(new StorageEvent('storage', { key: 'budgero:first-steps' }));
  });
  expect(screen.getByText('Set a goal for one category')).toHaveClass('line-through');
});

it('can be hidden on purpose, undone, and shown again later', () => {
  startFirstSteps('space-1');
  renderCard(100, [row(0)]);
  fireEvent.click(screen.getByRole('button', { name: 'Hide first steps' }));
  expect(screen.queryByTestId('first-steps')).toBeNull();
  // The toast says where to get it back and offers Undo.
  const [message, options] = toastSuccess.mock.calls[0] as [
    string,
    { description: string; action: { label: string; onClick: () => void } },
  ];
  expect(message).toBe('First steps hidden');
  expect(options.description).toMatch(/Help \(\?\).*Budget Settings/);
  expect(options.action.label).toBe('Undo');
  act(() => options.action.onClick());
  expect(screen.getByTestId('first-steps')).toBeInTheDocument();
  // Hidden again, then brought back from elsewhere (Help menu, Settings).
  fireEvent.click(screen.getByRole('button', { name: 'Hide first steps' }));
  expect(screen.queryByTestId('first-steps')).toBeNull();
  act(() => showFirstSteps('space-1'));
  expect(screen.getByText('Your first steps')).toBeInTheDocument();
});

describe('on a desktop', () => {
  it('has no bare ✕: the corner button folds the card to one row', () => {
    startFirstSteps('space-1');
    markFirstStep('space-1', 'assign');
    renderCard(0, [row(100)]);
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse first steps' }));
    const card = screen.getByTestId('first-steps');
    expect(card).toHaveTextContent('Next: Set a goal for one category');
    expect(screen.queryByText('Add a transaction')).toBeNull();
    expect(getFirstSteps('space-1')).toMatchObject({ collapsed: true, dismissed: false });
  });

  it('remembers the folded card across reloads, and unfolds it on a click', () => {
    startFirstSteps('space-1');
    setFirstStepsCollapsed('space-1', true);
    resetFirstStepsForTests();
    renderCard(0, [row(0)]);
    const row1 = screen.getByRole('button', { name: /Show first steps/ });
    expect(row1).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(row1);
    expect(screen.getByText('Your first steps')).toBeInTheDocument();
    expect(getFirstSteps('space-1')?.collapsed).toBe(false);
  });
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
  expect(screen.getByText('0 of 4 done')).toBeInTheDocument();
});

it('with nothing to assign yet, says so and shows the next thing to do', () => {
  startFirstSteps('space-1');
  renderCard(0, [row(0)]);
  expect(screen.getByText(/Nothing to assign yet/)).toBeInTheDocument();
  expect(screen.queryByText(/to assign\. Type an amount/)).toBeNull();
  // The next step (the goal) is open with its action, not hidden behind step 1.
  expect(screen.getByRole('button', { name: 'Set a goal' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Show me' })).toBeNull();
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
    expect(bar).toHaveTextContent('0/4');
    expect(screen.queryByText('Budget with someone?')).toBeNull();
    fireEvent.click(bar);
    expect(screen.getByText('Budget with someone?')).toBeInTheDocument();
    // Phone wording: no "Assigned column" there.
    expect(screen.getByText(/Tap a category and enter an amount/)).toBeInTheDocument();
    // The ✕ closes the sheet; the row stays.
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByText('Budget with someone?')).toBeNull();
    expect(screen.getByTestId('first-steps')).toBeInTheDocument();
    expect(getFirstSteps('space-1')?.dismissed).toBe(false);
    // Hiding the list is its own button, inside the sheet.
    fireEvent.click(bar);
    fireEvent.click(screen.getByRole('button', { name: 'Hide first steps' }));
    expect(getFirstSteps('space-1')?.dismissed).toBe(true);
    expect(screen.queryByTestId('first-steps')).toBeNull();
  });

  it('when everything is done, stays with an end state the user closes', () => {
    vi.useFakeTimers();
    try {
      startFirstSteps('space-1');
      for (const step of ['assign', 'goal', 'transaction', 'return'] as const)
        markFirstStep('space-1', step);
      renderCard(0, [row(100)], { variant: 'bar' });
      const bar = screen.getByTestId('first-steps');
      expect(bar).toHaveTextContent('You’ve got the basics');
      act(() => vi.advanceTimersByTime(60_000));
      expect(getFirstSteps('space-1')?.dismissed).toBe(false);
      fireEvent.click(bar);
      // ✕ closes the sheet only.
      fireEvent.click(screen.getByRole('button', { name: 'Close' }));
      expect(getFirstSteps('space-1')?.dismissed).toBe(false);
      fireEvent.click(bar);
      fireEvent.click(screen.getByRole('button', { name: 'Hide first steps' }));
      expect(getFirstSteps('space-1')?.dismissed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

it('the desktop card stays once all are done, until the user closes it', () => {
  vi.useFakeTimers();
  try {
    startFirstSteps('space-1');
    for (const step of ['assign', 'goal', 'transaction'] as const) markFirstStep('space-1', step);
    renderCard(0, [row(100)]);
    // Ticking the last one (here: coming back) doesn't make the list vanish.
    act(() => markFirstStep('space-1', 'return'));
    act(() => vi.advanceTimersByTime(60_000));
    expect(screen.getByTestId('first-steps')).toHaveTextContent('You’ve got the basics');
    expect(screen.getByText('Give every coin a job')).toHaveClass('line-through');
    fireEvent.click(screen.getByRole('button', { name: 'Hide first steps' }));
    expect(screen.queryByTestId('first-steps')).toBeNull();
  } finally {
    vi.useRealTimers();
  }
});

it('on a phone, waiting only for tomorrow is a quiet state, not a to-do', () => {
  startFirstSteps('space-1');
  markFirstStep('space-1', 'assign');
  markFirstStep('space-1', 'goal');
  markFirstStep('space-1', 'transaction');
  renderCard(0, [row(100)], { variant: 'bar' });
  const bar = screen.getByTestId('first-steps');
  expect(bar).toHaveTextContent('3 of 4 done · see you tomorrow');
  expect(bar).not.toHaveTextContent('Come back tomorrow');
  expect(bar.querySelector('svg.lucide-chevron-right')).toBeNull();
  fireEvent.click(bar);
  expect(screen.getByText('Come back tomorrow')).toBeInTheDocument();
});
