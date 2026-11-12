import { act, fireEvent, render, screen } from '@testing-library/react';
import { useUiStore } from '@shared/store/useUiStore';
import { openPageGuide } from '@features/page-guides';
import { MemoryRouter } from 'react-router-dom';
import { GoalPurpose, GoalType } from '@budgero/core/browser';
import type { GetMonthlyBudgetRow, Goal } from '@budgero/core/browser';
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

const row = (assigned: number, categoryId = 11, name = 'Rent') =>
  ({
    Assigned: assigned,
    Available: assigned,
    Activity: 0,
    CategoryID: categoryId,
    Category: name,
  }) as unknown as GetMonthlyBudgetRow;

/** "Have €400 ready every month" for a category. */
const monthlyGoal = (categoryId: number, target = 400_000, id = 1) =>
  ({
    ID: id,
    Type: GoalType.MONTHLY,
    Purpose: GoalPurpose.SPENDING,
    CategoryID: categoryId,
    Target: target,
    StartDate: '2026-11-01',
  }) as unknown as Goal;

type Extra = {
  settled?: boolean;
  variant?: 'card' | 'bar';
  goals?: Goal[];
  onStepAction?: Partial<Record<'assign' | 'goal' | 'transaction' | 'return', () => void>>;
};

const eur = (milli: number) => `€${(milli / 1000).toFixed(2)}`;

function card(readyToAssign: number, rows: GetMonthlyBudgetRow[], extra: Extra = {}) {
  return (
    <MemoryRouter>
      <FirstStepsCard
        readyToAssign={readyToAssign}
        readyToAssignLabel={readyToAssign === 2_340_000 ? '€2,340.00' : eur(readyToAssign)}
        rows={rows}
        currentMonth="2026-11"
        formatAmount={eur}
        {...extra}
      />
    </MemoryRouter>
  );
}

function renderCard(readyToAssign: number, rows: GetMonthlyBudgetRow[], extra: Extra = {}) {
  return render(card(readyToAssign, rows, extra));
}

const stepTitles = () =>
  [...screen.getByTestId('first-steps').querySelectorAll('ol > li')].map((li) => li.textContent);

beforeEach(() => {
  vi.mocked(openPageGuide).mockClear();
  localStorage.clear();
  resetFirstStepsForTests();
  toastSuccess.mockReset();
  useUiStore.setState({
    focusCategoryId: null,
    highlightGoalCategoryId: null,
    highlightAssignmentCategoryId: null,
    goalFormRequestCategoryId: null,
  });
});

it('shows nothing for a workspace that did not start the checklist', () => {
  renderCard(2_340_000, []);
  expect(screen.queryByTestId('first-steps')).toBeNull();
});

it('reads as a lesson: goal, fund it, transaction, come back', () => {
  startFirstSteps('space-1');
  renderCard(100, [row(0)]);
  const titles = stepTitles();
  expect(titles[0]).toMatch(/^Set a goal for one category/);
  expect(titles[1]).toMatch(/^Assign your money/);
  expect(titles[2]).toMatch(/^Add a transaction/);
  expect(titles[3]).toMatch(/^Come back tomorrow/);
  expect(screen.getByText('0 of 4 done')).toBeInTheDocument();
});

describe('step 1: set a goal', () => {
  it('suggests rent or groceries from the user’s own categories and explains the goal types', () => {
    startFirstSteps('space-1');
    renderCard(2_340_000, [row(0, 10, 'Dining out'), row(0, 11, 'Groceries'), row(0, 12, 'Fun')]);
    const steps = screen.getByTestId('first-steps');
    expect(steps).toHaveTextContent('Start with Groceries. Select it, press Create Goal');
    const types = screen.getByTestId('goal-types');
    expect(types).toHaveTextContent('Every month: have an amount ready');
    expect(types).toHaveTextContent('By a date: save a total by a day');
    expect(types).toHaveTextContent('Every few months:');
    expect(types).toHaveTextContent('Build up to: an amount with no date');
  });

  it('falls back to the first category, skipping income and card payments', () => {
    startFirstSteps('space-1');
    const income = { ...row(0, 5, 'Income') } as GetMonthlyBudgetRow;
    const card = { ...row(0, 6, 'Visa'), cardBalance: -100 } as GetMonthlyBudgetRow;
    renderCard(100, [income, card, row(0, 7, 'Hobbies'), row(0, 8, 'Pets')]);
    expect(screen.getByTestId('first-steps')).toHaveTextContent('Start with Hobbies.');
  });

  it('“Show me” selects the category and opens its new-goal form, not the page guide', () => {
    startFirstSteps('space-1');
    renderCard(2_340_000, [row(0, 10, 'Dining out'), row(0, 11, 'Rent / Mortgage')]);
    fireEvent.click(screen.getByRole('button', { name: 'Show me' }));
    const ui = useUiStore.getState();
    expect(ui.focusCategoryId).toBe(11);
    expect(ui.highlightGoalCategoryId).toBe(11);
    expect(ui.goalFormRequestCategoryId).toBe(11);
    expect(openPageGuide).not.toHaveBeenCalled();
  });

  it('on a phone says tap, and “Show me” closes the sheet first', () => {
    startFirstSteps('space-1');
    renderCard(2_340_000, [row(0, 11, 'Groceries')], { variant: 'bar' });
    const bar = screen.getByTestId('first-steps');
    expect(bar).toHaveTextContent('Set a goal for one category');
    fireEvent.click(bar);
    expect(screen.getByText(/Tap it, then Create Goal/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show me' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(useUiStore.getState().goalFormRequestCategoryId).toBe(11);
  });

  it('ticks once a goal is created, or when the budget already has one', () => {
    startFirstSteps('space-1');
    const { unmount } = renderCard(100, [row(0)]);
    act(() => noteFirstStepsMutation('space-1', 'goals.create'));
    expect(screen.getByText('Set a goal for one category')).toHaveClass('line-through');
    unmount();
    localStorage.clear();
    resetFirstStepsForTests();
    startFirstSteps('space-1');
    renderCard(100, [row(0, 12)], { goals: [monthlyGoal(12)] });
    expect(getFirstSteps('space-1')?.done.goal).toBe(true);
  });

  it('a page can take over its button', () => {
    startFirstSteps('space-1');
    const goal = vi.fn();
    renderCard(100, [row(0)], { onStepAction: { goal } });
    fireEvent.click(screen.getByRole('button', { name: 'Show me' }));
    expect(goal).toHaveBeenCalledOnce();
    expect(useUiStore.getState().focusCategoryId).toBeNull();
    expect(useUiStore.getState().goalFormRequestCategoryId).toBeNull();
  });
});

describe('step 2: fund the goal', () => {
  it('says what the goal still needs and where to type it', () => {
    startFirstSteps('space-1');
    markFirstStep('space-1', 'goal');
    renderCard(2_340_000, [row(50_000, 11, 'Rent'), row(0, 12, 'Groceries')], {
      goals: [monthlyGoal(12, 300_000)],
    });
    expect(stepTitles()[1]).toMatch(/^Fund your goal/);
    const steps = screen.getByTestId('first-steps');
    expect(steps).toHaveTextContent(
      'Groceries still needs €300.00 this month. Type it in the Assigned column on the Groceries row. You have €2,340.00 to assign.'
    );
    expect(steps).toHaveTextContent('until Ready to Assign shows 0: every coin gets a job');
    // Its "Show me" points at the goal's row, not just any category.
    fireEvent.click(screen.getByRole('button', { name: 'Show me' }));
    expect(useUiStore.getState().highlightAssignmentCategoryId).toBe(12);
    expect(useUiStore.getState().focusCategoryId).toBe(12);
  });

  it('on a phone says to tap the goal’s category', () => {
    startFirstSteps('space-1');
    markFirstStep('space-1', 'goal');
    renderCard(2_340_000, [row(0, 12, 'Groceries')], {
      goals: [monthlyGoal(12, 400_000)],
      variant: 'bar',
    });
    const bar = screen.getByTestId('first-steps');
    expect(bar).toHaveTextContent('Fund your goal');
    fireEvent.click(bar);
    expect(screen.getByRole('dialog')).toHaveTextContent(
      'Groceries still needs €400.00 this month. Tap Groceries and enter it as Assigned.'
    );
  });

  it('without a goal, asks to assign the money', () => {
    startFirstSteps('space-1');
    markFirstStep('space-1', 'goal');
    renderCard(2_340_000, [row(0)]);
    expect(stepTitles()[1]).toMatch(/^Assign your money/);
    expect(screen.getByText('€2,340.00')).toBeInTheDocument();
    expect(screen.getByText(/Type an amount in the Assigned column/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show me' }));
    expect(useUiStore.getState().highlightAssignmentCategoryId).toBe(11);
  });

  it('with nothing more needed this month, falls back to the general wording', () => {
    startFirstSteps('space-1');
    markFirstStep('space-1', 'goal');
    // Money left over from last month already covers the goal.
    const covered = { ...row(0, 12, 'Groceries'), Available: 400_000 } as GetMonthlyBudgetRow;
    renderCard(500_000, [covered], { goals: [monthlyGoal(12, 400_000)] });
    const steps = screen.getByTestId('first-steps');
    expect(steps).toHaveTextContent('Fund your goal');
    expect(steps).not.toHaveTextContent('still needs');
    expect(steps).toHaveTextContent('to assign. Type an amount in the Assigned column');
  });

  it('is done once the goal has money; Ready to Assign at 0 is announced once', () => {
    startFirstSteps('space-1');
    markFirstStep('space-1', 'goal');
    const goals = [monthlyGoal(12, 400_000)];
    const { rerender } = renderCard(500_000, [row(0, 11), row(0, 12)], { goals });
    expect(getFirstSteps('space-1')?.done.assign).toBe(false);
    // Money elsewhere doesn't fund the goal.
    rerender(card(450_000, [row(50_000, 11), row(0, 12)], { goals }));
    expect(getFirstSteps('space-1')?.done.assign).toBe(false);
    rerender(card(350_000, [row(50_000, 11), row(100_000, 12)], { goals }));
    expect(getFirstSteps('space-1')?.done.assign).toBe(true);
    expect(toastSuccess).toHaveBeenLastCalledWith('Money assigned.', expect.anything());
    rerender(card(0, [row(50_000, 11), row(450_000, 12)], { goals }));
    expect(toastSuccess).toHaveBeenLastCalledWith('Every coin has a job.', expect.anything());
    rerender(card(0, [row(50_000, 11), row(450_001, 12)], { goals }));
    expect(toastSuccess).toHaveBeenCalledTimes(2);
    expect(screen.getByText('2 of 4 done')).toBeInTheDocument();
  });

  it('assigning everything at once ticks it with the “every coin” toast only', () => {
    startFirstSteps('space-1');
    const { rerender } = renderCard(0, [row(0)]);
    rerender(card(0, [row(2_340_000)]));
    expect(getFirstSteps('space-1')?.done).toMatchObject({ assign: true, everyCoin: true });
    expect(toastSuccess).toHaveBeenCalledOnce();
    expect(toastSuccess).toHaveBeenCalledWith('Every coin has a job.', expect.anything());
  });
});

it('a list mid-way keeps its ticks and shows them in the new order', () => {
  localStorage.setItem(
    'budgero:first-steps',
    JSON.stringify({
      'space-1': {
        startedOn: '2026-11-01',
        done: { assign: true, goal: false, transaction: false, return: false },
        dismissed: false,
        v: 2,
      },
    })
  );
  resetFirstStepsForTests();
  renderCard(0, [row(100)], { variant: 'bar' });
  // Next is the first undone step in the new order: the goal.
  const bar = screen.getByTestId('first-steps');
  expect(bar).toHaveTextContent('Set a goal for one category');
  expect(bar).toHaveTextContent('2/4'); // assign, and coming back (started days ago)
  fireEvent.click(bar);
  expect(screen.getByText('Assign your money')).toHaveClass('line-through');
  // Its first assignment was announced back then: no second toast now.
  expect(toastSuccess).not.toHaveBeenCalled();
  expect(getFirstSteps('space-1')?.done.everyCoin).toBe(true);
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
  expect(screen.getByRole('button', { name: 'Show me' })).toBeInTheDocument();
  expect(stepTitles()[0]).toMatch(/^Set a goal for one category/);
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
  // Step 2 explains that money has to come in first, and has no button.
  expect(screen.getByText(/Nothing to assign yet/)).toBeInTheDocument();
  expect(screen.getByText(/an account balance or income you record/)).toBeInTheDocument();
  expect(screen.queryByText(/to assign\. Type an amount/)).toBeNull();
  // The goal (step 1) is open with its Show me; step 2's note stays visible after it.
  expect(screen.getAllByRole('button', { name: 'Show me' })).toHaveLength(1);
  markFirstStep('space-1', 'goal');
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
    expect(bar).toHaveTextContent('Set a goal for one category');
    expect(bar).toHaveTextContent('0/4');
    expect(screen.queryByText('Budget with someone?')).toBeNull();
    fireEvent.click(bar);
    expect(screen.getByText('Budget with someone?')).toBeInTheDocument();
    // Phone wording: tap, not "select".
    expect(screen.getByText(/Tap it, then Create Goal/)).toBeInTheDocument();
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
    expect(screen.getByText('Assign your money')).toHaveClass('line-through');
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
