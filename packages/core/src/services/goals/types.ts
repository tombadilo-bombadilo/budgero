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
}

/**
 * Helper to get valid goal types for a purpose
 */
export function getValidTypesForPurpose(purpose: GoalPurpose): GoalType[] {
  if (purpose === GoalPurpose.SPENDING) {
    return [GoalType.MONTHLY, GoalType.YEARLY];
  }
  return [GoalType.TARGET_DATE, GoalType.MONTHLY_SAVINGS];
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
  BudgetID?: number;
}
