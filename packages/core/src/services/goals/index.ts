import { DatabaseAdapter } from '../../database/interface.js';
import { insertRawRow, type RawRow } from '../../database/restore-rows.js';
import type { MilliUnits } from '../../money/index.js';
import { getLocalDateString } from '../../utils/date.js';
import { NotFoundError, ValidationError } from '../../types/index.js';
import {
  Goal,
  GoalType,
  GoalPurpose,
  GOAL_CYCLE_MONTHS_ERROR,
  isValidCycleMonths,
} from './types.js';
import { GoalQueries } from './queries.js';
import {
  GoalCalculations,
  GoalProgress,
  CategoryFinancials,
  MonthlyAssignment,
  MonthlyActivity,
} from './calculations.js';
import type { GetMonthlyBudgetRow } from '../monthly-budgets/types.js';

/**
 * GoalService - Port of Go goals service
 * Handles savings goals and target management
 *
 * All methods match the Go implementation in internal/goals/goals.go
 */
// Re-export types for convenience
export {
  type Goal,
  GoalType,
  GoalPurpose,
  getValidTypesForPurpose,
  requiresTargetDate,
  getCycleMonths,
  describeGoalCycle,
  isValidCycleMonths,
  DEFAULT_GOAL_CYCLE_MONTHS,
  MIN_GOAL_CYCLE_MONTHS,
  MAX_GOAL_CYCLE_MONTHS,
  GOAL_CYCLE_MONTHS_ERROR,
} from './types.js';

export type {
  GoalProgress,
  GoalStatus,
  GoalBreakdown,
  TimeMetrics,
  CategoryFinancials,
  MonthlyAssignment,
  MonthlyActivity,
} from './calculations.js';

// Export GoalCalculations for pure calculations without database access
export { GoalCalculations } from './calculations.js';

/**
 * Resolve the CycleMonths value to store.
 * - Not recurring → always null (cadence is meaningless).
 * - `undefined` (key absent, e.g. an older client's payload) → keep the stored value.
 * - `null` (explicit clear) → null, which reads back as the yearly default.
 * - A number → must be a valid cadence, else ValidationError.
 */
function normalizeCycleMonths(
  recurring: boolean,
  cycleMonths: number | null | undefined,
  stored: number | null
): number | null {
  if (!recurring) return null;
  if (cycleMonths === undefined) return stored;
  if (cycleMonths === null) return null;
  if (!isValidCycleMonths(cycleMonths)) {
    throw new ValidationError(GOAL_CYCLE_MONTHS_ERROR, 'CycleMonths');
  }
  return cycleMonths;
}

export class GoalService {
  private queries: GoalQueries;

  constructor(private db: DatabaseAdapter) {
    this.queries = new GoalQueries(db);
  }

  /**
   * CreateGoal - Creates a new savings or spending goal
   */
  createGoal(
    goalType: GoalType,
    categoryId: number,
    target: MilliUnits,
    startDate: string,
    targetDate: string,
    purpose: GoalPurpose = GoalPurpose.SPENDING,
    recurring = false,
    cycleMonths?: number | null
  ): number {
    return this.queries.createGoal(
      goalType,
      categoryId,
      target,
      startDate,
      targetDate,
      purpose,
      recurring,
      normalizeCycleMonths(recurring, cycleMonths, null)
    );
  }

  /**
   * GetGoalByCategoryID - Gets goal for a specific category
   */
  getGoalByCategoryID(categoryId: number): Goal {
    const goal = this.queries.getGoalsForCategory(categoryId);
    if (!goal) {
      throw new NotFoundError(`Goal for category ${categoryId} not found`);
    }
    return goal;
  }

  /**
   * GetGoalsByCategoryIDs - Gets goals for multiple categories
   */
  getGoalsByCategoryIDs(categoryIds: number[]): Goal[] {
    return this.queries.getGoalsByCategoryIDs(categoryIds);
  }

  /**
   * DeleteGoal - Deletes a goal by ID
   */
  deleteGoal(goalId: number): void {
    this.queries.deleteGoal(goalId);
  }

  /** Undo of a goal delete: the row as it was, under its own ID. */
  restoreGoal(goal: RawRow): void {
    if (!Number.isSafeInteger(Number(goal?.ID)) || Number(goal.ID) <= 0) {
      throw new ValidationError('A restored goal needs its original ID');
    }
    insertRawRow(this.db, 'goals', goal);
  }

  /**
   * UpdateGoal - Updates a goal with conditional field updates
   *
   * IMPORTANT: The Go implementation has a specific behavior:
   * 1. Gets the current goal
   * 2. Only updates fields that are different from current values
   * 3. Parameters order in Go: categoryID, target, goalType, endDate
   */
  updateGoal(
    categoryId: number,
    target: MilliUnits,
    goalType: GoalType,
    targetDate: string,
    purpose?: GoalPurpose,
    recurring?: boolean,
    cycleMonths?: number | null,
    /** New start date (YYYY-MM-DD); omitted/null keeps the stored one. */
    startDate?: string | null
  ): void {
    // Get current goal
    const currentGoal = this.getGoalByCategoryID(categoryId);
    const nextRecurring = recurring ?? !!currentGoal.Recurring;

    // Call update with SQL parameter order: type, purpose, target, target_date, recurring, cycle, start, category_id
    this.queries.updateGoal(
      goalType,
      target,
      targetDate,
      categoryId,
      purpose ?? currentGoal.Purpose,
      nextRecurring,
      normalizeCycleMonths(nextRecurring, cycleMonths, currentGoal.CycleMonths ?? null),
      startDate ?? null
    );
  }

  /**
   * GetAllGoals - Gets all goals
   *
   * Note: This method is NOT in the original Go service but was added in the TypeScript version
   * It's kept for backward compatibility
   */
  getAllGoals(): Goal[] {
    return this.queries.getAllGoals();
  }

  /**
   * CalculateGoalProgress - Calculate progress for a specific goal
   *
   * This is the main calculation method that should be used by the frontend
   * It consolidates all goal calculation logic in one place
   *
   * Note: Currency formatting should be done by the frontend using the
   * appropriate Intl.NumberFormat localizer
   */
  calculateGoalProgress(
    goal: Goal | null,
    finances: CategoryFinancials,
    currentMonth: string
  ): GoalProgress {
    return GoalCalculations.calculateProgress(goal, finances, currentMonth);
  }

  /**
   * CalculateGoalProgressByCategoryId - Calculate progress for a category's goal
   *
   * Convenience method that fetches the goal and calculates progress
   */
  calculateGoalProgressByCategoryId(
    categoryId: number,
    finances: CategoryFinancials,
    currentMonth: string
  ): GoalProgress {
    try {
      const goal = this.getGoalByCategoryID(categoryId);
      return this.calculateGoalProgress(goal, finances, currentMonth);
    } catch {
      // No goal found, return empty progress
      return this.calculateGoalProgress(null, finances, currentMonth);
    }
  }

  /**
   * ValidateGoal - Validate goal configuration before saving
   *
   * Returns validation result with any errors found
   */
  validateGoal(goal: Partial<Goal>): { valid: boolean; errors: string[] } {
    return GoalCalculations.validateGoal(goal);
  }

  /**
   * GetCategoryFinancials - Fetch complete financial data for goal calculations
   *
   * This method fetches all necessary data for accurate goal calculations:
   * - Current month's budget data (available, assigned, activity)
   * - Historical assignments and activity
   * - Future planned assignments
   *
   * @param categoryId - The category to get financials for
   * @param currentMonth - The current month (YYYY-MM format)
   * @param budgetRow - Optional monthly budget row if already fetched
   * @returns Complete CategoryFinancials for goal calculations
   */
  getCategoryFinancials(
    categoryId: number,
    currentMonth: string,
    budgetRow?: GetMonthlyBudgetRow
  ): CategoryFinancials {
    // Full assignment history (≈ one row per assigned month). Long-running
    // and multi-year-cycle goals need more than a year of it; the query
    // default caps at 240 rows.
    const historicalAssignments = this.queries.getHistoricalAssignments(categoryId, currentMonth);

    // Get historical activity (spending/income)
    const historicalActivity = this.queries.getHistoricalActivity(categoryId, currentMonth, 12);

    // Get future assignments (for planned contributions)
    // Look up to 12 months ahead
    const [year, month] = currentMonth.split('-').map(Number);
    const futureDate = new Date(year, month + 11, 1); // 12 months from current
    const futureMonth = getLocalDateString(futureDate).slice(0, 7);

    const plannedAssignments = this.queries.getFutureAssignments(
      categoryId,
      currentMonth,
      futureMonth
    );

    if (!budgetRow) {
      // If no budget row provided, return with just historical/future data
      return {
        available: 0,
        assigned: 0,
        activity: 0,
        historicalAssignments,
        historicalActivity,
        plannedAssignments,
      };
    }

    return {
      available: budgetRow.Available || 0,
      assigned: budgetRow.Assigned || 0,
      activity: budgetRow.Activity || 0,
      previousBalance: budgetRow.Available - budgetRow.Assigned - budgetRow.Activity,
      historicalAssignments,
      historicalActivity,
      plannedAssignments,
    };
  }

  /**
   * GetHistoricalAssignments - Get historical assignments for a category
   *
   * @param categoryId - The category to get assignments for
   * @param beforeMonth - Get assignments before this month
   * @param limit - Number of months to retrieve (default: 12)
   */
  getHistoricalAssignments(
    categoryId: number,
    beforeMonth: string,
    limit = 12
  ): MonthlyAssignment[] {
    return this.queries.getHistoricalAssignments(categoryId, beforeMonth, limit);
  }

  /**
   * GetFutureAssignments - Get planned future assignments for a category
   *
   * @param categoryId - The category to get assignments for
   * @param fromMonth - Get assignments from this month onwards
   * @param toMonth - Optional end month for the range
   */
  getFutureAssignments(
    categoryId: number,
    fromMonth: string,
    toMonth?: string
  ): MonthlyAssignment[] {
    return this.queries.getFutureAssignments(categoryId, fromMonth, toMonth);
  }

  /**
   * GetHistoricalActivity - Get historical spending/income for a category
   *
   * @param categoryId - The category to get activity for
   * @param beforeMonth - Get activity before this month
   * @param limit - Number of months to retrieve (default: 12)
   */
  getHistoricalActivity(categoryId: number, beforeMonth: string, limit = 12): MonthlyActivity[] {
    return this.queries.getHistoricalActivity(categoryId, beforeMonth, limit);
  }
}
