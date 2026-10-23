import { t } from '@lingui/core/macro';
import {
  GoalCalculations,
  type GetMonthlyBudgetRow,
  type FundingSource,
  type DebtSource,
  type Goal,
  type CategoryFinancials,
  type GoalProgress,
  type CategoryDeletionImpact,
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
  /**
   * All-time transaction count. Not part of the monthly budget rows; the
   * budget table fills it in on the row it opens the delete dialog for.
   */
  totalTransactions?: number;
  /**
   * What deleting the category removes or moves (all months, goal, schedule).
   * Like totalTransactions, read on demand for the row being deleted.
   */
  deletionImpact?: CategoryDeletionImpact;
  /** Set when the category can't be deleted; the menu shows it instead of Delete. */
  deleteBlockedReason?: string;
  isGroup: boolean;
  parentId?: string;
  categoryId: number;
  fundingPriority?: number;
  categoryGroupId?: number;
  goalStatus?: 'funded' | 'offtrack' | 'none';
  goal?: Goal;
  /**
   * Cycle-aware progress for the row's goal (computed with the assignment
   * history the yearly/target-date calculators need). Row consumers should
   * prefer this over recomputing from the single month's numbers.
   */
  goalProgress?: GoalProgress;
  /**
   * Group rows only: this group's share (0–1) of everything assigned in the
   * month across all groups. Undefined when nothing is assigned.
   */
  assignedShare?: number;
  /** For CC Payment categories: breakdown of where funding came from */
  fundingBreakdown?: FundingSource[];
  /** For CC Payment categories: total funded from spending categories */
  totalFunded?: MilliUnits;
  totalRefunded?: MilliUnits;
  paymentCalculation?: GetMonthlyBudgetRow['paymentCalculation'];
  /** For CC Payment categories: linked card's signed balance (negative = debt) */
  cardBalance?: MilliUnits;
  /** Current-month activity split by account kind (net; negative = spending). */
  cashActivity?: MilliUnits;
  creditActivity?: MilliUnits;
  /** For CC Payment categories: credit-overspend events that created the debt. */
  debtBreakdown?: DebtSource[];
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
  cycleFinancials?: CycleFinancialsMap,
  currencyCode?: string
): { status: 'funded' | 'offtrack' | 'none'; progress?: GoalProgress } {
  if (!goal) return { status: 'none' };
  const cycle = cycleFinancials?.[goal.CategoryID];
  const progress = GoalCalculations.calculateProgress(
    goal,
    {
      available: row.Available || 0,
      assigned: row.Assigned || 0,
      activity: row.Activity || 0,
      currencyCode,
      historicalAssignments: cycle?.historicalAssignments,
      plannedAssignments: cycle?.plannedAssignments,
    },
    currentMonth
  );
  return { status: progress.isOnTrack || progress.isFunded ? 'funded' : 'offtrack', progress };
}

/**
 * Transform raw Wails rows into BudgetRow objects with parent/child groupings and goal status.
 */
export function transformBudgetRows(
  rows: GetMonthlyBudgetRow[],
  goalsData: Goal[],
  currentMonth: string,
  cycleFinancials?: CycleFinancialsMap,
  /** Budget currency; only affects the formatted strings inside goalProgress. */
  currencyCode?: string
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
    const groupName = items[0].CategoryGroup || t`Ungrouped`;
    // Always add the group header (even for empty groups)
    result.push({
      id: groupKey,
      name: groupName,
      assigned: ZERO_MILLI,
      activity: ZERO_MILLI,
      available: ZERO_MILLI,
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
      const { status: goalStatus, progress: goalProgress } = computeGoalStatus(
        item,
        goal,
        currentMonth,
        cycleFinancials,
        currencyCode
      );

      result.push({
        // Category ID, not name: names can repeat within a group.
        id: `${groupKey}--${item.CategoryID}`,
        name: item.Category,
        assigned: item.Assigned,
        activity: item.Activity,
        available: item.Available,
        isGroup: false,
        parentId: groupKey,
        categoryId: item.CategoryID,
        fundingPriority: item.FundingPriority ?? 3,
        categoryGroupId: item.CategoryGroupID,
        goal,
        goalStatus,
        goalProgress,
        fundingBreakdown: item.fundingBreakdown,
        totalFunded: item.totalFunded,
        totalRefunded: item.totalRefunded,
        paymentCalculation: item.paymentCalculation,
        cardBalance: item.cardBalance,
        cashActivity: item.CashActivity,
        creditActivity: item.CreditActivity,
        debtBreakdown: item.debtBreakdown,
      });
    });
  });

  return result;
}
