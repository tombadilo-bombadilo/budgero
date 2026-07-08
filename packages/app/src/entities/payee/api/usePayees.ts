import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { useActiveSpaceId, useRuntime } from '@shared/runtime/runtime-provider';
import { resolveSpaceKey } from '@shared/lib/query-utils';

/**
 * Returns the list of distinct payees for the given budget.
 * Payees are derived from transactions and cached per space/budget combination.
 */
export function usePayees(budgetId: number | null | undefined) {
  const runtime = useRuntime();
  const spaceId = useActiveSpaceId();
  const spaceKey = resolveSpaceKey(spaceId);
  const normalizedBudgetId = typeof budgetId === 'number' ? budgetId : null;
  const enabled = Boolean(spaceId) && Boolean(normalizedBudgetId && normalizedBudgetId > 0);

  const query = useQuery<string[]>({
    queryKey: ['payees', spaceKey, normalizedBudgetId],
    enabled,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      if (!spaceId || !normalizedBudgetId) {
        return [];
      }
      const services = runtime.services();
      const names = services.payees.getPayeesWithUsage(normalizedBudgetId).map((p) => p.Name);

      const unique = Array.from(new Set(names.map((n) => n.trim()).filter(Boolean)));
      return unique.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    },
    initialData: [],
  });

  const prevBudgetIdRef = useRef<number | null>(null);
  const { refetch, isFetching } = query;

  useEffect(() => {
    if (!enabled || typeof normalizedBudgetId !== 'number' || normalizedBudgetId <= 0) {
      return;
    }

    if (prevBudgetIdRef.current !== normalizedBudgetId) {
      prevBudgetIdRef.current = normalizedBudgetId;
      if (!isFetching) {
        void refetch();
      }
    }
  }, [enabled, normalizedBudgetId, refetch, isFetching]);

  return query;
}
