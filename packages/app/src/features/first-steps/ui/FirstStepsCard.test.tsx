import { act, fireEvent, render, screen } from '@testing-library/react';
import { useUiStore } from '@shared/store/useUiStore';
import { openPageGuide } from '@features/page-guides';
import { MemoryRouter } from 'react-router-dom';
import { GoalPurpose, GoalType } from '@budgero/core/browser';
import type { Category, GetMonthlyBudgetRow, Goal } from '@budgero/core/browser';
import {
  getFirstSteps,
  markFirstStep,
  noteFirstStepsLocalAction,
  noteFirstStepsMutation,
  resetFirstStepsForTests,
  setFirstStepsCollapsed,
  showFirstSteps,
  startFirstSteps,
} from '@shared/lib/first-steps/first-steps';
import {
  flushSyncedState,
  receiveSyncedState,
  resetSyncedRuntime,
  syncedRuntime,
  syncedWrites,
  SyncedRuntimeProvider,
} from '@/test/synced-runtime';
import {
  closeGoalWalkthrough,
  getGoalWalkthrough,
  resetGoalWalkthroughForTests,
} from '../model/goal-walkthrough';
import { FirstStepsCard } from './FirstStepsCard';

const { toastSuccess } = vi.hoisted(() => ({ toastSuccess: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: toastSuccess } }));
vi.mock('@shared/runtime/global', async () => (await import('@/test/synced-runtime')).globalMock());
vi.mock('@shared/runtime/runtime-provider', async () =>
  (await import('@/test/synced-runtime')).runtimeProviderMock()
);
vi.mock('@entities/user/api/useAuth', () => ({ useProfile: () => ({ data: { id: 'u1' } }) }));
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
  budgetId?: number;
  settled?: boolean;
  variant?: 'card' | 'bar';
  goals?: Goal[];
  onStepAction?: Partial<Record<'assign' | 'goal' | 'transaction' | 'return', () => void>>;
};

const eur = (milli: number) => `€${(milli / 1000).toFixed(2)}`;

function card(readyToAssign: number, rows: GetMonthlyBudgetRow[], extra: Extra = {}) {
  return (
    <SyncedRuntimeProvider>
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
    </SyncedRuntimeProvider>
  );
}

/** Renders the card once the synced state is loaded. */
async function renderCard(readyToAssign: number, rows: GetMonthlyBudgetRow[], extra: Extra = {}) {
  const view = render(card(readyToAssign, rows, extra));
  await flushSyncedState();
  return view;
}

/** Start the checklist the way onboarding does. */
const start = () => startFirstSteps('space-1', 'u1');
/** This user changing the budget here (the runtime counts it as it starts). */
const localChange = () => noteFirstStepsLocalAction('monthlyBudgets.assign');

const stepTitles = () =>
  [...screen.getByTestId('first-steps').querySelectorAll('ol > li')].map((li) => li.textContent);

beforeEach(() => {
  vi.mocked(openPageGuide).mockClear();
  localStorage.clear();
  resetSyncedRuntime();
  resetFirstStepsForTests();
  toastSuccess.mockReset();
  useUiStore.setState({
    focusCategoryId: null,
    highlightGoalCategoryId: null,
    highlightAssignmentCategoryId: null,
    selectedCategories: [],
  });
  resetGoalWalkthroughForTests();
});

it('shows nothing for a workspace that did not start the checklist', async () => {
  await renderCard(2_340_000, []);
  expect(screen.queryByTestId('first-steps')).toBeNull();
});

it('reads as a lesson: goal, fund it, transaction, come back', async () => {
  start();
  await renderCard(100, [row(0)]);
  const titles = stepTitles();
  expect(titles[0]).toMatch(/^Set a goal for one category/);
  expect(titles[1]).toMatch(/^Assign your money/);
  expect(titles[2]).toMatch(/^Add a transaction/);
  expect(titles[3]).toMatch(/^Come back tomorrow/);
  expect(screen.getByText('0 of 4 done')).toBeInTheDocument();
});

describe('step 1: set a goal', () => {
  it('is a short why-line and a Show me; the goal types live in the walkthrough', async () => {
    start();
    await renderCard(2_340_000, [row(0, 11, 'Groceries')]);
    const steps = screen.getByTestId('first-steps');
    expect(steps).toHaveTextContent('A goal says what a category needs');
    expect(screen.queryByTestId('goal-types')).toBeNull();
    expect(steps).not.toHaveTextContent('Start with');
    expect(screen.getByRole('button', { name: 'Show me' })).toBeInTheDocument();
  });

  it('without categories, says to add one and has no button', async () => {
    start();
    const income = { ...row(0, 5, 'Income') } as GetMonthlyBudgetRow;
    await renderCard(100, [income]);
    expect(screen.getByText('Add a category first, then give it a goal.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show me' })).toBeNull();
  });

  it('“Show me” starts the walkthrough: no category picked, no form, no page guide', async () => {
    start();
    await renderCard(2_340_000, [row(0, 10, 'Dining out'), row(0, 11, 'Rent / Mortgage')]);
    fireEvent.click(screen.getByRole('button', { name: 'Show me' }));
    expect(getGoalWalkthrough()).toEqual({ step: 'pick' });
    const ui = useUiStore.getState();
    expect(ui.focusCategoryId).toBeNull();
    expect(ui.highlightGoalCategoryId).toBeNull();
    expect(ui.selectedCategories).toEqual([]);
    expect(openPageGuide).not.toHaveBeenCalled();
    // The desktop card folds out of the way, and unfolds when it ends.
    expect(getFirstSteps('space-1')?.collapsed).toBe(true);
    act(() => closeGoalWalkthrough());
    expect(getFirstSteps('space-1')?.collapsed).toBe(false);
  });

  it('“Show me” with a goal-less category already selected starts at the goal types', async () => {
    start();
    useUiStore.setState({
      selectedCategories: [{ ID: 11, Name: 'Groceries' }] as unknown as Category[],
    });
    await renderCard(2_340_000, [row(0, 11, 'Groceries')]);
    fireEvent.click(screen.getByRole('button', { name: 'Show me' }));
    expect(getGoalWalkthrough()).toMatchObject({ step: 'types', categoryId: 11 });
  });

  it('on a phone, “Show me” closes the sheet and leaves the bar', async () => {
    start();
    await renderCard(2_340_000, [row(0, 11, 'Groceries')], { variant: 'bar' });
    const bar = screen.getByTestId('first-steps');
    fireEvent.click(bar);
    fireEvent.click(screen.getByRole('button', { name: 'Show me' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByTestId('first-steps')).toBeInTheDocument();
    expect(getGoalWalkthrough().step).toBe('pick');
    expect(getFirstSteps('space-1')?.collapsed).toBeFalsy();
  });

  it('ticks once a goal is created, or when the budget already has one', async () => {
    start();
    const { unmount } = await renderCard(100, [row(0)]);
    act(() => noteFirstStepsMutation('space-1', 'goals.create'));
    expect(screen.getByText('Set a goal for one category')).toHaveClass('line-through');
    unmount();
    localStorage.clear();
    resetFirstStepsForTests();
    start();
    await renderCard(100, [row(0, 12)], { goals: [monthlyGoal(12)] });
    expect(getFirstSteps('space-1')?.done.goal).toBe(true);
  });

  it('a page can take over its button', async () => {
    start();
    const goal = vi.fn();
    await renderCard(100, [row(0)], { onStepAction: { goal } });
    fireEvent.click(screen.getByRole('button', { name: 'Show me' }));
    expect(goal).toHaveBeenCalledOnce();
    expect(useUiStore.getState().focusCategoryId).toBeNull();
    expect(getGoalWalkthrough().step).toBe('closed');
  });
});

describe('step 2: fund the goal', () => {
  it('says what the goal still needs and where to type it', async () => {
    start();
    markFirstStep('space-1', 'goal');
    await renderCard(2_340_000, [row(50_000, 11, 'Rent'), row(0, 12, 'Groceries')], {
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

  it('on a phone says to tap the goal’s category', async () => {
    start();
    markFirstStep('space-1', 'goal');
    await renderCard(2_340_000, [row(0, 12, 'Groceries')], {
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

  it('without a goal, asks to assign the money', async () => {
    start();
    markFirstStep('space-1', 'goal');
    await renderCard(2_340_000, [row(0)]);
    expect(stepTitles()[1]).toMatch(/^Assign your money/);
    expect(screen.getByText('€2,340.00')).toBeInTheDocument();
    expect(screen.getByText(/Type an amount in the Assigned column/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show me' }));
    expect(useUiStore.getState().highlightAssignmentCategoryId).toBe(11);
  });

  it('with nothing more needed this month, falls back to the general wording', async () => {
    start();
    markFirstStep('space-1', 'goal');
    // Money left over from last month already covers the goal.
    const covered = { ...row(0, 12, 'Groceries'), Available: 400_000 } as GetMonthlyBudgetRow;
    await renderCard(500_000, [covered], { goals: [monthlyGoal(12, 400_000)] });
    const steps = screen.getByTestId('first-steps');
    expect(steps).toHaveTextContent('Fund your goal');
    expect(steps).not.toHaveTextContent('still needs');
    expect(steps).toHaveTextContent('to assign. Type an amount in the Assigned column');
  });

  it('is done once the goal has money; Ready to Assign at 0 is announced once', async () => {
    start();
    markFirstStep('space-1', 'goal');
    const goals = [monthlyGoal(12, 400_000)];
    const { rerender } = await renderCard(500_000, [row(0, 11), row(0, 12)], { goals });
    expect(getFirstSteps('space-1')?.done.assign).toBe(false);
    // Money elsewhere doesn't fund the goal.
    localChange();
    rerender(card(450_000, [row(50_000, 11), row(0, 12)], { goals }));
    expect(getFirstSteps('space-1')?.done.assign).toBe(false);
    localChange();
    rerender(card(350_000, [row(50_000, 11), row(100_000, 12)], { goals }));
    expect(getFirstSteps('space-1')?.done.assign).toBe(true);
    expect(toastSuccess).toHaveBeenLastCalledWith('Money assigned.', expect.anything());
    localChange();
    rerender(card(0, [row(50_000, 11), row(450_000, 12)], { goals }));
    expect(toastSuccess).toHaveBeenLastCalledWith('Every coin has a job.', expect.anything());
    localChange();
    rerender(card(0, [row(50_000, 11), row(450_001, 12)], { goals }));
    expect(toastSuccess).toHaveBeenCalledTimes(2);
    expect(screen.getByText('2 of 4 done')).toBeInTheDocument();
  });

  it('assigning everything at once ticks it with the “every coin” toast only', async () => {
    start();
    const { rerender } = await renderCard(0, [row(0)]);
    localChange();
    rerender(card(0, [row(2_340_000)]));
    expect(getFirstSteps('space-1')?.done).toMatchObject({ assign: true, everyCoin: true });
    expect(toastSuccess).toHaveBeenCalledOnce();
    expect(toastSuccess).toHaveBeenCalledWith('Every coin has a job.', expect.anything());
    // Both ticks in one write.
    expect(syncedWrites().at(-1)?.payload.patch).toEqual({
      set: { assign: true, everyCoin: true },
    });
  });

  it('money assigned on another device ticks silently here', async () => {
    start();
    const goals = [monthlyGoal(12, 400_000)];
    const { rerender } = await renderCard(500_000, [row(0, 12)], { goals });
    // The other device's assignment syncs in: new figures, no local change.
    rerender(card(100_000, [row(400_000, 12)], { goals }));
    expect(getFirstSteps('space-1')?.done.assign).toBe(true);
    rerender(card(0, [row(500_000, 12)], { goals }));
    expect(getFirstSteps('space-1')?.done.everyCoin).toBe(true);
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it('a tick that arrives already done from another device is never celebrated', async () => {
    start();
    const goals = [monthlyGoal(12, 400_000)];
    const { rerender } = await renderCard(500_000, [row(0, 12)], { goals });
    await receiveSyncedState('user:u1', 'firstSteps', {
      startedOn: '2026-11-01',
      version: 4,
      assign: true,
      everyCoin: true,
    });
    localChange();
    rerender(card(0, [row(500_000, 12)], { goals }));
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it('figures already there when the list loads tick without a toast, days later too', async () => {
    start();
    await renderCard(0, [row(500_000, 12)], { goals: [monthlyGoal(12, 400_000)] });
    expect(getFirstSteps('space-1')?.done).toMatchObject({ assign: true, everyCoin: true });
    expect(toastSuccess).not.toHaveBeenCalled();
  });
});

it('a list mid-way keeps its ticks and shows them in the new order', async () => {
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
  await renderCard(0, [row(100)], { variant: 'bar' });
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

it('a checklist stored before the goal step gets it as not done', async () => {
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
  await renderCard(0, [row(100)]);
  expect(screen.getByText('3 of 4 done')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Show me' })).toBeInTheDocument();
  expect(stepTitles()[0]).toMatch(/^Set a goal for one category/);
});

it('a checklist hidden by the old ✕ before it was finished comes back once', async () => {
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
  await renderCard(0, [row(100)]);
  // The goal step came later, so this list wasn't finished.
  expect(screen.getByText('3 of 4 done')).toBeInTheDocument();
});

it('a finished checklist closed before this update stays closed', async () => {
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
  await renderCard(0, [row(100)]);
  expect(screen.queryByTestId('first-steps')).toBeNull();
});

it('follows the user’s other devices', async () => {
  start();
  await renderCard(100, [row(0)]);
  await receiveSyncedState('user:u1', 'firstSteps', {
    ...(syncedRuntime.store.get('user:u1|firstSteps') as object),
    goal: true,
  });
  expect(screen.getByText('Set a goal for one category')).toHaveClass('line-through');
  await receiveSyncedState('user:u1', 'firstSteps', {
    ...(syncedRuntime.store.get('user:u1|firstSteps') as object),
    dismissed: true,
  });
  expect(screen.queryByTestId('first-steps')).toBeNull();
});

it('appears on a device that never ran onboarding', async () => {
  syncedRuntime.store.set('user:u1|firstSteps', {
    startedOn: '2026-11-01',
    version: 4,
    goal: true,
  });
  await renderCard(100, [row(0)]);
  expect(screen.getByTestId('first-steps')).toBeInTheDocument();
  expect(screen.getByText('Set a goal for one category')).toHaveClass('line-through');
});

it('shows, hides and ticks nothing before the synced state is loaded', async () => {
  syncedRuntime.store.set('user:u1|firstSteps', { startedOn: '2026-11-01', version: 4 });
  syncedRuntime.initialized = false;
  const { rerender } = render(card(0, [row(500_000)], { goals: [monthlyGoal(11)] }));
  await flushSyncedState();
  expect(screen.queryByTestId('first-steps')).toBeNull();
  expect(syncedWrites()).toEqual([]);
  syncedRuntime.initialized = true;
  rerender(card(0, [row(500_000)], { goals: [monthlyGoal(11)] }));
  await flushSyncedState();
  expect(screen.getByTestId('first-steps')).toBeInTheDocument();
});

it('a dismissed list never flashes on a device that loads it', async () => {
  syncedRuntime.store.set('user:u1|firstSteps', {
    startedOn: '2026-11-01',
    version: 4,
    dismissed: true,
  });
  // This device's copy still says shown: it must not show while loading.
  localStorage.setItem(
    'budgero:first-steps',
    JSON.stringify({ 'space-1|u1': { synced: { startedOn: '2026-11-01', version: 4 } } })
  );
  resetFirstStepsForTests();
  const seen: boolean[] = [];
  const observer = new MutationObserver(() =>
    seen.push(Boolean(document.querySelector('[data-testid="first-steps"]')))
  );
  observer.observe(document.body, { childList: true, subtree: true });
  await renderCard(100, [row(0)]);
  observer.disconnect();
  expect(seen).not.toContain(true);
});

describe('step 3: add a transaction', () => {
  it('ticks from a transaction already in the budget (entered on any device)', async () => {
    start();
    syncedRuntime.transactions = [{ Payee: 'Budgero' }, { Payee: 'Bakery' }];
    await renderCard(100, [row(0)], { budgetId: 1 });
    expect(getFirstSteps('space-1')?.done.transaction).toBe(true);
  });

  it('opening balances of new accounts don’t count', async () => {
    start();
    syncedRuntime.transactions = [{ Payee: 'Budgero' }, { Payee: 'Budgero' }];
    await renderCard(100, [row(0)], { budgetId: 1 });
    expect(getFirstSteps('space-1')?.done.transaction).toBe(false);
  });
});

it('a page load with nothing new writes nothing', async () => {
  start();
  noteFirstStepsMutation('space-1', 'goals.create');
  const writes = syncedWrites().length;
  const { unmount } = await renderCard(100, [row(0)], { goals: [monthlyGoal(11)] });
  unmount();
  await renderCard(100, [row(0)], { goals: [monthlyGoal(11)] });
  expect(syncedWrites()).toHaveLength(writes);
});

it('can be hidden on purpose, undone, and shown again later', async () => {
  start();
  await renderCard(100, [row(0)]);
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
  it('has no bare ✕: the corner button folds the card to one row', async () => {
    start();
    markFirstStep('space-1', 'assign');
    await renderCard(0, [row(100)]);
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse first steps' }));
    const card = screen.getByTestId('first-steps');
    expect(card).toHaveTextContent('Next: Set a goal for one category');
    expect(screen.queryByText('Add a transaction')).toBeNull();
    expect(getFirstSteps('space-1')).toMatchObject({ collapsed: true, dismissed: false });
  });

  it('remembers the folded card across reloads, and unfolds it on a click', async () => {
    start();
    setFirstStepsCollapsed('space-1', true);
    resetFirstStepsForTests();
    await renderCard(0, [row(0)]);
    const row1 = screen.getByRole('button', { name: /Show first steps/ });
    expect(row1).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(row1);
    expect(screen.getByText('Your first steps')).toBeInTheDocument();
    expect(getFirstSteps('space-1')?.collapsed).toBe(false);
  });
});

it('offers sharing as an optional step that does not count toward the three', async () => {
  start();
  await renderCard(100, [row(0)]);
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

it('with nothing to assign yet, says so and shows the next thing to do', async () => {
  start();
  await renderCard(0, [row(0)]);
  // Step 2 explains that money has to come in first, and has no button.
  expect(screen.getByText(/Nothing to assign yet/)).toBeInTheDocument();
  expect(screen.getByText(/an account balance or income you record/)).toBeInTheDocument();
  expect(screen.queryByText(/to assign\. Type an amount/)).toBeNull();
  // The goal (step 1) is open with its Show me; step 2's note stays visible after it.
  expect(screen.getAllByRole('button', { name: 'Show me' })).toHaveLength(1);
  markFirstStep('space-1', 'goal');
  expect(getFirstSteps('space-1')?.done.assign).toBe(false);
});

it("doesn't tick from a loading default or last month's placeholder", async () => {
  start();
  const { rerender } = await renderCard(0, [row(500_000)], { settled: false });
  expect(getFirstSteps('space-1')?.done.assign).toBe(false);
  expect(toastSuccess).not.toHaveBeenCalled();
  rerender(card(0, [row(500_000)], { settled: true }));
  expect(getFirstSteps('space-1')?.done.assign).toBe(true);
});

describe('on a phone', () => {
  it('is one compact row that opens the full list', async () => {
    start();
    await renderCard(2_340_000, [row(0)], { variant: 'bar' });
    const bar = screen.getByTestId('first-steps');
    expect(bar.tagName).toBe('BUTTON');
    expect(bar).toHaveTextContent('Set a goal for one category');
    expect(bar).toHaveTextContent('0/4');
    expect(screen.queryByText('Budget with someone?')).toBeNull();
    fireEvent.click(bar);
    expect(screen.getByText('Budget with someone?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show me' })).toBeInTheDocument();
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

  it('when everything is done, stays with an end state the user closes', async () => {
    vi.useFakeTimers();
    try {
      start();
      for (const step of ['assign', 'goal', 'transaction', 'return'] as const)
        markFirstStep('space-1', step);
      await renderCard(0, [row(100)], { variant: 'bar' });
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

it('the desktop card stays once all are done, until the user closes it', async () => {
  vi.useFakeTimers();
  try {
    start();
    for (const step of ['assign', 'goal', 'transaction'] as const) markFirstStep('space-1', step);
    await renderCard(0, [row(100)]);
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

it('on a phone, waiting only for tomorrow is a quiet state, not a to-do', async () => {
  start();
  markFirstStep('space-1', 'assign');
  markFirstStep('space-1', 'goal');
  markFirstStep('space-1', 'transaction');
  await renderCard(0, [row(100)], { variant: 'bar' });
  const bar = screen.getByTestId('first-steps');
  expect(bar).toHaveTextContent('3 of 4 done · see you tomorrow');
  expect(bar).not.toHaveTextContent('Come back tomorrow');
  expect(bar.querySelector('svg.lucide-chevron-right')).toBeNull();
  fireEvent.click(bar);
  expect(screen.getByText('Come back tomorrow')).toBeInTheDocument();
});
