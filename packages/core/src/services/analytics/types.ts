/**
 * Analytics service type definitions
 * These types use PascalCase for API consistency
 */

import type { MilliUnits } from '../../money/index.js';

export interface SpendingByDateRow {
  Date: string;
  Spending: MilliUnits;
}

export interface SpendingByDateAndCategoryGroupRow {
  Date: string;
  Spending: MilliUnits;
  CategoryGroupID: number;
  CategoryGroupName: string;
}

export interface SpendingByCategoryRow {
  CategoryID: number;
  CategoryName: string;
  Spending: MilliUnits;
}

export interface MonthlyBalanceRow {
  Date: string;
  Balance: MilliUnits;
}

export interface AnalyticsPeriodSummaryRow {
  StartDate: string;
  EndDate: string;
  TotalSpending: MilliUnits;
  TotalIncome: MilliUnits;
  NetCashflow: MilliUnits;
  /** Rounded to integer milliunits in SQL — an average, not an exact sum. */
  AverageDailySpending: MilliUnits;
  ActiveDays: number;
  PeriodDays: number;
  TransactionCount: number;
}

export interface TopSpendingCategoryRow {
  CategoryID: number;
  CategoryName: string;
  CategoryGroupName: string | null;
  Spending: MilliUnits;
}

export interface IncomeExpenseByPeriodRow {
  Period: string;
  PeriodStart: string;
  PeriodEnd: string;
  TotalIncome: MilliUnits;
  TotalExpense: MilliUnits;
}

export interface SpendingTotalsByPeriodRow {
  Period: string;
  PeriodStart: string;
  PeriodEnd: string;
  TotalSpending: MilliUnits;
}

export interface CategoryTotalsByPeriodRow {
  CategoryID: number | null;
  CategoryName: string | null;
  CategoryGroupID: number | null;
  CategoryGroupName: string | null;
  Period: string;
  PeriodStart: string;
  PeriodEnd: string;
  TotalIncome: MilliUnits;
  TotalOutflow: MilliUnits;
}

export interface SpendingByLabelRow {
  LabelID: number | null;
  Label: string;
  LabelColor: string;
  Spending: MilliUnits;
}

export interface SpendingByPayeeRow {
  Payee: string;
  Spending: MilliUnits;
}
