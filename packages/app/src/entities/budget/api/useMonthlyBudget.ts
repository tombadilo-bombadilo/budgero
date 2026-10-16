import { useCallback } from 'react';
import { useQuery, useMutation, keepPreviousData, useQueryClient } from '@tanstack/react-query';
import type {
  GetMonthlyBudgetRow,
  AssignmentsByMonthRow,
  ReadyToAssignBreakdown,
} from '@budgero/core/browser';
// Use runtime services directly instead of db-ops wrappers
import { useRuntime, useActiveSpaceId } from '@shared/runtime/runtime-provider';
import { executeSpaceMutation } from '@shared/runtime/mutation-router';
import { useSpaceQuery } from '@shared/api/useSpaceQuery';
import { applyOpInvalidations, resolveSpaceKey } from '@shared/lib/query-utils';
import { getTodayISO } from '@shared/lib/date-utils';
import { asMilli } from '@shared/lib/currency/milli';

/**
 * Fetch the monthly budget breakdown for a given month and budget.
 */
export function useMonthlyBudget(month: string, budgetId: number, enabled = true) {
  const runtime = useRuntime();
  const spaceId = useActiveSpaceId();
  const spaceKey = resolveSpaceKey(spaceId);
  return useQuery<GetMonthlyBudgetRow[]>({
    queryKey: ['monthlyBudget', spaceKey, month, budgetId],
    queryFn: async () => {
      if (!spaceId || !month || !budgetId) {
        return [];
      }
      const services = runtime.services();
      // Don't filter out empty groups - they should be shown
      return services.monthlyBudgets.getMonthlyBudget(month, budgetId);
    },
    enabled: enabled && Boolean(spaceId) && Boolean(month) && budgetId > 0,
    staleTime: 1000 * 60 * 5, // cache 5 minutes
    retry: 2, // Retry failed requests twice
    placeholderData: keepPreviousData, // Keep showing old data while fetching new month
  });
}

/**
 * Month an RTA query is computed through: the given month, or today's.
 * Core resolves an omitted month the same way, so callers that omit it share
 * the cache entry with the budget page's current month instead of a separate
 * 'current' copy.
 */
function resolveRtaMonth(month?: string): string {
  return month || getTodayISO().slice(0, 7);
}

const selectReadyToAssign = (breakdown: ReadyToAssignBreakdown): number => breakdown.readyToAssign;

/**
 * One cache entry per budget and month: the Ready to Assign breakdown. The
 * number is selected from it, so the figure and its help popover never
 * compute RTA twice.
 */
function useReadyToAssignQuery<TData>(
  budgetId: number,
  month: string | undefined,
  enabled: boolean,
  select?: (breakdown: ReadyToAssignBreakdown) => TData
) {
  const runtime = useRuntime();
  const spaceId = useActiveSpaceId();
  const targetMonth = resolveRtaMonth(month);
  return useQuery<ReadyToAssignBreakdown, Error, TData>({
    queryKey: ['readyToAssign', resolveSpaceKey(spaceId), budgetId, targetMonth],
    queryFn: async () => {
      if (!spaceId) {
        throw new Error('No active budget space selected');
      }
      return runtime.services().monthlyBudgets.getReadyToAssignBreakdown(budgetId, targetMonth);
    },
    enabled: enabled && Boolean(spaceId) && Boolean(budgetId),
    staleTime: 1000 * 60 * 5,
    placeholderData: keepPreviousData,
    select,
  });
}

/**
 * Fetch the "ready to assign" amount for a budget.
 *
 * In cumulative mode this is a static, month-independent figure; in monthly
 * (YNAB-style) mode it is computed through `month`. Callers on the budget page
 * pass the selected month; omit it elsewhere to get the current month.
 */
export function useReadyToAssign(budgetId: number, month?: string, enabled = true) {
  return useReadyToAssignQuery(budgetId, month, enabled, selectReadyToAssign);
}

/**
 * The component figures behind Ready to Assign (income, assignments, transfers,
 * revaluations, prior cash overspend) plus the active mode — used by the help
 * popover to always show the full math. Same cache entry as useReadyToAssign.
 */
export function useReadyToAssignBreakdown(budgetId: number, month?: string, enabled = true) {
  return useReadyToAssignQuery<ReadyToAssignBreakdown>(budgetId, month, enabled);
}

/**
 * Insert or update a monthly assignment for a category.
 */
export type UpsertAssignmentInput = {
  categoryId: number;
  amount: number;
  month: string;
  budgetId: number;
};
export function useUpsertAssignment() {
  const runtime = useRuntime();
  return useMutation<void, Error, UpsertAssignmentInput>({
    mutationFn: async (input) => {
      await executeSpaceMutation<void>(runtime, {
        op: 'monthlyBudgets.upsertAssignment',
        payload: {
          categoryId: input.categoryId,
          amount: input.amount,
          month: input.month,
          budgetId: input.budgetId,
        },
        meta: { label: 'useUpsertAssignment' },
      });
    },
  });
}

/**
 * Update an existing monthly assignment amount (patch).
 */
export type UpdateAssignmentInput = {
  categoryId: number;
  amount: number;
  month: string;
  budgetId: number;
};
export function useUpdateAssignment() {
  const runtime = useRuntime();
  return useMutation<void, Error, UpdateAssignmentInput>({
    mutationFn: async ({ categoryId, amount, month, budgetId }) => {
      await executeSpaceMutation<void>(runtime, {
        op: 'monthlyBudgets.updateAssignment',
        payload: {
          categoryId,
          amount,
          month,
          budgetId,
        },
        meta: { label: 'useUpdateAssignment' },
      });
    },
  });
}

/**
 * Reassign all assignments from one category to another.
 */
export type ReassignAssignmentsInput = {
  newCategoryId: number;
  oldCategoryId: number;
  budgetId: number;
};
export function useReassignAssignments() {
  const runtime = useRuntime();
  return useMutation<void, Error, ReassignAssignmentsInput>({
    mutationFn: async ({ newCategoryId, oldCategoryId, budgetId }) => {
      await executeSpaceMutation<void>(runtime, {
        op: 'monthlyBudgets.reassignAssignment',
        payload: {
          newCategoryId,
          oldCategoryId,
          budgetId,
        },
        meta: { label: 'useReassignAssignments' },
      });
    },
  });
}

export const useAssignmentsByMonthForCategories = (
  categoryIds: number[],
  startMonth: string,
  endMonth: string,
  budgetId: number
) => {
  const normalizedCategoryIds = categoryIds.length
    ? Array.from(new Set(categoryIds)).sort((a, b) => a - b)
    : [];

  return useSpaceQuery<AssignmentsByMonthRow[]>({
    key: [
      'assignmentsByMonthForCategories',
      normalizedCategoryIds.join('_'),
      startMonth,
      endMonth,
      budgetId,
    ],
    enabled:
      normalizedCategoryIds.length > 0 && Boolean(startMonth) && Boolean(endMonth) && budgetId > 0,
    queryFn: (services) =>
      services.monthlyBudgets.getAssignmentsByMonthForCategories(
        normalizedCategoryIds,
        startMonth,
        endMonth,
        budgetId
      ),
  });
};

interface CategoryAssignmentHelpers {
  lastMonth: Record<number, number>;
  average: Record<number, number>;
}

export const useCategoryAssignmentHelpers = (categoryIds: number[], month: string) => {
  const normalizedCategoryIds = categoryIds.length
    ? Array.from(new Set(categoryIds)).sort((a, b) => a - b)
    : [];

  return useSpaceQuery<CategoryAssignmentHelpers>({
    key: ['categoryAssignmentHelpers', normalizedCategoryIds.join('_'), month],
    enabled: normalizedCategoryIds.length > 0 && Boolean(month),
    queryFn: (services) =>
      services.monthlyBudgets.getCategoryAssignmentHelpers(normalizedCategoryIds, month),
  });
};

/**
 * Hook to get total assigned amount for budget pace calculation
 * Only includes categories that are NOT excluded from budget pace
 */
export const useTotalAssignedForBudgetPace = (months: string[], budgetId: number) => {
  return useSpaceQuery({
    key: ['totalAssignedForBudgetPace', months.join('_'), budgetId],
    enabled: months.length > 0 && budgetId > 0,
    queryFn: (services) => services.monthlyBudgets.getTotalAssignedForBudgetPace(months, budgetId),
  });
};

/**
 * Hook for batch upserting multiple assignments at once
 * Much faster than individual upserts for bulk operations
 */
export const useBatchUpsertAssignments = () => {
  const runtime = useRuntime();
  const spaceId = useActiveSpaceId();
  const spaceKey = resolveSpaceKey(spaceId);
  const queryClient = useQueryClient();

  type BatchAssignment = {
    categoryId: number;
    amount: number;
    month: string;
    budgetId: number;
  };
  type OptimisticSnapshot = {
    key: readonly unknown[];
    data: unknown;
  };

  return useMutation<void, Error, BatchAssignment[], { snapshots: OptimisticSnapshot[] }>({
    mutationFn: async (assignments) => {
      const mutationManager = runtime.mutationsRouter();
      await mutationManager.execute<void>({
        op: 'monthlyBudgets.batchUpsertAssignments',
        payload: {
          assignments,
        },
        // The cache is updated optimistically below. Recompute exact derived
        // values after persistence without keeping the action pending on it.
        meta: { label: 'useBatchUpsertAssignments', skipInvalidate: true },
      });
    },
    onMutate: async (assignments) => {
      const groups = new Map<string, BatchAssignment[]>();
      for (const assignment of assignments) {
        const groupKey = `${assignment.month}:${assignment.budgetId}`;
        const group = groups.get(groupKey) ?? [];
        group.push(assignment);
        groups.set(groupKey, group);
      }

      const snapshots: OptimisticSnapshot[] = [];
      await Promise.all(
        [...groups.values()].flatMap((group) => {
          const { month, budgetId } = group[0];
          return [
            queryClient.cancelQueries({
              queryKey: ['monthlyBudget', spaceKey, month, budgetId],
              exact: true,
            }),
            queryClient.cancelQueries({
              queryKey: ['readyToAssign', spaceKey, budgetId, month],
              exact: true,
            }),
          ];
        })
      );

      for (const group of groups.values()) {
        const { month, budgetId } = group[0];
        const monthlyBudgetKey = ['monthlyBudget', spaceKey, month, budgetId] as const;
        const previousRows = queryClient.getQueryData<GetMonthlyBudgetRow[]>(monthlyBudgetKey);
        snapshots.push({ key: monthlyBudgetKey, data: previousRows });

        let assignedDelta = 0;
        if (previousRows) {
          const amounts = new Map(
            group.map((assignment) => [assignment.categoryId, assignment.amount])
          );
          const nextRows = previousRows.map((row) => {
            const nextAssigned = amounts.get(row.CategoryID);
            if (nextAssigned === undefined) return row;
            const delta = nextAssigned - row.Assigned;
            assignedDelta += delta;
            return {
              ...row,
              Assigned: nextAssigned,
              Available: row.Available + delta,
            };
          });
          queryClient.setQueryData(monthlyBudgetKey, nextRows);
        }

        const readyToAssignKey = ['readyToAssign', spaceKey, budgetId, month] as const;
        const previousReadyToAssign =
          queryClient.getQueryData<ReadyToAssignBreakdown>(readyToAssignKey);
        snapshots.push({ key: readyToAssignKey, data: previousReadyToAssign });
        if (previousReadyToAssign !== undefined) {
          queryClient.setQueryData<ReadyToAssignBreakdown>(readyToAssignKey, {
            ...previousReadyToAssign,
            assignments: asMilli(previousReadyToAssign.assignments + assignedDelta),
            readyToAssign: asMilli(previousReadyToAssign.readyToAssign - assignedDelta),
          });
        }
      }

      return { snapshots };
    },
    onError: (_error, _assignments, context) => {
      for (const snapshot of context?.snapshots ?? []) {
        queryClient.setQueryData(snapshot.key, snapshot.data);
      }
    },
    onSuccess: () => {
      applyOpInvalidations(queryClient, 'monthlyBudgets.batchUpsertAssignments');
    },
  });
};

/**
 * Hook that provides a callable function to check if reducing a category's
 * assignment would cause overspending in future months.
 */
export function useFutureOverspendingCheck() {
  const runtime = useRuntime();

  const checkOverspending = useCallback(
    (
      categoryId: number,
      reductionAmount: number,
      currentMonth: string,
      budgetId: number
    ): { month: string; currentAvailable: number; projectedAvailable: number }[] => {
      const services = runtime.services();
      return services.monthlyBudgets.checkFutureOverspending(
        categoryId,
        reductionAmount,
        currentMonth,
        budgetId
      );
    },
    [runtime]
  );

  return { checkOverspending };
}
