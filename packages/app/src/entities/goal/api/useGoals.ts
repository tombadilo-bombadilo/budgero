import { useMemo } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
// Use runtime services directly instead of db-ops wrappers
import { useRuntime, useActiveSpaceId } from '@shared/runtime/runtime-provider';
import { executeSpaceMutation } from '@shared/runtime/mutation-router';
import { useSpaceQuery } from '@shared/api/useSpaceQuery';
import { resolveSpaceKey } from '@shared/lib/query-utils';
import { GoalPurpose, GoalType, type Goal, CategoryFinancials } from '@budgero/core/browser';
/**
 * Fetch all goals for a budget
 */
export function useGoals(budgetId: number) {
  return useSpaceQuery<Goal[]>({
    key: ['goals', budgetId],
    enabled: budgetId > 0,
    queryFn: (services) => {
      try {
        return services.goals.getAllGoals();
      } catch (error) {
        console.error('Error fetching goals:', error);
        return [];
      }
    },
  });
}

export type CreateGoalInput = {
  type: GoalType;
  purpose?: GoalPurpose;
  categoryId: number;
  target: number;
  startDate: string;
  targetDate: string;
  recurring?: boolean;
  budgetId: number; // Added for invalidation
};

export function useGoalsByCategories(categoryIds: number[]) {
  return useSpaceQuery<Goal[] | null>({
    key: ['goals', 'list', categoryIds.join('_')],
    enabled: categoryIds.length > 0,
    queryFn: (services) => {
      try {
        return services.goals.getGoalsByCategoryIDs(categoryIds);
      } catch (error) {
        console.error('Error fetching goals for categories:', error);
        return null;
      }
    },
  });
}

export function useCreateGoal() {
  const runtime = useRuntime();

  return useMutation<number, Error, CreateGoalInput>({
    mutationFn: async (input) => {
      return executeSpaceMutation<number>(runtime, {
        op: 'goals.create',
        payload: {
          goalType: input.type,
          purpose: input.purpose || GoalPurpose.SPENDING,
          categoryId: input.categoryId,
          target: input.target,
          startDate: input.startDate,
          endDate: input.targetDate,
          recurring: input.recurring ?? false,
          budgetId: input.budgetId,
        },
        meta: { label: 'useCreateGoal' },
      });
    },
  });
}

/**
 * Fetch complete category financials for goal calculations.
 * Uses GoalService.getCategoryFinancials() which fetches historical assignments,
 * historical activity, and planned assignments in a single synchronous call.
 */
export function useCategoryFinancials(
  categoryId: number,
  currentMonth: string,
  budgetRow?: { Available: number; Assigned: number; Activity: number }
) {
  const runtime = useRuntime();
  const spaceId = useActiveSpaceId();
  const spaceKey = resolveSpaceKey(spaceId);
  return useQuery<CategoryFinancials>({
    queryKey: [
      'categoryFinancials',
      spaceKey,
      categoryId,
      currentMonth,
      budgetRow?.Assigned,
      budgetRow?.Available,
      budgetRow?.Activity,
    ],
    queryFn: async () => {
      const services = runtime.services();
      return services.goals.getCategoryFinancials(
        categoryId,
        currentMonth,
        budgetRow as Parameters<typeof services.goals.getCategoryFinancials>[2]
      );
    },
    enabled: Boolean(spaceId) && Boolean(categoryId) && Boolean(currentMonth),
  });
}

/**
 * Fetch cycle financials (historical + planned assignments) for goals whose
 * progress spans multiple months. Yearly and target-date goals sum assignments
 * across their whole cycle, so computing their progress from only the current
 * month's row silently undercounts — this map supplies the missing history.
 * Monthly goal types don't need it and are skipped.
 *
 * Keyed under 'monthlyBudget' so assignment mutations' broad invalidation
 * refetches it.
 */
export function useCycleFinancialsForGoals(goals: Goal[] | null | undefined, currentMonth: string) {
  const cycleCategoryIds = useMemo(
    () =>
      (goals ?? [])
        .filter((g) => g.Type === GoalType.YEARLY || g.Type === GoalType.TARGET_DATE)
        .map((g) => g.CategoryID)
        .sort((a, b) => a - b),
    [goals]
  );

  return useSpaceQuery<Record<number, CategoryFinancials>>({
    key: ['monthlyBudget', 'cycleFinancials', currentMonth, cycleCategoryIds.join(',')],
    enabled: cycleCategoryIds.length > 0 && Boolean(currentMonth),
    queryFn: (services) => {
      const map: Record<number, CategoryFinancials> = {};
      for (const categoryId of cycleCategoryIds) {
        // Without a budget row this returns zeros for the current month plus
        // historical/planned assignments — callers merge in live row values.
        map[categoryId] = services.goals.getCategoryFinancials(categoryId, currentMonth);
      }
      return map;
    },
  });
}

/**
 * Fetch a goal for a specific category
 */
export function useGoalByCategory(categoryId: number) {
  return useSpaceQuery<Goal | null>({
    key: ['goal', categoryId],
    enabled: Boolean(categoryId),
    queryFn: (services) => {
      try {
        return services.goals.getGoalByCategoryID(categoryId);
      } catch {
        // If no goal exists, return null instead of throwing
        return null;
      }
    },
  });
}

export type UpdateGoalInput = {
  categoryId: number;
  target: number;
  type: GoalType;
  purpose?: GoalPurpose;
  targetDate: string;
  recurring?: boolean;
  budgetId: number; // Added for invalidation
};

export function useUpdateGoal() {
  const runtime = useRuntime();

  return useMutation<void, Error, UpdateGoalInput>({
    mutationFn: async (input) => {
      await executeSpaceMutation<void>(runtime, {
        op: 'goals.update',
        payload: {
          categoryId: input.categoryId,
          target: input.target,
          goalType: input.type,
          purpose: input.purpose || GoalPurpose.SPENDING,
          endDate: input.targetDate,
          recurring: input.recurring,
          budgetId: input.budgetId,
        },
        meta: { label: 'useUpdateGoal' },
      });
    },
  });
}

interface DeleteGoalInput {
  id: number;
  categoryId: number;
  budgetId: number;
}

export const useDeleteGoal = () => {
  const runtime = useRuntime();

  return useMutation({
    mutationFn: async (input: DeleteGoalInput) => {
      await executeSpaceMutation<void>(runtime, {
        op: 'goals.delete',
        payload: {
          goalId: input.id,
          categoryId: input.categoryId,
          budgetId: input.budgetId,
        },
        meta: { label: 'useDeleteGoal' },
      });
    },
  });
};
