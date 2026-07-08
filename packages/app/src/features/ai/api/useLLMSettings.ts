import { useQuery, useMutation } from '@tanstack/react-query';
import { useActiveSpaceId, useRuntime } from '@shared/runtime/runtime-provider';
import { resolveSpaceKey } from '@shared/lib/query-utils';
import type { LLMSettings, LLMSettingsInput } from '@budgero/core/browser';

export function useLLMSettings(budgetId: number | null | undefined) {
  const runtime = useRuntime();
  const spaceId = useActiveSpaceId();
  const spaceKey = resolveSpaceKey(spaceId);
  const normalizedBudgetId = typeof budgetId === 'number' ? budgetId : null;
  const enabled = Boolean(spaceId) && Boolean(normalizedBudgetId && normalizedBudgetId > 0);

  return useQuery<LLMSettings | null>({
    queryKey: ['llmSettings', spaceKey, normalizedBudgetId],
    enabled,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      if (!spaceId || !normalizedBudgetId) {
        return null;
      }
      const services = runtime.services();
      const result = services.llmSettings.getSettings(normalizedBudgetId);
      return result;
    },
  });
}

export function useUpdateLLMSettings() {
  const runtime = useRuntime();

  return useMutation<LLMSettings, Error, { budgetId: number; input: LLMSettingsInput }>({
    mutationFn: async ({ budgetId, input }) => {
      const { result } = await runtime.mutationsRouter().execute<LLMSettings>({
        op: 'llmSettings.update',
        payload: { budgetId, input },
        meta: { label: 'llmSettings.update' },
      });
      return result;
    },
  });
}
