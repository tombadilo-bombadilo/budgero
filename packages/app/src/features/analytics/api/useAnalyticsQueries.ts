import type {
  SpendingByDateRow,
  MonthlyBalanceRow,
  SpendingByDateAndCategoryGroupRow,
  SpendingByCategoryRow,
  AnalyticsPeriodSummaryRow,
  IncomeExpenseByPeriodRow,
  SpendingTotalsByPeriodRow,
  CategoryTotalsByPeriodRow,
  SpendingByLabelRow,
  SpendingByPayeeRow,
} from '@budgero/core/browser';
import { useSpaceQuery } from '@shared/api/useSpaceQuery';
import { getTodayISO } from '@shared/lib/date-utils';

/**
 * When a report range extends past today, scheduled recurring occurrences are
 * treated as posted transactions. Materializes occurrences far enough ahead
 * and returns the analytics options to pass along.
 */
function projectionOptions(
  services: {
    recurring: { ensureOccurrencesThrough: (budgetId: number, toDate: string) => void };
  },
  budgetId: number,
  endDate: string
): { includeProjections: true } | undefined {
  if (!endDate || endDate <= getTodayISO()) return undefined;
  services.recurring.ensureOccurrencesThrough(budgetId, endDate);
  return { includeProjections: true };
}

export function useSpendingByDates(startDate: string, endDate: string, budgetId: number) {
  return useSpaceQuery<SpendingByDateRow[]>({
    key: ['spendingByDates', startDate, endDate, budgetId],
    enabled: Boolean(startDate) && Boolean(endDate) && Boolean(budgetId),
    queryFn: (services) =>
      services.analytics.getSpendingByDates(
        startDate,
        endDate,
        budgetId,
        projectionOptions(services, budgetId, endDate)
      ),
  });
}

export function useSpendingByDatesByCategories(
  startDate: string,
  endDate: string,
  budgetId: number
) {
  return useSpaceQuery<SpendingByDateAndCategoryGroupRow[]>({
    key: ['spendingByDatesByCategories', startDate, endDate, budgetId],
    enabled: Boolean(startDate) && Boolean(endDate) && Boolean(budgetId),
    queryFn: (services) =>
      services.analytics.getSpendingByDatesByCategories(
        startDate,
        endDate,
        budgetId,
        projectionOptions(services, budgetId, endDate)
      ),
  });
}

export function useSpendingByCategoriesInGroup(
  startDate: string,
  endDate: string,
  budgetId: number,
  categoryGroupId: number
) {
  return useSpaceQuery<SpendingByCategoryRow[]>({
    key: ['spendingByCategoriesInGroup', startDate, endDate, budgetId, categoryGroupId],
    enabled:
      Boolean(startDate) && Boolean(endDate) && Boolean(budgetId) && Boolean(categoryGroupId),
    queryFn: (services) =>
      services.analytics.getSpendingByCategoriesInGroup(
        startDate,
        endDate,
        budgetId,
        categoryGroupId,
        projectionOptions(services, budgetId, endDate)
      ),
  });
}

/**
 * Fetch total balance for on-budget accounts only.
 */
export function useOnBudgetBalance(budgetId: number) {
  return useSpaceQuery<number>({
    key: ['onBudgetBalance', budgetId],
    enabled: Boolean(budgetId),
    queryFn: (services) => services.analytics.getOnBudgetBalance(budgetId),
  });
}

/**
 * Fetch daily balance data for on-budget accounts only.
 */
export function useOnBudgetBalanceByDates(startDate: string, endDate: string, budgetId: number) {
  return useSpaceQuery<MonthlyBalanceRow[]>({
    key: ['onBudgetBalanceByDates', startDate, endDate, budgetId],
    enabled: Boolean(startDate) && Boolean(endDate) && Boolean(budgetId),
    queryFn: (services) =>
      services.analytics.getOnBudgetBalanceByDates(startDate, endDate, budgetId),
  });
}

export function useAnalyticsPeriodSummary(startDate: string, endDate: string, budgetId: number) {
  return useSpaceQuery<AnalyticsPeriodSummaryRow>({
    key: ['analyticsPeriodSummary', startDate, endDate, budgetId],
    enabled: Boolean(startDate) && Boolean(endDate) && Boolean(budgetId),
    queryFn: (services) =>
      services.analytics.getPeriodSummary(
        startDate,
        endDate,
        budgetId,
        projectionOptions(services, budgetId, endDate)
      ),
  });
}

export function useIncomeExpenseByPeriod(
  startDate: string,
  endDate: string,
  budgetId: number,
  grouping: 'day' | 'week' | 'month' | 'quarter',
  accountIds?: number[]
) {
  const normalizedAccountIds = accountIds?.length
    ? Array.from(new Set(accountIds)).sort((a, b) => a - b)
    : undefined;
  return useSpaceQuery<IncomeExpenseByPeriodRow[]>({
    key: [
      'incomeExpenseByPeriod',
      startDate,
      endDate,
      budgetId,
      grouping,
      normalizedAccountIds?.join('_') ?? 'all',
    ],
    enabled: Boolean(startDate) && Boolean(endDate) && Boolean(budgetId),
    queryFn: (services) =>
      services.analytics.getIncomeExpenseByPeriod(
        startDate,
        endDate,
        budgetId,
        grouping,
        normalizedAccountIds,
        projectionOptions(services, budgetId, endDate)
      ),
  });
}

export function useSpendingTotalsByPeriod(
  startDate: string,
  endDate: string,
  budgetId: number,
  grouping: 'day' | 'week' | 'month' | 'quarter',
  categoryIds?: number[],
  accountIds?: number[]
) {
  const normalizedCategoryIds = categoryIds?.length
    ? Array.from(new Set(categoryIds)).sort((a, b) => a - b)
    : undefined;
  const normalizedAccountIds = accountIds?.length
    ? Array.from(new Set(accountIds)).sort((a, b) => a - b)
    : undefined;
  return useSpaceQuery<SpendingTotalsByPeriodRow[]>({
    key: [
      'spendingTotalsByPeriod',
      startDate,
      endDate,
      budgetId,
      grouping,
      normalizedCategoryIds?.join('_') ?? 'all-categories',
      normalizedAccountIds?.join('_') ?? 'all-accounts',
    ],
    enabled: Boolean(startDate) && Boolean(endDate) && Boolean(budgetId),
    queryFn: (services) =>
      services.analytics.getSpendingTotalsByPeriod(
        startDate,
        endDate,
        budgetId,
        grouping,
        normalizedCategoryIds,
        normalizedAccountIds,
        projectionOptions(services, budgetId, endDate)
      ),
  });
}

export function useCategoryTotalsByPeriod(
  startDate: string,
  endDate: string,
  budgetId: number,
  grouping: 'day' | 'week' | 'month' | 'quarter',
  categoryIds?: number[],
  accountIds?: number[]
) {
  const normalizedCategoryIds = categoryIds?.length
    ? Array.from(new Set(categoryIds)).sort((a, b) => a - b)
    : undefined;
  const normalizedAccountIds = accountIds?.length
    ? Array.from(new Set(accountIds)).sort((a, b) => a - b)
    : undefined;
  return useSpaceQuery<CategoryTotalsByPeriodRow[]>({
    key: [
      'categoryTotalsByPeriod',
      startDate,
      endDate,
      budgetId,
      grouping,
      normalizedCategoryIds?.join('_') ?? 'all-categories',
      normalizedAccountIds?.join('_') ?? 'all-accounts',
    ],
    enabled: Boolean(startDate) && Boolean(endDate) && Boolean(budgetId),
    queryFn: (services) =>
      services.analytics.getCategoryTotalsByPeriod(
        startDate,
        endDate,
        budgetId,
        grouping,
        normalizedCategoryIds,
        normalizedAccountIds,
        projectionOptions(services, budgetId, endDate)
      ),
  });
}

export function useSpendingByLabels(startDate: string, endDate: string, budgetId: number) {
  return useSpaceQuery<SpendingByLabelRow[]>({
    key: ['spendingByLabels', startDate, endDate, budgetId],
    enabled: Boolean(startDate) && Boolean(endDate) && Boolean(budgetId),
    queryFn: (services) =>
      services.analytics.getSpendingByLabels(
        startDate,
        endDate,
        budgetId,
        projectionOptions(services, budgetId, endDate)
      ),
  });
}

export function useSpendingByPayees(startDate: string, endDate: string, budgetId: number) {
  return useSpaceQuery<SpendingByPayeeRow[]>({
    key: ['spendingByPayees', startDate, endDate, budgetId],
    enabled: Boolean(startDate) && Boolean(endDate) && Boolean(budgetId),
    queryFn: (services) =>
      services.analytics.getSpendingByPayees(
        startDate,
        endDate,
        budgetId,
        projectionOptions(services, budgetId, endDate)
      ),
  });
}
