import { useMutation } from '@tanstack/react-query';
import { useRuntime } from '@shared/runtime/runtime-provider';
import { executeSpaceMutation } from '@shared/runtime/mutation-router';
import { useSpaceQuery } from '@shared/api/useSpaceQuery';
import type { Warranty, CreateWarrantyInput, UpdateWarrantyInput } from '@budgero/core/browser';

const WARRANTIES_QUERY_KEY = 'warranties';

export function useWarranties(budgetId: number) {
  return useSpaceQuery<Warranty[]>({
    key: [WARRANTIES_QUERY_KEY, budgetId],
    enabled: budgetId > 0,
    queryFn: (services) => services.warranties.listByBudget(budgetId),
  });
}

export function useCreateWarranty() {
  const runtime = useRuntime();
  return useMutation<number, Error, CreateWarrantyInput>({
    mutationFn: async (input) => {
      // Strip receiptImage from the sync payload — binary blobs can't be
      // serialized for the sync transport.  The image is written directly
      // via the service and syncs through the encrypted DB snapshot.
      const { receiptImage, ...syncPayload } = input;
      const result = await executeSpaceMutation<number>(runtime, {
        op: 'warranties.create',
        payload: syncPayload,
        meta: { label: 'useCreateWarranty' },
      });
      if (receiptImage) {
        runtime.services().warranties.update({ id: result, receiptImage });
        await runtime.finalizeOutOfBandMutation({ uploadSnapshot: true });
      }
      return result;
    },
  });
}

export function useUpdateWarranty() {
  const runtime = useRuntime();
  return useMutation<void, Error, UpdateWarrantyInput & { budgetId: number }>({
    mutationFn: async ({ budgetId: _budgetId, ...input }) => {
      // Strip receiptImage from the sync payload (see useCreateWarranty).
      const { receiptImage, ...syncPayload } = input;
      await executeSpaceMutation<void>(runtime, {
        op: 'warranties.update',
        payload: syncPayload,
        meta: { label: 'useUpdateWarranty' },
      });
      if (receiptImage !== undefined) {
        runtime.services().warranties.update({ id: input.id, receiptImage });
        await runtime.finalizeOutOfBandMutation({ uploadSnapshot: true });
      }
    },
  });
}

export function useDeleteWarranty() {
  const runtime = useRuntime();
  return useMutation<void, Error, { id: number; budgetId: number }>({
    mutationFn: async ({ id }) => {
      await executeSpaceMutation<void>(runtime, {
        op: 'warranties.delete',
        payload: { id },
        meta: { label: 'useDeleteWarranty' },
      });
    },
  });
}
