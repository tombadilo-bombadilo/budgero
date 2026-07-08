import { DatabaseAdapter } from '../../database/interface.js';
import { getLocalDateString } from '../../utils/date.js';
import { AnalyticsQueries, type AnalyticsQueryOptions } from './queries.js';
import {
  SpendingByDateRow,
  SpendingByDateAndCategoryGroupRow,
  SpendingByCategoryRow,
  MonthlyBalanceRow,
  AnalyticsPeriodSummaryRow,
  TopSpendingCategoryRow,
  IncomeExpenseByPeriodRow,
  SpendingTotalsByPeriodRow,
  CategoryTotalsByPeriodRow,
  SpendingByLabelRow,
  SpendingByPayeeRow,
} from './types.js';

import { createLogger } from '../../logger.js';
import { ZERO_MILLI } from '../../money/index.js';

/**
 * Analytics service - handles complex analytical queries
 * Port of the Go analytics service
 */

export type { AnalyticsQueryOptions } from './queries.js';
export type {
  SpendingByDateRow,
  SpendingByDateAndCategoryGroupRow,
  SpendingByCategoryRow,
  MonthlyBalanceRow,
  AnalyticsPeriodSummaryRow,
  TopSpendingCategoryRow,
  IncomeExpenseByPeriodRow,
  SpendingTotalsByPeriodRow,
  CategoryTotalsByPeriodRow,
  SpendingByLabelRow,
  SpendingByPayeeRow,
} from './types.js';
const debugLog = createLogger('services:analytics');

export class AnalyticsService {
  private queries: AnalyticsQueries;

  constructor(private db: DatabaseAdapter) {
    this.queries = new AnalyticsQueries(db);
  }

  /**
   * Run an analytics query, returning an empty list if it throws
   * (e.g. before the relevant tables exist).
   */
  private safe<T>(fn: () => T[]): T[] {
    try {
      return fn() || [];
    } catch (error) {
      debugLog('Analytics query failed', { error, level: 'error' });
      return [];
    }
  }

  /**
   * GetSpendingByDatesByCategories - Get spending by dates and category groups
   */
  getSpendingByDatesByCategories(
    startDate: string,
    endDate: string,
    budgetId: number,
    opts?: AnalyticsQueryOptions
  ): SpendingByDateAndCategoryGroupRow[] {
    return this.safe(
      () =>
        this.queries.getSpendingByDatesByCategories(
          startDate,
          endDate,
          budgetId,
          opts
        ) as SpendingByDateAndCategoryGroupRow[]
    );
  }

  /**
   * GetSpendingByDates - Get spending by dates
   */
  getSpendingByDates(
    startDate: string,
    endDate: string,
    budgetId: number,
    opts?: AnalyticsQueryOptions
  ): SpendingByDateRow[] {
    return this.safe(
      () =>
        this.queries.getSpendingByDates(startDate, endDate, budgetId, opts) as SpendingByDateRow[]
    );
  }

  /**
   * GetSpendingByCategoriesInGroup - Get spending by categories in a specific group
   */
  getSpendingByCategoriesInGroup(
    startDate: string,
    endDate: string,
    budgetId: number,
    categoryGroupId: number,
    opts?: AnalyticsQueryOptions
  ): SpendingByCategoryRow[] {
    const results = this.queries.getSpendingByCategoriesInGroup(
      startDate,
      endDate,
      budgetId,
      categoryGroupId,
      opts
    ) as SpendingByCategoryRow[];

    return results;
  }

  getSpendingByLabels(
    startDate: string,
    endDate: string,
    budgetId: number,
    opts?: AnalyticsQueryOptions
  ): SpendingByLabelRow[] {
    return this.safe(
      () =>
        this.queries.getSpendingByLabels(startDate, endDate, budgetId, opts) as SpendingByLabelRow[]
    );
  }

  getSpendingByPayees(
    startDate: string,
    endDate: string,
    budgetId: number,
    opts?: AnalyticsQueryOptions
  ): SpendingByPayeeRow[] {
    return this.safe(
      () =>
        this.queries.getSpendingByPayees(startDate, endDate, budgetId, opts) as SpendingByPayeeRow[]
    );
  }

  // Additional methods from TypeScript implementation not in Go

  getPeriodSummary(
    startDate: string,
    endDate: string,
    budgetId: number,
    opts?: AnalyticsQueryOptions
  ): AnalyticsPeriodSummaryRow {
    const result = this.queries.getPeriodSummary(startDate, endDate, budgetId, opts) as
      | AnalyticsPeriodSummaryRow
      | undefined;

    return (
      result || {
        StartDate: startDate,
        EndDate: endDate,
        TotalSpending: ZERO_MILLI,
        TotalIncome: ZERO_MILLI,
        NetCashflow: ZERO_MILLI,
        AverageDailySpending: ZERO_MILLI,
        ActiveDays: 0,
        PeriodDays: 0,
        TransactionCount: 0,
      }
    );
  }

  getTopSpendingCategories(
    startDate: string,
    endDate: string,
    budgetId: number,
    limit = 5,
    opts?: AnalyticsQueryOptions
  ): TopSpendingCategoryRow[] {
    return this.safe(
      () =>
        this.queries.getTopSpendingCategories(
          startDate,
          endDate,
          budgetId,
          limit,
          opts
        ) as TopSpendingCategoryRow[]
    );
  }

  getIncomeExpenseByPeriod(
    startDate: string,
    endDate: string,
    budgetId: number,
    grouping: 'day' | 'week' | 'month' | 'quarter',
    accountIds?: number[],
    opts?: AnalyticsQueryOptions
  ): IncomeExpenseByPeriodRow[] {
    return this.safe(
      () =>
        this.queries.getIncomeExpenseByPeriod(
          startDate,
          endDate,
          budgetId,
          grouping,
          accountIds,
          opts
        ) as IncomeExpenseByPeriodRow[]
    );
  }

  getSpendingTotalsByPeriod(
    startDate: string,
    endDate: string,
    budgetId: number,
    grouping: 'day' | 'week' | 'month' | 'quarter',
    categoryIds?: number[],
    accountIds?: number[],
    opts?: AnalyticsQueryOptions
  ): SpendingTotalsByPeriodRow[] {
    return this.safe(
      () =>
        this.queries.getSpendingTotalsByPeriod(
          startDate,
          endDate,
          budgetId,
          grouping,
          categoryIds,
          accountIds,
          opts
        ) as SpendingTotalsByPeriodRow[]
    );
  }

  getCategoryTotalsByPeriod(
    startDate: string,
    endDate: string,
    budgetId: number,
    grouping: 'day' | 'week' | 'month' | 'quarter',
    categoryIds?: number[],
    accountIds?: number[],
    opts?: AnalyticsQueryOptions
  ): CategoryTotalsByPeriodRow[] {
    return this.safe(
      () =>
        this.queries.getCategoryTotalsByPeriod(
          startDate,
          endDate,
          budgetId,
          grouping,
          categoryIds,
          accountIds,
          opts
        ) as CategoryTotalsByPeriodRow[]
    );
  }

  /**
   * Get total balance for on-budget accounts only
   */
  getOnBudgetBalance(budgetId: number, asOfDate?: string): number {
    const today = asOfDate ?? getLocalDateString();
    const result = this.queries.getOnBudgetBalance(budgetId, today) as
      | { TotalBalance: number }
      | undefined;
    return result?.TotalBalance || 0;
  }

  /**
   * Get daily balance for on-budget accounts over a date range
   */
  getOnBudgetBalanceByDates(
    startDate: string,
    endDate: string,
    budgetId: number
  ): MonthlyBalanceRow[] {
    return this.safe(() => {
      const results = this.queries.getOnBudgetBalanceByDates(
        startDate,
        endDate,
        budgetId
      ) as MonthlyBalanceRow[];
      debugLog('getOnBudgetBalanceByDates query results:', results);
      return results;
    });
  }
}
