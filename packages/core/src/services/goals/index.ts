import { DatabaseAdapter } from '../../database/interface.js';
import type { MilliUnits } from '../../money/index.js';
import { getLocalDateString } from '../../utils/date.js';
import { NotFoundError } from '../../types/index.js';
import { Goal, GoalType, GoalPurpose } from './types.js';
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
    recurring = false
  ): number {
    return this.queries.createGoal(
      goalType,
      categoryId,
      target,
      startDate,
      targetDate,
      purpose,
      recurring
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
    recurring?: boolean
  ): void {
    // Get current goal
    const currentGoal = this.getGoalByCategoryID(categoryId);

    // Call update with SQL parameter order: type, purpose, target, target_date, recurring, category_id
    this.queries.updateGoal(
      goalType,
      target,
      targetDate,
      categoryId,
      purpose ?? currentGoal.Purpose,
      recurring ?? !!currentGoal.Recurring
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
    // Get historical data (up to 12 months back)
    const historicalAssignments = this.queries.getHistoricalAssignments(
      categoryId,
      currentMonth,
      12
    );

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
