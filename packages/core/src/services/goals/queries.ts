import { DatabaseAdapter } from '../../database/interface.js';
import { allRows, run } from '../../database/sql.js';
import { Goal, GoalType, GoalPurpose } from './types.js';
import { sortGoalTimeframes } from './timeframes.js';
import type { MonthlyAssignment, MonthlyActivity } from './calculations.js';

/**
 * GoalQueries - All SQL queries for goals
 * Ported from sql/goals.sql
 */
export class GoalQueries {
  constructor(private db: DatabaseAdapter) {}

  /**
   * CreateGoal - Creates a goal row (one timeframe of the category's chain)
   */
  createGoal(
    type: GoalType,
    categoryId: number,
    target: number,
    startDate: string,
    targetDate: string,
    purpose: GoalPurpose = GoalPurpose.SPENDING,
    recurring = false,
    cycleMonths: number | null = null,
    effectiveFrom: string | null = null,
    effectiveTo: string | null = null,
    targetCurrency: string | null = null
  ): number {
    const result = run(
      this.db,
      `
      INSERT INTO goals (Type, Purpose, CategoryID, Target, StartDate, TargetDate, Recurring, CycleMonths,
                         EffectiveFrom, EffectiveTo, TargetCurrency)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      type,
      purpose,
      categoryId,
      target,
      startDate,
      targetDate,
      recurring ? 1 : 0,
      // Never bind undefined — sql.js throws on unknown bind types.
      cycleMonths ?? null,
      effectiveFrom ?? null,
      effectiveTo ?? null,
      targetCurrency ?? null
    );
    return Number(result.lastInsertRowid);
  }

  /** Every timeframe of a category's goal, in chain order. */
  getTimeframes(categoryId: number): Goal[] {
    return sortGoalTimeframes(
      allRows<Goal>(this.db, 'SELECT * FROM goals WHERE CategoryID = ?', categoryId)
    );
  }

  /** Every timeframe of these categories' goals. */
  getTimeframesForCategories(categoryIds: number[]): Goal[] {
    const valid = categoryIds.filter((id) => typeof id === 'number' && !isNaN(id) && id > 0);
    const results: Goal[] = [];
    // Individual queries (safe fallback for sql.js IN clause issues)
    for (const categoryId of valid) results.push(...this.getTimeframes(categoryId));
    return results;
  }

  /**
   * DeleteGoal - Deletes a goal row by ID
   * SQL: DELETE FROM goals WHERE id = ?
   */
  deleteGoal(id: number): void {
    run(this.db, 'DELETE FROM goals WHERE ID = ?', id);
  }

  /** Deletes every timeframe of a category's goal. */
  deleteGoalsForCategory(categoryId: number): void {
    run(this.db, 'DELETE FROM goals WHERE CategoryID = ?', categoryId);
  }

  /** Replaces a goal row's fields (and its timeframe bounds). */
  updateGoalRow(
    id: number,
    fields: {
      type: GoalType;
      purpose: GoalPurpose;
      target: number;
      targetDate: string;
      recurring: boolean;
      cycleMonths: number | null;
      startDate: string;
      effectiveFrom: string | null;
      effectiveTo: string | null;
      /** Null = the budget currency. */
      targetCurrency: string | null;
    }
  ): void {
    run(
      this.db,
      `
      UPDATE goals
      SET Type = ?, Purpose = ?, Target = ?, TargetDate = ?, Recurring = ?, CycleMonths = ?,
          StartDate = ?, EffectiveFrom = ?, EffectiveTo = ?, TargetCurrency = ?
      WHERE ID = ?
    `,
      fields.type,
      fields.purpose,
      fields.target,
      fields.targetDate,
      fields.recurring ? 1 : 0,
      fields.cycleMonths ?? null,
      fields.startDate,
      fields.effectiveFrom ?? null,
      fields.effectiveTo ?? null,
      fields.targetCurrency ?? null,
      id
    );
  }

  /** Moves a goal row's timeframe bounds; undefined keeps a bound. */
  setTimeframeBounds(id: number, from: string | undefined, to: string | null | undefined): void {
    if (from !== undefined)
      run(this.db, 'UPDATE goals SET EffectiveFrom = ? WHERE ID = ?', from, id);
    if (to !== undefined) run(this.db, 'UPDATE goals SET EffectiveTo = ? WHERE ID = ?', to, id);
  }

  /**
   * GetAllGoals - Every goal row: all timeframes of every category.
   */
  getAllGoals(): Goal[] {
    return allRows<Goal>(this.db, 'SELECT * FROM goals ORDER BY StartDate, ID');
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
    // Rows, not months (≈ one row per assigned month). Generous default so
    // long-running goals and multi-year cycles are never silently truncated.
    limit = 240
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
        SUM(InflowConverted - OutflowConverted) as amount
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
