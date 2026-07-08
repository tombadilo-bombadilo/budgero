import { DatabaseAdapter } from '../../database/interface.js';
import { getRow, allRows, run } from '../../database/sql.js';
import { Goal, GoalType, GoalPurpose } from './types.js';
import type { MonthlyAssignment, MonthlyActivity } from './calculations.js';

/**
 * GoalQueries - All SQL queries for goals
 * Ported from sql/goals.sql
 */
export class GoalQueries {
  constructor(private db: DatabaseAdapter) {}

  /**
   * CreateGoal - Creates a new goal
   */
  createGoal(
    type: GoalType,
    categoryId: number,
    target: number,
    startDate: string,
    targetDate: string,
    purpose: GoalPurpose = GoalPurpose.SPENDING,
    recurring = false
  ): number {
    const result = run(
      this.db,
      `
      INSERT INTO goals (Type, Purpose, CategoryID, Target, StartDate, TargetDate, Recurring)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
      type,
      purpose,
      categoryId,
      target,
      startDate,
      targetDate,
      recurring ? 1 : 0
    );
    return Number(result.lastInsertRowid);
  }

  /**
   * GetGoalsForCategory - Gets goal for a specific category
   * SQL: SELECT * FROM goals WHERE category_id = ?
   */
  getGoalsForCategory(categoryId: number): Goal | undefined {
    return getRow<Goal>(this.db, 'SELECT * FROM goals WHERE CategoryID = ?', categoryId);
  }

  /**
   * GetGoalsByCategoryIDs - Gets goals for multiple categories
   * SQL: SELECT * FROM goals WHERE category_id IN (...)
   */
  getGoalsByCategoryIDs(categoryIds: number[]): Goal[] {
    if (categoryIds.length === 0) {
      return [];
    }

    const validCategoryIds = categoryIds.filter(
      (id) => typeof id === 'number' && !isNaN(id) && id > 0
    );
    if (validCategoryIds.length === 0) {
      return [];
    }

    // Use individual queries approach (safe fallback for sql.js IN clause issues)
    const results: Goal[] = [];
    for (const categoryId of validCategoryIds) {
      const goal = this.getGoalsForCategory(categoryId);
      if (goal) {
        results.push(goal);
      }
    }
    return results;
  }

  /**
   * DeleteGoal - Deletes a goal by ID
   * SQL: DELETE FROM goals WHERE id = ?
   */
  deleteGoal(id: number): void {
    run(this.db, 'DELETE FROM goals WHERE ID = ?', id);
  }

  /**
   * UpdateGoal - Updates a goal
   *
   * Note: Parameter order matches the SQL query exactly
   */
  updateGoal(
    type: GoalType,
    target: number,
    targetDate: string,
    categoryId: number,
    purpose: GoalPurpose = GoalPurpose.SPENDING,
    recurring = false
  ): void {
    run(
      this.db,
      `
      UPDATE goals
      SET Type = ?, Purpose = ?, Target = ?, TargetDate = ?, Recurring = ?
      WHERE CategoryID = ?
    `,
      type,
      purpose,
      target,
      targetDate,
      recurring ? 1 : 0,
      categoryId
    );
  }

  /**
   * GetAllGoals - Gets all goals
   * This is not in the Go service but exists in current TS implementation
   */
  getAllGoals(): Goal[] {
    return allRows<Goal>(this.db, 'SELECT * FROM goals ORDER BY StartDate');
  }

  /**
   * GetHistoricalAssignments - Gets historical assignments for a category
   * Returns all assignments before the specified month
   *
   * @param categoryId - The category to get assignments for
   * @param beforeMonth - Get assignments before this month (YYYY-MM format)
   * @param limit - Optional limit on number of months to retrieve (default: 12)
   */
  getHistoricalAssignments(
    categoryId: number,
    beforeMonth: string,
    limit = 12
  ): MonthlyAssignment[] {
    const result = allRows<MonthlyAssignment>(
      this.db,
      `
      SELECT 
        Month as month,
        Amount as amount
      FROM assignments
      WHERE CategoryID = ?
        AND Month < ?
      ORDER BY Month DESC
      LIMIT ?
    `,
      categoryId,
      beforeMonth,
      limit
    );

    // Return in chronological order
    return result.reverse();
  }

  /**
   * GetFutureAssignments - Gets planned future assignments for a category
   * Returns all assignments after or equal to the specified month
   *
   * @param categoryId - The category to get assignments for
   * @param fromMonth - Get assignments from this month onwards (YYYY-MM format)
   * @param toMonth - Optional end month for the range (YYYY-MM format)
   */
  getFutureAssignments(
    categoryId: number,
    fromMonth: string,
    toMonth?: string
  ): MonthlyAssignment[] {
    let query = `
      SELECT 
        Month as month,
        Amount as amount
      FROM assignments
      WHERE CategoryID = ?
        AND Month > ?
    `;

    const params: (number | string)[] = [categoryId, fromMonth];

    if (toMonth) {
      query += ' AND Month <= ?';
      params.push(toMonth);
    }

    query += ' ORDER BY Month ASC';

    return allRows<MonthlyAssignment>(this.db, query, ...params);
  }

  /**
   * GetHistoricalActivity - Gets historical spending/income activity for a category
   * Returns aggregated activity (sum of transactions) per month
   *
   * @param categoryId - The category to get activity for
   * @param beforeMonth - Get activity before this month (YYYY-MM format)
   * @param limit - Optional limit on number of months to retrieve (default: 12)
   */
  getHistoricalActivity(categoryId: number, beforeMonth: string, limit = 12): MonthlyActivity[] {
    const result = allRows<MonthlyActivity>(
      this.db,
      `
      SELECT 
        strftime('%Y-%m', Date) as month,
        SUM(Inflow - Outflow) as amount
      FROM transactions
      WHERE CategoryID = ?
        AND strftime('%Y-%m', Date) < ?
      GROUP BY strftime('%Y-%m', Date)
      ORDER BY month DESC
      LIMIT ?
    `,
      categoryId,
      beforeMonth,
      limit
    );

    // Return in chronological order
    return result.reverse();
  }
}
