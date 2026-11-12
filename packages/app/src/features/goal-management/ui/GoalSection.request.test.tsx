import { act, render, screen } from '@testing-library/react';
import { useUiStore } from '@shared/store/useUiStore';
import { GoalSection } from './GoalSection';

const { goalByCategory } = vi.hoisted(() => ({
  goalByCategory: { current: null as null | { ID: number } },
}));
vi.mock('@entities/goal/api/useGoals', () => {
  const mutation = { mutateAsync: vi.fn(), isPending: false };
  return {
    useGoalByCategory: () => ({ data: goalByCategory.current, isLoading: false }),
    useCategoryFinancials: () => ({ data: { available: 0, assigned: 0, activity: 0 } }),
    useCreateGoal: () => mutation,
    useUpdateGoal: () => mutation,
    useDeleteGoal: () => mutation,
  };
});
vi.mock('./GoalCard', () => ({ GoalCard: () => <div>goal card</div> }));
vi.mock('./GoalForm', () => ({ GoalForm: () => <div>new goal form</div> }));

const formatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const section = (categoryId: number) => (
  <GoalSection
    key={categoryId}
    categoryId={categoryId}
    categoryName="Rent"
    budgetId={1}
    finances={{ available: 0, assigned: 0, activity: 0 }}
    currentMonth="2026-11"
    formatter={formatter}
  />
);

beforeEach(() => {
  goalByCategory.current = null;
  useUiStore.setState({ goalFormRequestCategoryId: null });
});

it('opens the new-goal form when first steps asks for its category, once', () => {
  render(
    <>
      {section(11)}
      {section(11)}
      {section(12)}
    </>
  );
  expect(screen.queryByText('new goal form')).toBeNull();
  act(() => useUiStore.getState().setGoalFormRequestCategoryId(11));
  // Two sections for the same category (its row and the side panel): one form.
  expect(screen.getAllByText('new goal form')).toHaveLength(1);
  expect(useUiStore.getState().goalFormRequestCategoryId).toBeNull();
});

it('takes a request made before it was on screen', async () => {
  useUiStore.getState().setGoalFormRequestCategoryId(11);
  render(section(11));
  expect(await screen.findByText('new goal form')).toBeInTheDocument();
});

it('does not open a form for a category that already has a goal', () => {
  goalByCategory.current = { ID: 3 };
  render(section(11));
  act(() => useUiStore.getState().setGoalFormRequestCategoryId(11));
  expect(screen.queryByText('new goal form')).toBeNull();
  expect(useUiStore.getState().goalFormRequestCategoryId).toBeNull();
});
