/**
 * On a phone the goal walkthrough's card sits at the bottom of the screen,
 * where the floating Context button is: the button steps aside while the
 * walkthrough runs and comes back when it ends.
 */
import type { ReactNode } from 'react';
import { act, render, screen } from '@testing-library/react';
import {
  closeGoalWalkthrough,
  resetGoalWalkthroughForTests,
  startGoalWalkthrough,
} from '@features/first-steps/model/goal-walkthrough';
import { BudgetingPageMobile } from './BudgetingPage.mobile';

vi.mock('@entities/budget/api/useMonthlyBudget', () => ({
  useMonthlyBudget: () => ({ data: [], isSuccess: true, isPlaceholderData: false }),
  useReadyToAssign: () => ({ data: 0, isSuccess: true, isPlaceholderData: false }),
}));
vi.mock('@shared/store/useUiStore', () => ({
  useUiStore: (selector: (state: unknown) => unknown) =>
    selector({
      selectedBudget: { ID: 3, DisplayCurrency: 'USD' },
      globalLocalizer: new Intl.NumberFormat('en-US'),
      currentMonth: '2026-11',
      setCurrentMonth: () => {},
      selectedCategories: [{ ID: 11 }],
      compactMobileLayout: false,
      showHiddenCategories: false,
      setShowHiddenCategories: () => {},
    }),
}));
vi.mock('@features/budget-planning/ui/BudgetTable', () => ({
  BudgetTable: ({ renderToolbar }: { renderToolbar?: (controls: unknown) => ReactNode }) => (
    <div>{renderToolbar?.({})}</div>
  ),
}));
vi.mock('@features/budgeting/ui/BudgetToolbar', () => ({ BudgetToolbar: () => null }));
vi.mock('@features/budgeting/ui/BudgetContextPanel', () => ({ BudgetContextPanel: () => null }));
vi.mock('@features/first-steps/ui/FirstStepsCard', () => ({ FirstStepsCard: () => null }));
vi.mock('@features/first-steps/ui/GoalWalkthroughHost', () => ({
  GoalWalkthroughHost: () => null,
}));
vi.mock('@entities/goal/api/useGoals', () => ({ useGoals: () => ({ data: [] }) }));
vi.mock('@features/category-management/api/useHideCategory', () => ({
  useHideCategory: () => ({ hideCategory: () => {}, hasHiddenCategories: false }),
}));
vi.mock('@features/budget-planning/lib/useFormatMaskedMilli', () => ({
  useFormatMaskedMilli: () => (value: number) => String(value),
}));
vi.mock('@shared/hooks/useFocusCategoryFromNavState', () => ({
  useFocusCategoryFromNavState: () => null,
}));
vi.mock('@shared/hooks/useClearCategorySelectionOnMount', () => ({
  useClearCategorySelectionOnMount: () => {},
}));
vi.mock('@shared/hooks/useNavigateMonth', () => ({ useNavigateMonth: () => () => {} }));
vi.mock('@shared/ui/MonthPickerPopover', () => ({ default: () => null }));
vi.mock('@shared/ui/drawer', () => ({
  Drawer: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <div>{children}</div> : null,
  DrawerContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DrawerHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DrawerTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

beforeEach(() => resetGoalWalkthroughForTests());

it('hides the Context button while the goal walkthrough runs and brings it back after', () => {
  render(<BudgetingPageMobile />);
  expect(screen.getByRole('button', { name: 'Context (1)' })).toBeInTheDocument();

  act(() => startGoalWalkthrough(null));
  expect(screen.queryByRole('button', { name: 'Context (1)' })).toBeNull();

  act(() => closeGoalWalkthrough());
  expect(screen.getByRole('button', { name: 'Context (1)' })).toBeInTheDocument();
});
