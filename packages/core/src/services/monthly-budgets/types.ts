/**
 * Monthly budgets service type definitions
 * These types use PascalCase for API consistency
 */

import type { MilliUnits } from '../../money/index.js';
import type { RtaMode } from '../budgets/types.js';

export interface CashOverspendDetail {
  categoryId: number;
  categoryName: string;
  categoryGroupName: string;
  month: string;
  amount: MilliUnits;
}

/**
 * ReadyToAssignBreakdown - the component figures behind the Ready to Assign
 * number, so the UI can always show the full math. `futureAssignments`,
 * `priorCashOverspend` and `month` are only meaningful in 'monthly' mode
 * (`assignments` covers every month in cumulative mode).
 */
export interface ReadyToAssignBreakdown {
  mode: RtaMode;
  month: string;
  income: MilliUnits;
  /** Assigned through `month` (monthly) or across all time (cumulative). */
  assignments: MilliUnits;
  /** Reserved for breakdown compatibility; monthly historical RTA reports zero. */
  futureAssignments: MilliUnits;
  offBudgetTransfers: MilliUnits;
  inBudgetTransfers: MilliUnits;
  revaluations: MilliUnits;
  priorCashOverspend: MilliUnits;
  readyToAssign: MilliUnits;
  priorCashOverspendDetails?: CashOverspendDetail[];
}

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
 * DebtSource - one credit-overspend event that contributed unfunded debt to a
 * CC Payment category: a spending category overspent on credit in a given month
 * by `amount` that wasn't covered. Sums to the card's total credit debt created.
 */
export interface DebtSource {
  categoryId: number;
  categoryName: string;
  month: string;
  amount: MilliUnits;
}

/**
 * Monthly budget row - represents a row in the monthly budget view
 */
export interface GetMonthlyBudgetRow {
  FundingPriority?: number;
  Category: string;
  CategoryID: number;
  CategoryGroup: string;
  CategoryGroupID: number;
  TotalTransactionCount: number;
  Assigned: MilliUnits;
  Activity: MilliUnits;
  Available: MilliUnits;
  /** Current-month activity split by account kind (net; negative = spending). */
  CashActivity?: MilliUnits;
  CreditActivity?: MilliUnits;
  /** For CC Payment categories: breakdown of where funding came from */
  fundingBreakdown?: FundingSource[];
  /**
   * For CC Payment categories: the credit-overspend events (category + month)
   * that created this card's debt. Sums to total credit debt created.
   */
  debtBreakdown?: DebtSource[];
  /** For CC Payment categories: total funded from spending categories */
  totalFunded?: MilliUnits;
  /** Monthly-mode card envelope calculation; payments/refunds are positive deductions. */
  paymentCalculation?: {
    previousAvailable: MilliUnits;
    funded: MilliUnits;
    payments: MilliUnits;
    refunds: MilliUnits;
  };
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
