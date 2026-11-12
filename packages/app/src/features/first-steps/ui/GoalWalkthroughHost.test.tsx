import { act, fireEvent, render, screen } from '@testing-library/react';
import { GoalPurpose, GoalType } from '@budgero/core/browser';
import type { Category, GetMonthlyBudgetRow, Goal } from '@budgero/core/browser';
import { GoalSection } from '@features/goal-management/ui/GoalSection';
import { useUiStore } from '@shared/store/useUiStore';
import {
  getGoalWalkthrough,
  resetGoalWalkthroughForTests,
  startGoalWalkthrough,
} from '../model/goal-walkthrough';
import { GoalWalkthroughHost } from './GoalWalkthroughHost';

const { savedGoal, createGoal } = vi.hoisted(() => ({
  savedGoal: { current: null as null | { ID: number } },
  createGoal: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@entities/goal/api/useGoals', () => {
  const other = { mutateAsync: vi.fn(), isPending: false };
  return {
    useGoalByCategory: () => ({ data: savedGoal.current, isLoading: false }),
    useCategoryFinancials: () => ({ data: { available: 0, assigned: 0, activity: 0 } }),
    useCreateGoal: () => ({ mutateAsync: createGoal, isPending: false }),
    useUpdateGoal: () => other,
    useDeleteGoal: () => other,
  };
});
// The real form is big; these two buttons are all the walkthrough cares about.
vi.mock('@features/goal-management/ui/GoalForm', () => ({
  GoalForm: ({
    onSave,
    onCancel,
    notice,
  }: {
    onSave: (g: object) => void;
    onCancel: () => void;
    notice?: React.ReactNode;
  }) => (
    <div>
      {notice}
      <button onClick={() => onSave({ Type: 'monthly', Target: 300_000 })}>Save goal</button>
      <button onClick={onCancel}>Cancel goal</button>
    </div>
  ),
}));

const row = (id: number, name: string, assigned = 0) =>
  ({
    CategoryID: id,
    Category: name,
    Assigned: assigned,
    Available: assigned,
    Activity: 0,
  }) as unknown as GetMonthlyBudgetRow;
const rows = [row(11, 'Rent'), row(12, 'Groceries')];
const goal = (categoryId: number, target = 300_000) =>
  ({
    ID: 1,
    Type: GoalType.MONTHLY,
    Purpose: GoalPurpose.SPENDING,
    CategoryID: categoryId,
    Target: target,
    StartDate: '2026-11-01',
  }) as unknown as Goal;

const eur = (milli: number) => `€${(milli / 1000).toFixed(2)}`;
const formatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'EUR' });

function Page({
  goals = [],
  variant = 'card',
  section = true,
}: {
  goals?: Goal[];
  variant?: 'card' | 'bar';
  section?: boolean;
}) {
  return (
    <>
      <div data-budget-categories data-testid="list" />
      {section && (
        <GoalSection
          categoryId={11}
          categoryName="Rent"
          budgetId={1}
          finances={{ available: 0, assigned: 0, activity: 0 }}
          currentMonth="2026-11"
          formatter={formatter}
        />
      )}
      <GoalWalkthroughHost
        rows={rows}
        goals={goals}
        currentMonth="2026-11"
        formatAmount={eur}
        variant={variant}
      />
    </>
  );
}

const card = () => screen.queryByTestId('goal-walkthrough');
const select = (id: number | null, name = 'Rent') =>
  act(() =>
    useUiStore.setState({
      selectedCategories: (id === null ? [] : [{ ID: id, Name: name }]) as unknown as Category[],
    })
  );

beforeEach(() => {
  resetGoalWalkthroughForTests();
  savedGoal.current = null;
  createGoal.mockReset().mockResolvedValue(undefined);
  useUiStore.setState({
    selectedCategories: [],
    focusCategoryId: null,
    highlightGoalCategoryId: null,
    highlightAssignmentCategoryId: null,
  });
});

describe.each(['card', 'bar'] as const)('%s layout', (variant) => {
  it('walks through pick, types, Create Goal, the form and funding', async () => {
    render(<Page variant={variant} />);
    expect(card()).toBeNull();
    act(() => startGoalWalkthrough(null));

    // 1. Pick: the list is outlined, nothing is selected for them.
    const pick = card()!;
    expect(pick).toHaveAttribute('role', 'dialog');
    expect(pick).toHaveAttribute('aria-modal', 'false');
    expect(pick).toHaveTextContent(
      variant === 'bar'
        ? 'Tap the category you want a goal for. Rent or groceries are a good first one.'
        : 'Pick the category you want a goal for. Rent or groceries are a good first one.'
    );
    expect(screen.getByTestId('list')).toHaveClass('ring-2');
    expect(useUiStore.getState().selectedCategories).toEqual([]);
    expect(document.activeElement).toBe(document.body);
    expect(screen.queryByRole('button', { name: 'Next' })).toBeNull();

    // 2. Their own click: the goal types, grouped the way GoalForm lists them.
    select(11);
    expect(card()).toHaveTextContent('A goal for Rent');
    expect(screen.getByTestId('list')).not.toHaveClass('ring-2');
    const types = screen.getByTestId('goal-types');
    for (const text of [
      'Monthly',
      'Every month, like rent or groceries.',
      'Yearly',
      'By a date, like a holiday or a yearly bill.',
      'Periodic',
      'Every few months, like a quarterly bill.',
      'Target Balance',
      'Build up to an amount, no date, like an emergency fund.',
      'Available: have the amount ready. Allocation: put a set amount aside.',
    ])
      expect(types).toHaveTextContent(text);
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    // 3. Press Create Goal: highlighted (and its row opened), never pressed for them.
    expect(card()).toHaveTextContent('Press Create Goal');
    expect(useUiStore.getState().highlightGoalCategoryId).toBe(11);
    expect(useUiStore.getState().focusCategoryId).toBe(11);
    expect(screen.queryByText('Save goal')).toBeNull();

    // 4. The form: the card steps aside, a hint sits inside the form.
    fireEvent.click(screen.getByRole('button', { name: 'Create Goal' }));
    expect(card()).toBeNull();
    expect(screen.getByTestId('goal-walkthrough-hint')).toHaveTextContent(
      'Pick a type, enter the amount, save.'
    );
    // Closed without saving: back to step 3.
    fireEvent.click(screen.getByText('Cancel goal'));
    expect(card()).toHaveTextContent('Press Create Goal');
    expect(useUiStore.getState().highlightGoalCategoryId).toBe(11);

    // Saved: step 5, with what it needs this month and the hand-off to funding.
    fireEvent.click(screen.getByRole('button', { name: 'Create Goal' }));
    await act(async () => fireEvent.click(screen.getByText('Save goal')));
    expect(getGoalWalkthrough().step).toBe('saved');
  });
});

describe('step 5', () => {
  async function savedFor(goals: Goal[]) {
    const view = render(<Page />);
    select(11);
    act(() => startGoalWalkthrough({ id: 11, name: 'Rent', hasGoal: false }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create Goal' }));
    await act(async () => fireEvent.click(screen.getByText('Save goal')));
    view.rerender(<Page goals={goals} />);
    return view;
  }

  it('with money still needed: "now fund it" and a button to the fund step', async () => {
    await savedFor([goal(11, 300_000)]);
    expect(card()).toHaveTextContent('Goal set');
    expect(card()).toHaveTextContent('Rent needs €300.00 this month, now fund it.');
    fireEvent.click(screen.getByRole('button', { name: 'Fund it' }));
    expect(card()).toBeNull();
    expect(useUiStore.getState().highlightAssignmentCategoryId).toBe(11);
    expect(useUiStore.getState().focusCategoryId).toBe(11);
  });

  it('with nothing needed this month: just a done message', async () => {
    await savedFor([goal(11, 0)]);
    expect(card()).toHaveTextContent('Rent has what it needs this month.');
    expect(screen.queryByRole('button', { name: 'Fund it' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(card()).toBeNull();
  });
});

it('a picked category that already has a goal: pick another one', () => {
  render(<Page goals={[goal(12)]} section={false} />);
  act(() => startGoalWalkthrough(null));
  select(12, 'Groceries');
  expect(card()).toHaveTextContent('Groceries already has a goal. Pick another one.');
  select(11);
  expect(card()).toHaveTextContent('A goal for Rent');
});

it('follows a change of category during steps 2 and 3', () => {
  render(<Page section={false} />);
  select(11);
  act(() => startGoalWalkthrough({ id: 11, name: 'Rent', hasGoal: false }));
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  select(12, 'Groceries');
  expect(card()).toHaveTextContent('Press Create Goal');
  expect(card()).toHaveTextContent('Groceries');
  expect(useUiStore.getState().highlightGoalCategoryId).toBe(12);
});

describe.each([
  ['✕', () => fireEvent.click(screen.getByRole('button', { name: 'Close' }))],
  ['Esc', () => fireEvent.keyDown(document, { key: 'Escape' })],
])('%s', (_, close) => {
  it.each(['pick', 'types', 'create'])('closes it at %s and clears the highlight', (step) => {
    render(<Page section={false} />);
    if (step !== 'pick') select(11);
    act(() =>
      startGoalWalkthrough(step === 'pick' ? null : { id: 11, name: 'Rent', hasGoal: false })
    );
    if (step === 'create') fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(card()).toHaveAttribute('data-step', step);
    close();
    expect(card()).toBeNull();
    expect(getGoalWalkthrough().step).toBe('closed');
    expect(useUiStore.getState().highlightGoalCategoryId).toBeNull();
    expect(screen.getByTestId('list')).not.toHaveClass('ring-2');
  });
});

it('never opens the goal form by itself', () => {
  render(<Page />);
  select(11);
  act(() => startGoalWalkthrough({ id: 11, name: 'Rent', hasGoal: false }));
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  expect(screen.queryByText('Save goal')).toBeNull();
  expect(screen.queryByTestId('goal-walkthrough-hint')).toBeNull();
});
