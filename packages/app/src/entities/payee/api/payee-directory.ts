import { useQuery, useMutation } from '@tanstack/react-query';

import { useRuntime, useActiveSpaceId } from '@shared/runtime/runtime-provider';
import { executeSpaceMutation } from '@shared/runtime/mutation-router';
import { resolveSpaceKey } from '@shared/lib/query-utils';
import type { PayeeListItem } from '@budgero/core/browser';

export function usePayeeDirectory(budgetId: number | null | undefined) {
  const runtime = useRuntime();
  const spaceId = useActiveSpaceId();
  const spaceKey = resolveSpaceKey(spaceId);

  return useQuery<PayeeListItem[]>({
    queryKey: ['payeeDirectory', spaceKey, budgetId],
    enabled: Boolean(spaceId) && Boolean(budgetId),
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    queryFn: async () => {
      if (!spaceId || !budgetId) {
        return [];
      }
      const services = runtime.services();
      return services.payees.getPayeesWithUsage(budgetId);
    },
  });
}

export function useAddPayee() {
  const runtime = useRuntime();

  return useMutation<void, Error, { budgetId: number; name: string }>({
    mutationFn: async ({ budgetId, name }) => {
      await executeSpaceMutation<void>(runtime, {
        op: 'payees.add',
        payload: { budgetId, name },
        meta: { label: 'useAddPayee' },
      });
    },
  });
}

export function useRenamePayee() {
  const runtime = useRuntime();

  return useMutation<void, Error, { budgetId: number; oldName: string; newName: string }>({
    mutationFn: async ({ budgetId, oldName, newName }) => {
      await executeSpaceMutation<void>(runtime, {
        op: 'payees.rename',
        payload: { budgetId, oldName, newName },
        meta: { label: 'useRenamePayee' },
      });
    },
  });
}

export function useDeletePayee() {
  const runtime = useRuntime();

  return useMutation<void, Error, { budgetId: number; name: string }>({
    mutationFn: async ({ budgetId, name }) => {
      await executeSpaceMutation<void>(runtime, {
        op: 'payees.delete',
        payload: { budgetId, name },
        meta: { label: 'useDeletePayee' },
      });
    },
  });
}
