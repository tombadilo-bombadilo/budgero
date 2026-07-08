/**
 * Monthly budgets service type definitions
 * These types use PascalCase for API consistency
 */

import type { MilliUnits } from '../../money/index.js';

/**
 * Assignment type - represents a monthly budget assignment
 */
export interface Assignment {
  ID: number;
  CategoryID: number;
  Amount: MilliUnits;
  Month: string;
  BudgetID: number;
}

/**
 * Funding source - represents money moved from a spending category to CC Payment
 */
export interface FundingSource {
  categoryId: number;
  categoryName: string;
  amount: MilliUnits;
}

/**
 * Monthly budget row - represents a row in the monthly budget view
 */
export interface GetMonthlyBudgetRow {
  Category: string;
  CategoryID: number;
  CategoryGroup: string;
  CategoryGroupID: number;
  TotalTransactionCount: number;
  Assigned: MilliUnits;
  Activity: MilliUnits;
  Available: MilliUnits;
  /** For CC Payment categories: breakdown of where funding came from */
  fundingBreakdown?: FundingSource[];
  /** For CC Payment categories: total funded from spending categories */
  totalFunded?: MilliUnits;
  /**
   * For CC Payment categories: the linked card's signed balance as of the end
   * of the viewed month (negative = debt). Display-only — lets the UI show
   * "what you owe" next to "what you've set aside" and flag over-assignment.
   */
  cardBalance?: MilliUnits;
}

export interface AssignmentsByMonthRow {
  Month: string;
  TotalAssigned: MilliUnits;
}
