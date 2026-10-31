import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { GoalPurpose, GoalType, type Goal, type GetMonthlyBudgetRow } from '@budgero/core/browser';
import { useUiStore } from '@shared/store/useUiStore';
import { transformBudgetRows } from '../../lib/budget-transforms';
import { DesktopBudgetTableView } from './DesktopBudgetTableView';
import { getMonthlyTarget, type BudgetGroupTotals, type Sensors } from '.';

vi.mock('@features/budget-planning/ui/AvailableInfoPopover', () => ({
  AvailableInfoPopover: () => null,
}));

vi.mock('@entities/budget/api/useGoalFundingSettings', () => ({
  useGoalFundingSettings: () => ({
    CategoryPriorityMode: 'five-levels',
    ShowCategoryPriorities: true,
    isReady: true,
  }),
}));

vi.mock('@shared/hooks/useUserPreferences', () => ({
  useCompactBudgetRows: () => ({ data: false }),
}));

const MONTH = '2026-10';

const budgetRow = (categoryId: number, category: string, assigned: number): GetMonthlyBudgetRow =>
  ({
    CategoryID: categoryId,
    Category: category,
    CategoryGroupID: 1,
    CategoryGroup: 'Bills',
    Assigned: assigned,
    Activity: 0,
    Available: assigned,
    TotalTransactionCount: 0,
  }) as unknown as GetMonthlyBudgetRow;

const goal = (categoryId: number, target: number, type: GoalType): Goal => ({
  ID: categoryId,
  CategoryID: categoryId,
  Type: type,
  Purpose: GoalPurpose.SPENDING,
  Target: target as Goal['Target'],
  StartDate: '2026-10-01',
});

const rows = transformBudgetRows(
  [budgetRow(1, 'Rent', 1_000_000), budgetRow(2, 'Phone', 30_000), budgetRow(3, 'Misc', 0)],
  [goal(1, 1_200_000, GoalType.MONTHLY), goal(2, 50_000, GoalType.MONTHLY)],
  MONTH
);

function groupTotals(): Map<string, BudgetGroupTotals> {
  const totals = new Map<string, BudgetGroupTotals>();
  for (const row of rows) {
    if (row.isGroup || !row.parentId) continue;
    const current = totals.get(row.parentId) ?? { assigned: 0, activity: 0, available: 0 };
    current.assigned += row.assigned;
    const target = getMonthlyTarget(row);
    if (target !== null) current.target = (current.target ?? 0) + target;
    totals.set(row.parentId, current);
  }
  return totals;
}

function renderTable() {
  render(
    <DesktopBudgetTableView
      data={rows}
      collapsedGroups={new Set()}
      groupTotals={groupTotals()}
      onToggleGroup={() => {}}
      onAddCategory={() => {}}
      onUpdateGroup={async () => {}}
      onDeleteGroup={async () => {}}
      onEditCategory={() => {}}
      onDeleteCategory={() => {}}
      onUpdateAssignment={async () => {}}
      onActivityClick={() => {}}
      globalLocalizer={new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })}
      currentMonth={MONTH}
      selectedBudgetId={1}
      disableSelection
      disableDrag
      sensors={[] as unknown as Sensors}
      onDragStart={() => {}}
      onDragOver={() => {}}
      onDragEnd={() => {}}
      overId={null}
    />
  );
}

describe('DesktopBudgetTableView target column', () => {
  afterEach(() => {
    if (useUiStore.getState().showBudgetTargetColumn) {
      useUiStore.getState().toggleBudgetTargetColumn();
    }
  });

  it('is hidden by default', () => {
    renderTable();
    expect(screen.queryByRole('columnheader', { name: 'Target' })).toBeNull();
    expect(screen.queryByTestId('target-rent')).toBeNull();
  });

  it('shows each goal target, a dash without a goal, and the group subtotal', () => {
    useUiStore.getState().toggleBudgetTargetColumn();
    renderTable();

    expect(screen.getByRole('columnheader', { name: 'Target' })).toBeInTheDocument();
    expect(screen.getByTestId('target-rent')).toHaveTextContent('$1,200.00');
    expect(screen.getByTestId('target-phone')).toHaveTextContent('$50.00');
    expect(screen.getByTestId('target-misc')).toHaveTextContent('—');

    const groupRow = screen.getByText('Bills').closest('tr');
    expect(groupRow).not.toBeNull();
    expect(within(groupRow as HTMLElement).getByText('$1,250.00')).toBeInTheDocument();
  });

  it('remembers the choice on this device', () => {
    useUiStore.getState().toggleBudgetTargetColumn();
    expect(localStorage.getItem('budgero:budget-target-column')).toBe('1');
    useUiStore.getState().toggleBudgetTargetColumn();
    expect(localStorage.getItem('budgero:budget-target-column')).toBeNull();
  });
});
