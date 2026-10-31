import type { Goal } from '@budgero/core/browser';
import { useSpaceQuery } from '@shared/api/useSpaceQuery';
import { INCOME_GROUP_NAME, TRANSFERS_GROUP_NAME } from './analytics-model';
import { monthTarget, needsCycleHistory, type TargetMonthInput } from './target-report';

/**
 * Per category and month: assigned, spent, and the goal's target for that
 * month with how much of it was funded. Keyed under 'monthlyBudget' so
 * assignment and goal changes refetch it.
 */
export function useTargetData(months: string[], budgetId: number) {
  return useSpaceQuery<TargetMonthInput[]>({
    key: ['monthlyBudget', 'targetReport', months.join('_'), budgetId],
    enabled: months.length > 0 && budgetId > 0,
    queryFn: (services) => {
      const goals = new Map<number, Goal>(
        services.goals.getAllGoals().map((goal) => [goal.CategoryID, goal])
      );
      return months.map((monthKey) => ({
        monthKey,
        rows: services.monthlyBudgets
          .getMonthlyBudget(monthKey, budgetId)
          .filter(
            (row) =>
              row.CategoryGroup !== INCOME_GROUP_NAME && row.CategoryGroup !== TRANSFERS_GROUP_NAME
          )
          .map((row) => {
            const goal = goals.get(row.CategoryID);
            const finances = needsCycleHistory(goal)
              ? services.goals.getCategoryFinancials(row.CategoryID, monthKey, row)
              : {
                  available: Number(row.Available) || 0,
                  assigned: Number(row.Assigned) || 0,
                  activity: Number(row.Activity) || 0,
                };
            return {
              categoryId: row.CategoryID,
              category: row.Category,
              group: row.CategoryGroup,
              assigned: Number(row.Assigned) || 0,
              spent: Math.max(0, -Number(row.Activity)),
              ...monthTarget(goal, monthKey, finances),
            };
          }),
      }));
    },
  });
}
