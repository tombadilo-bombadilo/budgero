import { act, render, renderHook, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GoalPurpose, GoalType, type Goal, type GetMonthlyBudgetRow } from '@budgero/core/browser';
import { useAssignDropdownState } from '@features/budget-planning/ui/assign-dropdown/useAssignDropdownState';
import { asMilli } from '@shared/lib/currency/milli';
import type { BudgetRow } from '@features/budget-planning/lib/budget-transforms';
import { BudgetContextPanel } from './BudgetContextPanel';

const mock = vi.hoisted(() => ({
  batch: vi.fn(),
  priorities: vi.fn(),
  distribution: 'proportional-shortfall',
  over: false,
  ready: true,
  goalsReady: true,
  cyclesReady: true,
  goals: [] as Goal[],
}));
vi.mock('@entities/budget/api/useGoalFundingSettings', () => ({
  useGoalFundingSettings: () => ({
    CategoryPriorityMode: 'numeric',
    GoalFundingDistribution: mock.distribution,
    ShowCategoryPriorities: true,
    isReady: mock.ready,
  }),
}));
vi.mock('@entities/category/api/useCategories', () => ({
  useUpdateFundingPriorities: () => ({ mutateAsync: mock.priorities, isPending: false }),
  useCategories: () => ({ data: [] }),
  useUpdateCategoryNote: () => ({ mutate: vi.fn() }),
}));
vi.mock('@entities/budget/api/useMonthlyBudget', () => ({
  useBatchUpsertAssignments: () => ({
    mutate: mock.batch,
    mutateAsync: mock.batch,
    isPending: false,
  }),
  useAssignmentsByMonthForCategories: () => ({ data: [] }),
  useCategoryAssignmentHelpers: () => ({ data: [] }),
}));
vi.mock('@entities/goal/api/useGoals', () => ({
  useGoals: () => ({ data: mock.goals, isSuccess: mock.goalsReady }),
  useGoalsByCategories: (ids: number[]) => ({
    data: mock.goals.filter((g) => ids.includes(g.CategoryID)),
    isSuccess: mock.goalsReady,
  }),
  useCycleFinancialsForGoals: () => ({ data: {}, isSuccess: mock.cyclesReady }),
}));
vi.mock('@entities/transaction/api/useTransactions', () => ({
  useTransactionsByCategoryAndMonth: () => ({ data: [] }),
}));
vi.mock('@features/analytics/api/useAnalyticsQueries', () => ({
  useSpendingTotalsByPeriod: () => ({ data: [] }),
}));
vi.mock('@shared/hooks/useUserPreferences', () => ({
  useAllowOverAssignment: () => ({ data: mock.over }),
}));
vi.mock('@features/goal-management/ui/GoalSection', () => ({ GoalSection: () => null }));
vi.mock('@shared/ui/echart', () => ({ EChart: () => null }));
vi.mock('@shared/lib/charts/echarts-chrome', () => ({
  useChartPalette: () => ({ chrome: {}, series: [], flow: {} }),
  tooltipBase: () => ({}),
  tooltipHtml: () => '',
  BAR_MAX_WIDTH: 20,
  BAR_RADIUS_TOP: 2,
}));

const formatter = new Intl.NumberFormat('en', { style: 'currency', currency: 'EUR' });
const rows: BudgetRow[] = [1, 2, 3].map((id) => ({
  id: `c${id}`,
  categoryId: id,
  categoryGroupId: id,
  name: `Category ${id}`,
  fundingPriority: id === 3 ? 4 : 1,
  isGroup: false,
  totalTransactions: 0,
  assigned: asMilli(id === 1 ? 80_000 : 0),
  available: asMilli(id === 1 ? 80_000 : 0),
  activity: asMilli(0),
}));
const budgetRows = (selected: BudgetRow[]) =>
  selected.map(
    (row) =>
      ({
        CategoryID: row.categoryId,
        Category: row.name,
        FundingPriority: row.fundingPriority,
        Assigned: row.assigned,
        Available: row.available,
        Activity: row.activity,
      }) as GetMonthlyBudgetRow
  );
const panel = (selection: number[] = [], readyToAssign = 60_000) => (
  <BudgetContextPanel
    budgetId={7}
    currentMonth="2026-09"
    readyToAssign={readyToAssign}
    globalLocalizer={formatter}
    selectedCategoryIds={selection}
    transformedRows={rows}
  />
);
const dropdown = (selection: number[] = [], readyToAssign = 60_000) =>
  renderHook(() =>
    useAssignDropdownState({
      budgetId: 7,
      currentMonth: '2026-09',
      readyToAssign,
      budgetData: budgetRows(
        selection.length ? rows.filter((row) => selection.includes(row.categoryId)) : rows
      ),
      goals: mock.goals,
      globalLocalizer: formatter,
      allowOverAssignment: mock.over,
    })
  );

beforeEach(() => {
  mock.batch.mockReset().mockResolvedValue(undefined);
  mock.priorities.mockReset().mockResolvedValue(undefined);
  mock.distribution = 'proportional-shortfall';
  mock.over = false;
  mock.ready = true;
  mock.goalsReady = true;
  mock.cyclesReady = true;
  mock.goals = [1, 2, 3].map((id) => ({
    ID: id,
    CategoryID: id,
    Type: GoalType.MONTHLY_SAVINGS,
    Purpose: GoalPurpose.SAVINGS,
    Target: asMilli(100_000),
    StartDate: '2026-01-01',
  }));
});

describe('goal funding surfaces', () => {
  it.each(['proportional-shortfall', 'equal-completion'])(
    'assign dropdown and full-budget panel agree: %s',
    async (distribution) => {
      mock.distribution = distribution;
      const hook = dropdown();
      await act(() => hook.result.current.handleAutoAssignUnderfunded());
      const assignments = mock.batch.mock.calls[0][0];
      expect(assignments).toEqual(
        distribution === 'equal-completion'
          ? [{ categoryId: 2, amount: 60_000, month: '2026-09', budgetId: 7 }]
          : [
              { categoryId: 1, amount: 90_000, month: '2026-09', budgetId: 7 },
              { categoryId: 2, amount: 50_000, month: '2026-09', budgetId: 7 },
            ]
      );
      mock.batch.mockClear();
      render(panel());
      expect(screen.queryByLabelText('Funding priority')).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: /Fund underfunded/ }));
      expect(mock.batch.mock.calls[0][0]).toEqual(assignments);
    }
  );

  it('limits funding and priority edits to selected categories, including Mixed', async () => {
    render(panel([1, 3]));
    expect(screen.getByRole('spinbutton')).toHaveValue(null);
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '8' } });
    await userEvent.click(screen.getByRole('button', { name: 'Apply priority' }));
    expect(mock.priorities).toHaveBeenCalledWith({ budgetId: 7, categoryIds: [1, 3], priority: 8 });
    await userEvent.click(screen.getByRole('button', { name: /Fund underfunded/ }));
    expect(mock.batch.mock.calls[0][0]).toEqual([
      { categoryId: 1, amount: 100_000, budgetId: 7, month: '2026-09' },
      { categoryId: 3, amount: 40_000, budgetId: 7, month: '2026-09' },
    ]);
  });

  it('shows a shared priority for matching selections', () => {
    render(panel([1, 2]));
    expect(screen.getByRole('spinbutton')).toHaveValue(1);
  });

  it.each([false, true])(
    'honors over-assignment in both full-budget surfaces: %s',
    async (over) => {
      mock.over = over;
      const hook = dropdown([], -100);
      await act(() => hook.result.current.handleAutoAssignUnderfunded());
      if (over)
        expect(mock.batch.mock.calls[0][0].map((a: { amount: number }) => a.amount)).toEqual([
          100_000, 100_000, 100_000,
        ]);
      else expect(mock.batch).not.toHaveBeenCalled();
      mock.batch.mockClear();
      render(panel([], -100));
      const button = screen.getByRole('button', { name: /Fund underfunded/ });
      if (over) {
        await userEvent.click(button);
        expect(mock.batch).toHaveBeenCalledTimes(1);
      } else expect(button).toBeDisabled();
    }
  );

  it.each([false, true])('honors over-assignment for a single selected goal: %s', async (over) => {
    mock.over = over;
    render(panel([2], 10_000));
    await userEvent.click(screen.getByRole('button', { name: /Fund goal/ }));
    expect(mock.batch.mock.calls[0][0]).toEqual([
      { categoryId: 2, amount: over ? 100_000 : 10_000, budgetId: 7, month: '2026-09' },
    ]);
  });

  it.each(['ready', 'goalsReady', 'cyclesReady'] as const)(
    'waits for required data: %s',
    async (key) => {
      mock.goals[0].Type = GoalType.YEARLY;
      mock.goals[0].TargetDate = '2026-12-31';
      mock[key] = false;
      const hook = dropdown();
      expect(hook.result.current.fundingReady).toBe(false);
      await act(() => hook.result.current.handleAutoAssignUnderfunded());
      render(panel());
      expect(screen.getByRole('button', { name: /Fund underfunded/ })).toBeDisabled();
      expect(mock.batch).not.toHaveBeenCalled();
    }
  );
});
