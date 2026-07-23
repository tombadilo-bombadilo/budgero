import { useSpaceQuery } from '@shared/api/useSpaceQuery';
import { INCOME_GROUP_NAME, TRANSFERS_GROUP_NAME, type PlanMonthInput } from './analytics-model';

/**
 * Assigned vs spent per category for every month in the range, via the same
 * monthly-budget view the Planning page uses (getMonthlyBudget is a sync
 * local-SQLite call, so sweeping N months in one query is cheap). Activity
 * is signed (spending negative); we expose spending as a positive number
 * and skip Income/Transfers groups — a plan report is about outflows.
 */
export function usePlanData(months: string[], budgetId: number) {
  return useSpaceQuery<PlanMonthInput[]>({
    key: ['analyticsPlanVsReality', months.join('_'), budgetId],
    enabled: months.length > 0 && budgetId > 0,
    queryFn: (services) =>
      months.map((monthKey) => ({
        monthKey,
        rows: services.monthlyBudgets
          .getMonthlyBudget(monthKey, budgetId)
          .filter(
            (row) =>
              row.CategoryGroup !== INCOME_GROUP_NAME && row.CategoryGroup !== TRANSFERS_GROUP_NAME
          )
          .map((row) => ({
            categoryId: row.CategoryID,
            category: row.Category,
            group: row.CategoryGroup,
            assigned: row.Assigned,
            spent: Math.max(0, -Number(row.Activity)),
          })),
      })),
  });
}
