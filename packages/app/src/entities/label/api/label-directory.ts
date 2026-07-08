import { useQuery, useMutation } from '@tanstack/react-query';

import { useRuntime, useActiveSpaceId } from '@shared/runtime/runtime-provider';
import { executeSpaceMutation } from '@shared/runtime/mutation-router';
import { resolveSpaceKey } from '@shared/lib/query-utils';
import type { LabelListItem } from '@budgero/core/browser';

export function useLabelDirectory(budgetId: number | null | undefined) {
  const runtime = useRuntime();
  const spaceId = useActiveSpaceId();
  const spaceKey = resolveSpaceKey(spaceId);
  const normalizedBudgetId = typeof budgetId === 'number' ? budgetId : null;
  const enabled = Boolean(spaceId) && Boolean(normalizedBudgetId && normalizedBudgetId > 0);

  return useQuery<LabelListItem[]>({
    queryKey: ['labelDirectory', spaceKey, normalizedBudgetId],
    enabled,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      if (!spaceId || !normalizedBudgetId) {
        return [];
      }

      const services = runtime.services();
      return services.labels.getLabelsWithUsage(normalizedBudgetId);
    },
  });
}

export function useAddLabel() {
  const runtime = useRuntime();

  return useMutation<number, Error, { budgetId: number; name: string; color: string }>({
    mutationFn: async ({ budgetId, name, color }) => {
      return executeSpaceMutation<number>(runtime, {
        op: 'labels.add',
        payload: { budgetId, name, color },
        meta: { label: 'useAddLabel' },
      });
    },
  });
}

export function useUpdateLabel() {
  const runtime = useRuntime();

  return useMutation<void, Error, { id: number; budgetId: number; name: string; color: string }>({
    mutationFn: async ({ id, budgetId, name, color }) => {
      await executeSpaceMutation<void>(runtime, {
        op: 'labels.update',
        payload: { id, budgetId, name, color },
        meta: { label: 'useUpdateLabel' },
      });
    },
  });
}

export function useDeleteLabel() {
  const runtime = useRuntime();

  return useMutation<void, Error, { id: number; budgetId: number }>({
    mutationFn: async ({ id, budgetId }) => {
      await executeSpaceMutation<void>(runtime, {
        op: 'labels.delete',
        payload: { id, budgetId },
        meta: { label: 'useDeleteLabel' },
      });
    },
  });
}
