import {
  GoalCalculations,
  type GetMonthlyBudgetRow,
  type FundingSource,
  type Goal,
  type CategoryFinancials,
} from '@budgero/core/browser';
import { ZERO_MILLI, type MilliUnits } from '@shared/lib/currency/milli';

/**
 * Historical/planned assignments per category, needed for yearly and
 * target-date goal progress. See useCycleFinancialsForGoals.
 */
export type CycleFinancialsMap = Record<number, CategoryFinancials>;

/**
 * The internal type used by the budget table.
 */
export interface BudgetRow {
  id: string;
  name: string;
  assigned: MilliUnits;
  activity: MilliUnits;
  available: MilliUnits;
  totalTransactions: number;
  isGroup: boolean;
  parentId?: string;
  categoryId: number;
  categoryGroupId?: number;
  goalStatus?: 'funded' | 'offtrack' | 'none';
  goal?: Goal;
  /** For CC Payment categories: breakdown of where funding came from */
  fundingBreakdown?: FundingSource[];
  /** For CC Payment categories: total funded from spending categories */
  totalFunded?: MilliUnits;
  /** For CC Payment categories: linked card's signed balance (negative = debt) */
  cardBalance?: MilliUnits;
}

/**
 * Determine whether the goal is met or off track using the same calculation
 * that powers the goal-progress UI ("This month's target met!"). Yearly /
 * target-date goals don't fund the full Target in a single month — we want
 * 'funded' to mean "this month's milestone is satisfied", not "the entire
 * cycle target is in the envelope". `isOnTrack || isFunded` matches that.
 */
function computeGoalStatus(
  row: GetMonthlyBudgetRow,
  goal: Goal | undefined,
  currentMonth: string,
  cycleFinancials?: CycleFinancialsMap
): 'funded' | 'offtrack' | 'none' {
  if (!goal) return 'none';
  const cycle = cycleFinancials?.[goal.CategoryID];
  const progress = GoalCalculations.calculateProgress(
    goal,
    {
      available: row.Available || 0,
      assigned: row.Assigned || 0,
      activity: row.Activity || 0,
      historicalAssignments: cycle?.historicalAssignments,
      plannedAssignments: cycle?.plannedAssignments,
    },
    currentMonth
  );
  return progress.isOnTrack || progress.isFunded ? 'funded' : 'offtrack';
}

/**
 * Transform raw Wails rows into BudgetRow objects with parent/child groupings and goal status.
 */
export function transformBudgetRows(
  rows: GetMonthlyBudgetRow[],
  goalsData: Goal[],
  currentMonth: string,
  cycleFinancials?: CycleFinancialsMap
): BudgetRow[] {
  if (!Array.isArray(rows)) {
    return [];
  }

  const goals = goalsData ?? [];
  const goalMap = new Map(goals.map((g) => [g.CategoryID, g]));

  const grouped = new Map<string, GetMonthlyBudgetRow[]>();
  for (const row of rows) {
    // Use CategoryGroupID as the key to handle duplicate group names
    const groupKey = `${row.CategoryGroupID}-${row.CategoryGroup || 'Ungrouped'}`;
    if (!grouped.has(groupKey)) {
      grouped.set(groupKey, []);
    }
    const group = grouped.get(groupKey);
    if (group) {
      group.push(row);
    }
  }

  const result: BudgetRow[] = [];

  grouped.forEach((items, groupKey) => {
    const groupName = items[0].CategoryGroup || 'Ungrouped';
    const totalTransactionsForGroup = items.reduce(
      (sum, item) => sum + (item.TotalTransactionCount || 0),
      0
    );

    // Always add the group header (even for empty groups)
    result.push({
      id: groupKey,
      name: groupName,
      assigned: ZERO_MILLI,
      activity: ZERO_MILLI,
      available: ZERO_MILLI,
      totalTransactions: totalTransactionsForGroup,
      isGroup: true,
      categoryId: -1,
      categoryGroupId: items[0].CategoryGroupID,
    });

    // Add individual categories - skip only truly empty category names, not empty groups
    items.forEach((item) => {
      if ((item.Category || '').trim() === '') {
        return;
      }

      const goal = goalMap.get(item.CategoryID);
      const goalStatus = computeGoalStatus(item, goal, currentMonth, cycleFinancials);

      result.push({
        id: `${groupKey}--${item.Category}`,
        name: item.Category,
        assigned: item.Assigned,
        activity: item.Activity,
        available: item.Available,
        totalTransactions: item.TotalTransactionCount,
        isGroup: false,
        parentId: groupKey,
        categoryId: item.CategoryID,
        categoryGroupId: item.CategoryGroupID,
        goal,
        goalStatus,
        fundingBreakdown: item.fundingBreakdown,
        totalFunded: item.totalFunded,
        cardBalance: item.cardBalance,
      });
    });
  });

  return result;
}
