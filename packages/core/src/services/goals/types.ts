/**
 * Goals service type definitions
 */

import type { MilliUnits } from '../../money/index.js';

/**
 * Goal purpose - what the goal is tracking
 */
export enum GoalPurpose {
  SPENDING = 'spending', // Track spending limits/budgets
  SAVINGS = 'savings', // Track savings targets
}

/**
 * Goal type - how the goal behaves over time
 */
export enum GoalType {
  // Spending goal types
  MONTHLY = 'monthly', // Monthly spending limit that resets
  YEARLY = 'yearly', // Yearly spending budget that accumulates

  // Savings goal types
  TARGET_DATE = 'target-date', // Save a specific amount by a specific date
  MONTHLY_SAVINGS = 'monthly-savings', // Save a specific amount each month
  TARGET_BALANCE = 'target-balance', // Have a balance of X, no date and no repeat
}

/**
 * Helper to get valid goal types for a purpose
 */
export function getValidTypesForPurpose(purpose: GoalPurpose): GoalType[] {
  if (purpose === GoalPurpose.SPENDING) {
    return [GoalType.MONTHLY, GoalType.YEARLY];
  }
  return [GoalType.TARGET_DATE, GoalType.MONTHLY_SAVINGS, GoalType.TARGET_BALANCE];
}

/**
 * Check if a goal type requires a target date
 */
export function requiresTargetDate(type: GoalType): boolean {
  return type === GoalType.YEARLY || type === GoalType.TARGET_DATE;
}

/**
 * Goal - represents a financial goal for a category
 */
export interface Goal {
  ID: number;
  Type: GoalType;
  Purpose: GoalPurpose;
  CategoryID: number;
  Target: MilliUnits; // The amount to save or budget
  StartDate: string; // YYYY-MM-DD format
  TargetDate?: string; // YYYY-MM-DD format, required for YEARLY and TARGET_DATE types
  Recurring?: boolean; // Whether the goal resets each cycle (e.g., annual expenses)
  /**
   * Cycle length in months for recurring goals (12 = yearly, 3 = quarterly,
   * any 2..120). Null/undefined = default (yearly). Ignored when not Recurring.
   * Rows are read raw from SQLite, so always go through getCycleMonths().
   */
  CycleMonths?: number | null;
  /**
   * First month (YYYY-MM) of this goal's timeframe. A category can have
   * several goals, one per timeframe; see timeframes.ts for which one
   * applies in a month. Null on rows written by older builds: read it with
   * goalEffectiveFrom(). Not the same as StartDate (the cycle anchor).
   */
  EffectiveFrom?: string | null;
  /** Last month (YYYY-MM, inclusive) of an ended goal; null = until the next timeframe. */
  EffectiveTo?: string | null;
  /**
   * Currency of Target when it isn't the budget's (ISO code, fiat only).
   * Null/absent = the budget currency: every goal written before migration
   * 083, and any goal set in the budget currency. Read it with
   * goalTargetCurrency().
   */
  TargetCurrency?: string | null;
  /**
   * Computed on read, never stored: Target in the budget currency at the
   * current rate. Set only on goals whose TargetCurrency differs from the
   * budget's (see GoalService reads). Calculations use it via
   * goalInBudgetCurrency().
   */
  TargetConverted?: MilliUnits;
  /** Computed on read, never stored: where TargetConverted's rate came from. */
  TargetRateSource?: GoalRateSource;
  BudgetID?: number;
}

/**
 * Where a foreign-currency goal's conversion rate came from: the same
 * hierarchy as transactions (custom > official > manual), then the newest
 * cached official rate however old ('stale'), then none at all ('missing':
 * the target is counted 1:1 until a rate arrives, like a transaction with
 * no known rate).
 */
export type GoalRateSource = 'custom' | 'official' | 'manual' | 'stale' | 'missing';

/** Goal fields that exist only on read (never written to the goals table). */
export const COMPUTED_GOAL_FIELDS = ['TargetConverted', 'TargetRateSource'] as const;

/** A goal object without its computed fields: the stored row. */
export function goalRow<T extends Partial<Goal>>(goal: T): T {
  const row = { ...goal };
  for (const field of COMPUTED_GOAL_FIELDS) delete row[field];
  return row;
}

/** A valid currency code for a goal target (ISO-style, three letters). */
export function isValidGoalCurrencyCode(code: unknown): code is string {
  return typeof code === 'string' && /^[A-Z]{3}$/.test(code);
}

/**
 * The goal's target currency when it differs from the budget's, else null
 * (budget currency). `budgetCurrency` omitted: any stored currency counts.
 */
export function goalTargetCurrency(
  goal: Pick<Goal, 'TargetCurrency'> | null | undefined,
  budgetCurrency?: string | null
): string | null {
  const code = goal?.TargetCurrency;
  if (typeof code !== 'string' || code === '') return null;
  const upper = code.toUpperCase();
  return budgetCurrency && upper === budgetCurrency.toUpperCase() ? null : upper;
}

/**
 * The goal's target in the budget currency: TargetConverted for a goal in
 * another currency, Target otherwise. A foreign goal without a computed
 * conversion (built outside a service read) counts its Target as is.
 */
export function goalTargetInBudgetCurrency(
  goal: Pick<Goal, 'Target' | 'TargetCurrency' | 'TargetConverted'>
): MilliUnits {
  if (goalTargetCurrency(goal) && typeof goal.TargetConverted === 'number') {
    return goal.TargetConverted;
  }
  return goal.Target;
}

/** The goal with Target in the budget currency (what every calculation works with). */
export function goalInBudgetCurrency<T extends Goal>(goal: T): T {
  const target = goalTargetInBudgetCurrency(goal);
  return target === goal.Target ? goal : { ...goal, Target: target };
}

export const DEFAULT_GOAL_CYCLE_MONTHS = 12;
export const MIN_GOAL_CYCLE_MONTHS = 2;
export const MAX_GOAL_CYCLE_MONTHS = 120;

export const GOAL_CYCLE_MONTHS_ERROR =
  'Repeat every must be a whole number between 2 and 120 months (use a monthly goal type to repeat every month)';

/** True when `value` is an acceptable CycleMonths to STORE (write-side rule). */
export function isValidCycleMonths(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= MIN_GOAL_CYCLE_MONTHS &&
    value <= MAX_GOAL_CYCLE_MONTHS
  );
}

/**
 * Effective cycle length of a goal: null for non-recurring goals, otherwise
 * the stored value or the yearly default. Defensive on the read side — a
 * malformed stored value (0, negative, non-integer, string) never leaks into
 * calculations, where it could hang a loop or NaN the maths.
 */
export function getCycleMonths(goal: Pick<Goal, 'Recurring' | 'CycleMonths'>): number | null {
  if (!goal.Recurring) return null;
  const raw = goal.CycleMonths;
  const n = typeof raw === 'string' ? Number(raw) : raw;
  if (
    typeof n === 'number' &&
    Number.isInteger(n) &&
    n >= MIN_GOAL_CYCLE_MONTHS &&
    n <= MAX_GOAL_CYCLE_MONTHS
  ) {
    return n;
  }
  return DEFAULT_GOAL_CYCLE_MONTHS;
}

/**
 * Human label for a cycle length: 'yearly', 'quarterly', 'every 6 months',
 * 'every N months'. Shared by core breakdown text and the app UI so the two
 * never disagree.
 */
export function describeGoalCycle(cycleMonths: number): string {
  if (cycleMonths === 12) return 'yearly';
  if (cycleMonths === 3) return 'quarterly';
  if (cycleMonths === 1) return 'monthly';
  return `every ${cycleMonths} months`;
}
