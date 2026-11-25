import { DatabaseAdapter } from '../../database/interface.js';
import { insertRawRow, type RawRow } from '../../database/restore-rows.js';
import { asMilli, type MilliUnits } from '../../money/index.js';
import { convertScaled, isCryptoCurrency } from '../../currencies/index.js';
import { lookupStoredRate } from '../currency/display-rate.js';
import { getLocalDateString } from '../../utils/date.js';
import { NotFoundError, ValidationError } from '../../types/index.js';
import {
  Goal,
  GoalType,
  GoalPurpose,
  GOAL_CYCLE_MONTHS_ERROR,
  isValidCycleMonths,
  isValidGoalCurrencyCode,
  goalRow,
  type GoalRateSource,
} from './types.js';
import { GoalQueries } from './queries.js';
import {
  describeGoalTimeframeChange,
  effectiveFromForStartDate,
  goalEffectiveFrom,
  goalEffectiveTo,
  planGoalTimeframeChange,
  resolveGoalForMonth,
  resolveGoalsForMonth,
  validateGoalTimeframeChange,
  type GoalTimeframeChange,
  type GoalTimeframeNotice,
} from './timeframes.js';
import { allRows, atomically } from '../../database/sql.js';
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
  COMPUTED_GOAL_FIELDS,
  goalRow,
  isValidGoalCurrencyCode,
  goalTargetCurrency,
  goalTargetInBudgetCurrency,
  goalInBudgetCurrency,
  type GoalRateSource,
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

export * from './timeframes.js';

/** Goal fields of one timeframe (setGoalFrom). */
export interface GoalFields {
  type: GoalType;
  purpose?: GoalPurpose;
  target: MilliUnits;
  /** Cycle anchor (YYYY-MM-DD) for target-date and repeating goals. */
  startDate: string;
  targetDate: string;
  recurring?: boolean;
  cycleMonths?: number | null;
  /** Currency of `target`; null/omitted = the budget currency. */
  targetCurrency?: string | null;
}

/** This month (YYYY-MM) by the services' clock. */
function currentMonth(): string {
  return getLocalDateString().slice(0, 7);
}

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

export const GOAL_CURRENCY_ERROR =
  'Goal currency must be a three-letter fiat currency code (crypto goals are not supported)';

export class GoalService {
  private queries: GoalQueries;

  constructor(private db: DatabaseAdapter) {
    this.queries = new GoalQueries(db);
  }

  /** The budget (ID and currency) a category belongs to, or null. */
  private budgetOfCategory(categoryId: number): { id: number; currency: string } | null {
    const row = allRows<{ ID: number; DisplayCurrency: string }>(
      this.db,
      `SELECT b.ID, b.DisplayCurrency FROM categories c JOIN budgets b ON b.ID = c.BudgetID
       WHERE c.ID = ?`,
      categoryId
    )[0];
    return row ? { id: row.ID, currency: row.DisplayCurrency } : null;
  }

  /**
   * The TargetCurrency to store: null for the budget currency (also when the
   * arg is absent, which is how older builds' payloads mean it), else an
   * upper-case fiat code. Crypto is refused: goal targets are fiat amounts.
   */
  private normalizeTargetCurrency(categoryId: number, value: unknown): string | null {
    if (value === undefined || value === null || value === '') return null;
    const code = typeof value === 'string' ? value.trim().toUpperCase() : value;
    if (!isValidGoalCurrencyCode(code) || isCryptoCurrency(code)) {
      throw new ValidationError(GOAL_CURRENCY_ERROR, 'TargetCurrency');
    }
    const budgetCurrency = this.budgetOfCategory(categoryId)?.currency;
    return budgetCurrency && budgetCurrency.toUpperCase() === code ? null : code;
  }

  /**
   * Adds TargetConverted / TargetRateSource to goals whose target is in
   * another currency than their budget's: the target at today's rate, from
   * this device's rates (custom, official, manual, then the newest cached;
   * 1:1 with source 'missing' when there is none yet). Pure read.
   */
  withBudgetCurrencyTargets(goals: Goal[]): Goal[] {
    if (!goals.some((goal) => typeof goal.TargetCurrency === 'string' && goal.TargetCurrency)) {
      return goals;
    }
    const today = getLocalDateString();
    const budgets = new Map<number, { id: number; currency: string } | null>();
    const rates = new Map<string, { rate: number; source: GoalRateSource }>();
    return goals.map((goal) => {
      const raw = goal.TargetCurrency;
      if (typeof raw !== 'string' || raw === '') return goal;
      if (!budgets.has(goal.CategoryID)) {
        budgets.set(goal.CategoryID, this.budgetOfCategory(goal.CategoryID));
      }
      const budget = budgets.get(goal.CategoryID);
      const currency = raw.toUpperCase();
      if (!budget || currency === budget.currency.toUpperCase()) return goal;
      const key = `${budget.id}:${currency}`;
      let found = rates.get(key);
      if (!found) {
        const stored = lookupStoredRate(this.db, currency, budget.currency, today, budget.id);
        found = stored ?? { rate: 1, source: 'missing' };
        rates.set(key, found);
      }
      let converted: MilliUnits;
      try {
        converted = asMilli(convertScaled(goal.Target, found.rate, currency, budget.currency));
      } catch {
        // An out-of-range product: count the target as is rather than fail the read.
        converted = goal.Target;
        found = { rate: 1, source: 'missing' };
      }
      return { ...goal, TargetConverted: converted, TargetRateSource: found.source };
    });
  }

  /**
   * Distinct foreign target currencies of the goals and their budget, for
   * callers that want fresh rates before reading (see the app's useGoals).
   */
  getForeignGoalCurrencies(): { budgetId: number; budgetCurrency: string; currency: string }[] {
    return allRows<{ budgetId: number; budgetCurrency: string; currency: string }>(
      this.db,
      `SELECT DISTINCT b.ID AS budgetId, b.DisplayCurrency AS budgetCurrency,
              UPPER(g.TargetCurrency) AS currency
       FROM goals g JOIN categories c ON c.ID = g.CategoryID JOIN budgets b ON b.ID = c.BudgetID
       WHERE g.TargetCurrency IS NOT NULL AND g.TargetCurrency != ''
         AND UPPER(g.TargetCurrency) != UPPER(b.DisplayCurrency)`
    );
  }

  /**
   * CreateGoal - Creates a new savings or spending goal.
   *
   * Without `timeframe.from` the timeframe starts in StartDate's month, as
   * for goals written by older builds, and the category must have no goal yet
   * (older builds' unique goal per category). A category already having a
   * timeframe starting in that month is an error (setGoalFrom replaces one).
   */
  createGoal(
    goalType: GoalType,
    categoryId: number,
    target: MilliUnits,
    startDate: string,
    targetDate: string,
    purpose: GoalPurpose = GoalPurpose.SPENDING,
    recurring = false,
    cycleMonths?: number | null,
    timeframe: { from?: string | null; to?: string | null } = {},
    /** Currency of `target`; null/omitted = the budget currency. */
    targetCurrency?: string | null
  ): number {
    const from = timeframe.from ?? effectiveFromForStartDate(startDate);
    const to = timeframe.to ?? null;
    const invalid = validateGoalTimeframeChange({ kind: 'set', from, to });
    if (invalid) throw new ValidationError(invalid, 'EffectiveFrom');
    const chain = this.queries.getTimeframes(categoryId);
    if (timeframe.from == null && timeframe.to == null && chain.length > 0) {
      // A create without a timeframe is the shape v1.21 builds send and apply:
      // there it hits UNIQUE(CategoryID) once the category has a goal (e.g. two
      // devices creating the first goal offline). Fail the same way, so every
      // device ends up with the one goal the first create made.
      throw new Error('UNIQUE constraint failed: goals.CategoryID');
    }
    if (chain.some((goal) => goalEffectiveFrom(goal) === from)) {
      throw new ValidationError(`Category ${categoryId} already has a goal starting in ${from}`);
    }
    const currency = this.normalizeTargetCurrency(categoryId, targetCurrency);
    return this.queries.createGoal(
      goalType,
      categoryId,
      target,
      startDate,
      targetDate,
      purpose,
      recurring,
      normalizeCycleMonths(recurring, cycleMonths, null),
      from,
      to,
      currency
    );
  }

  /** Every timeframe of a category's goal, in chain order. */
  getGoalTimeframes(categoryId: number): Goal[] {
    return this.withBudgetCurrencyTargets(this.queries.getTimeframes(categoryId));
  }

  /**
   * GetGoalByCategoryID - The category's goal that applies in `month`
   * (YYYY-MM; default: this month). Throws NotFoundError when none does.
   */
  getGoalByCategoryID(categoryId: number, month: string = currentMonth()): Goal {
    const goal = resolveGoalForMonth(this.queries.getTimeframes(categoryId), month);
    if (!goal) {
      throw new NotFoundError(`Goal for category ${categoryId} not found`);
    }
    return this.withBudgetCurrencyTargets([goal])[0];
  }

  /** GetGoalsByCategoryIDs - These categories' goals that apply in `month` (default: this month). */
  getGoalsByCategoryIDs(categoryIds: number[], month: string = currentMonth()): Goal[] {
    return this.withBudgetCurrencyTargets(
      resolveGoalsForMonth(this.queries.getTimeframesForCategories(categoryIds), month)
    );
  }

  /** Every category's goal that applies in `month` (YYYY-MM). */
  getGoalsForMonth(month: string): Goal[] {
    return this.withBudgetCurrencyTargets(resolveGoalsForMonth(this.queries.getAllGoals(), month));
  }

  /**
   * DeleteGoal - Deletes one goal row (one timeframe) by ID
   */
  deleteGoal(goalId: number): void {
    this.queries.deleteGoal(goalId);
  }

  /** Removes the category's goal from every month (all timeframes). */
  deleteGoalsForCategory(categoryId: number): void {
    this.queries.deleteGoalsForCategory(categoryId);
  }

  /** Undo of a goal delete: the row as it was, under its own ID. */
  restoreGoal(goal: RawRow): void {
    if (!Number.isSafeInteger(Number(goal?.ID)) || Number(goal.ID) <= 0) {
      throw new ValidationError('A restored goal needs its original ID');
    }
    insertRawRow(this.db, 'goals', goalRow(goal as Partial<Goal>) as RawRow);
  }

  /**
   * UpdateGoal - Updates one timeframe of the category's goal in place.
   *
   * `effectiveFrom` names the timeframe. Without it (payloads from older
   * builds, which know one goal per category) the latest timeframe is
   * updated; a category with a single timeframe then starts it in the new
   * StartDate's month, the value older builds' devices get from migration
   * 081, so both end up with the same row.
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
    startDate?: string | null,
    effectiveFrom?: string | null,
    /** Currency of `target`; null/omitted = the budget currency (older builds' payloads). */
    targetCurrency?: string | null
  ): void {
    const chain = this.queries.getTimeframes(categoryId);
    const currentGoal =
      effectiveFrom != null
        ? chain.find((goal) => goalEffectiveFrom(goal) === effectiveFrom)
        : chain[chain.length - 1];
    if (!currentGoal) {
      throw new NotFoundError(`Goal for category ${categoryId} not found`);
    }
    const nextRecurring = recurring ?? !!currentGoal.Recurring;
    const nextStartDate = startDate ?? currentGoal.StartDate;
    const legacySingle = effectiveFrom == null && chain.length === 1;
    this.queries.updateGoalRow(currentGoal.ID, {
      type: goalType,
      purpose: purpose ?? currentGoal.Purpose,
      target,
      targetDate,
      recurring: nextRecurring,
      cycleMonths: normalizeCycleMonths(
        nextRecurring,
        cycleMonths,
        currentGoal.CycleMonths ?? null
      ),
      startDate: nextStartDate,
      effectiveFrom: legacySingle
        ? effectiveFromForStartDate(nextStartDate)
        : goalEffectiveFrom(currentGoal),
      effectiveTo: goalEffectiveTo(currentGoal),
      targetCurrency: this.normalizeTargetCurrency(categoryId, targetCurrency),
    });
  }

  /**
   * The category's goal from `from` (YYYY-MM) to `to` (inclusive; null =
   * until the next timeframe starts). A timeframe starting in `from` is
   * replaced in place; otherwise a new one is added and the one before keeps
   * the earlier months. Returns the row's ID.
   */
  setGoalFrom(categoryId: number, from: string, to: string | null, fields: GoalFields): number {
    const change: GoalTimeframeChange = { kind: 'set', from, to: to ?? null };
    const invalid = validateGoalTimeframeChange(change);
    if (invalid) throw new ValidationError(invalid, 'EffectiveFrom');
    return atomically(this.db, () => {
      const chain = this.queries.getTimeframes(categoryId);
      const plan = planGoalTimeframeChange(chain, change);
      const recurring = fields.recurring ?? false;
      const purpose = fields.purpose ?? GoalPurpose.SPENDING;
      const currency = this.normalizeTargetCurrency(categoryId, fields.targetCurrency);
      if (plan.overwrite !== null) {
        const stored = chain.find((goal) => goal.ID === plan.overwrite)!;
        this.queries.updateGoalRow(plan.overwrite, {
          type: fields.type,
          purpose,
          target: fields.target,
          targetDate: fields.targetDate,
          recurring,
          cycleMonths: normalizeCycleMonths(
            recurring,
            fields.cycleMonths,
            stored.CycleMonths ?? null
          ),
          startDate: fields.startDate,
          effectiveFrom: from,
          effectiveTo: to ?? null,
          targetCurrency: currency,
        });
        return plan.overwrite;
      }
      return this.queries.createGoal(
        fields.type,
        categoryId,
        fields.target,
        fields.startDate,
        fields.targetDate,
        purpose,
        recurring,
        normalizeCycleMonths(recurring, fields.cycleMonths, null),
        from,
        to ?? null,
        currency
      );
    });
  }

  /**
   * Ends the category's goal from `month` (YYYY-MM) onwards: timeframes
   * starting in or after it are removed and the one before ends the month
   * before. Months before `month` keep the goal they had; when no timeframe
   * starts before `month`, the goal is removed from every month.
   */
  endGoalFrom(categoryId: number, month: string): void {
    const change: GoalTimeframeChange = { kind: 'endFrom', month };
    const invalid = validateGoalTimeframeChange(change);
    if (invalid) throw new ValidationError(invalid, 'EffectiveTo');
    atomically(this.db, () => {
      const plan = planGoalTimeframeChange(this.queries.getTimeframes(categoryId), change);
      for (const id of plan.delete) this.queries.deleteGoal(id);
      for (const bounds of plan.bounds) {
        this.queries.setTimeframeBounds(bounds.id, bounds.from, bounds.to);
      }
    });
  }

  /** Notices for a change to the category's chain (see describeGoalTimeframeChange). */
  describeTimeframeChange(
    categoryId: number,
    change: GoalTimeframeChange,
    options: { editing?: Goal | null; viewedMonth?: string } = {}
  ): GoalTimeframeNotice<Goal>[] {
    return describeGoalTimeframeChange(this.queries.getTimeframes(categoryId), change, options);
  }

  /**
   * GetAllGoals - Every goal row: all timeframes of every category. Use
   * getGoalsForMonth (or resolveGoalsForMonth) for the goals of a month.
   */
  getAllGoals(): Goal[] {
    return this.withBudgetCurrencyTargets(this.queries.getAllGoals());
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
      const goal = this.getGoalByCategoryID(categoryId, currentMonth);
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
