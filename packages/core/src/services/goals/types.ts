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
  BudgetID?: number;
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
