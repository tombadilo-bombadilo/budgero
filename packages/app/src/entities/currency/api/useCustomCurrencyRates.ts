import { useMutation } from '@tanstack/react-query';
import type { CustomCurrencyRate } from '@entities/currency/lib/currency-utils';
import { useRuntime } from '@shared/runtime/runtime-provider';
import { executeSpaceMutation } from '@shared/runtime/mutation-router';
import { useSpaceQuery } from '@shared/api/useSpaceQuery';

type AddCustomCurrencyRateInput = {
  fromCurrency: string;
  toCurrency: string;
  rate: number;
  startDate: string;
  endDate: string | null;
  budgetId: number;
};

type UpdateCustomCurrencyRateInput = {
  id: number;
  rate: number;
  startDate: string;
  endDate: string | null;
  budgetId: number;
};

type DeleteCustomCurrencyRateInput = {
  id: number;
  budgetId: number;
};

/**
 * Fetch all custom currency rates for a budget.
 */
export function useCustomCurrencyRates(budgetId: number) {
  return useSpaceQuery<CustomCurrencyRate[]>({
    key: ['customCurrencyRates', budgetId],
    enabled: Boolean(budgetId),
    queryFn: (services) => services.currency.getCustomRatesForBudget(budgetId),
  });
}

/**
 * Add a new custom currency rate.
 */
export function useAddCustomCurrencyRate() {
  const runtime = useRuntime();
  return useMutation<{ id: number; recalculated: number }, Error, AddCustomCurrencyRateInput>({
    mutationFn: async (input) => {
      return executeSpaceMutation<{ id: number; recalculated: number }>(runtime, {
        op: 'currency.customRates.add',
        payload: {
          fromCurrency: input.fromCurrency,
          toCurrency: input.toCurrency,
          rate: input.rate,
          startDate: input.startDate,
          endDate: input.endDate,
          budgetId: input.budgetId,
        },
        meta: { label: 'useAddCustomCurrencyRate' },
      });
    },
  });
}

/**
 * Update an existing custom currency rate.
 */
export function useUpdateCustomCurrencyRate() {
  const runtime = useRuntime();
  return useMutation<{ recalculated: number }, Error, UpdateCustomCurrencyRateInput>({
    mutationFn: async (input) => {
      return executeSpaceMutation<{ recalculated: number }>(runtime, {
        op: 'currency.customRates.update',
        payload: {
          id: input.id,
          rate: input.rate,
          startDate: input.startDate,
          endDate: input.endDate,
          budgetId: input.budgetId,
        },
        meta: { label: 'useUpdateCustomCurrencyRate' },
      });
    },
  });
}

/**
 * Delete a custom currency rate.
 */
export function useDeleteCustomCurrencyRate() {
  const runtime = useRuntime();
  return useMutation<{ recalculated: number }, Error, DeleteCustomCurrencyRateInput>({
    mutationFn: async (input) => {
      return executeSpaceMutation<{ recalculated: number }>(runtime, {
        op: 'currency.customRates.delete',
        payload: { id: input.id, budgetId: input.budgetId },
        meta: { label: 'useDeleteCustomCurrencyRate' },
      });
    },
  });
}
