import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { Budget } from '@budgero/core/browser';
import {
  useRuntime,
  useActiveSpaceId,
  useRuntimeInitialized,
} from '@shared/runtime/runtime-provider';
import { executeSpaceMutation, requireActiveSpaceId } from '@shared/runtime/mutation-router';
import { useUiStore } from '@shared/store/useUiStore';

import { getBudgetsQueryOptions, syncBudgetStateFromRuntime } from '@shared/runtime/budget-gate';

export function useBudgets() {
  const runtime = useRuntime();
  const spaceId = useActiveSpaceId();
  // Reactive, NOT runtime.isInitialized(): `enabled` must re-arm when an
  // in-place init/switchSpace lands, or the query stays disabled and the
  // budget gate splash never resolves (invite-redeem stuck-loading bug).
  const runtimeInitialized = useRuntimeInitialized();
  return useQuery<Budget[]>({
    ...getBudgetsQueryOptions(runtime, spaceId),
    enabled: Boolean(spaceId) && runtimeInitialized,
  });
}

export type AddBudgetInput = {
  name: string;
  displayCurrency: string;
  badgeIcon: string;
  number_format: string;
  create_default_categories: boolean;
};
export function useAddBudget() {
  const qc = useQueryClient();
  const runtime = useRuntime();
  return useMutation<number, Error, AddBudgetInput>({
    mutationFn: async (input: AddBudgetInput) => {
      try {
        const spaceId = requireActiveSpaceId(runtime);

        const spec = {
          op: 'budgets.create',
          payload: {
            name: input.name,
            displayCurrency: input.displayCurrency,
            badgeIcon: input.badgeIcon,
            numberFormat: input.number_format,
            createDefaultCategories: input.create_default_categories,
            spaceId,
          },
          meta: { label: 'useAddBudget' },
        };

        return await executeSpaceMutation<number>(runtime, spec);
      } catch (error) {
        console.error('[useAddBudget] Error in mutation:', error);
        throw error;
      }
    },
    onSuccess: (budgetId) => {
      const spaceId = runtime.getActiveSpaceId();
      if (spaceId) {
        syncBudgetStateFromRuntime({
          runtime,
          queryClient: qc,
          spaceId,
          preferredBudgetId: budgetId,
        });
      }
    },
  });
}

export type UpdateBudgetNameInput = { id: number; name: string };
export function useUpdateBudgetName() {
  const runtime = useRuntime();
  return useMutation<void, Error, UpdateBudgetNameInput>({
    mutationFn: async ({ id, name }: UpdateBudgetNameInput) => {
      await executeSpaceMutation<void>(runtime, {
        op: 'budgets.updateName',
        payload: { id, name },
        meta: { label: 'useUpdateBudgetName' },
      });
    },
  });
}

export type UpdateBudgetCurrencyInput = { id: number; currency: string };
export function useUpdateBudgetCurrency() {
  const qc = useQueryClient();
  const { setCurrencyConversion, resetCurrencyConversion } = useUiStore.getState();
  const runtime = useRuntime();

  return useMutation<void, Error, UpdateBudgetCurrencyInput>({
    mutationFn: async ({ id, currency }: UpdateBudgetCurrencyInput) => {
      setCurrencyConversion({
        isActive: true,
        message: 'Updating budget currency and recalculating all transactions...',
      });

      try {
        const mutationManager = runtime.mutationsRouter();
        await mutationManager.execute<void>({
          op: 'budgets.updateCurrency',
          payload: { id, currency },
          meta: { label: 'useUpdateBudgetCurrency' },
        });

        // Invalidate all queries to refresh everything with new currency
        await qc.invalidateQueries();
      } catch (error) {
        setCurrencyConversion({
          error: 'Failed to update currency. Please try again.',
        });
        throw error;
      } finally {
        // Hide overlay after a short delay to ensure UI updates
        setTimeout(() => {
          resetCurrencyConversion();
        }, 500);
      }
    },
  });
}

export type UpdateBudgetIconInput = { id: number; icon: string };
export function useUpdateBudgetIcon() {
  const runtime = useRuntime();
  return useMutation<void, Error, UpdateBudgetIconInput>({
    mutationFn: async ({ id, icon }: UpdateBudgetIconInput) => {
      const mutationManager = runtime.mutationsRouter();
      await mutationManager.execute<void>({
        op: 'budgets.updateIcon',
        payload: { id, icon },
        meta: { label: 'useUpdateBudgetIcon' },
      });
    },
  });
}

export type UpdateBudgetNumberFormatInput = { id: number; format: string };
export function useUpdateBudgetNumberFormat() {
  const runtime = useRuntime();
  return useMutation<void, Error, UpdateBudgetNumberFormatInput>({
    mutationFn: async ({ id, format }: UpdateBudgetNumberFormatInput) => {
      const mutationManager = runtime.mutationsRouter();
      await mutationManager.execute<void>({
        op: 'budgets.updateNumberFormat',
        payload: { id, format },
        meta: { label: 'useUpdateBudgetNumberFormat' },
      });
    },
  });
}

export function useDeleteBudget() {
  const qc = useQueryClient();
  const runtime = useRuntime();
  return useMutation<void, Error, number>({
    mutationFn: async (id: number) => {
      const mutationManager = runtime.mutationsRouter();
      await mutationManager.execute<void>({
        op: 'budgets.delete',
        payload: { id },
        meta: { label: 'useDeleteBudget' },
      });
    },
    onSuccess: () => {
      const spaceId = runtime.getActiveSpaceId();
      if (spaceId) {
        syncBudgetStateFromRuntime({
          runtime,
          queryClient: qc,
          spaceId,
        });
      }
    },
  });
}
