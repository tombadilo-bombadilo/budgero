import { useMutation } from '@tanstack/react-query';
import { useActiveSpaceId, useRuntime } from '@shared/runtime/runtime-provider';
import { resolveSpaceKey } from '@shared/lib/query-utils';
import { requestSchedulingGuide } from '@shared/store/useSchedulingGuideStore';
import { executeSpaceMutation } from '@shared/runtime/mutation-router';
import { useSpaceQuery } from '@shared/api/useSpaceQuery';
import type {
  CreateRecurringTransactionInput,
  ListOccurrencesOptions,
  ListProjectedTransactionsOptions,
  MarkOccurrenceReadyOptions,
  MarkOccurrenceReadyResult,
  ProjectedTransactionRow,
  RecurringOccurrenceWithTemplate,
  RecurringTransaction,
  UpdateRecurringTransactionInput,
} from '@budgero/core/browser';

const RECURRING_TEMPLATES_KEY = 'recurringTemplates';
const RECURRING_OCCURRENCES_KEY = 'recurringOccurrences';

export function useRecurringTemplates(budgetId: number, includeInactive = false) {
  return useSpaceQuery<RecurringTransaction[]>({
    key: [RECURRING_TEMPLATES_KEY, budgetId, includeInactive ? 'all' : 'active'],
    enabled: budgetId > 0,
    staleTime: 30_000,
    queryFn: (services) => services.recurring.listRecurringTransactions(budgetId, includeInactive),
  });
}

export function useRecurringOccurrences(
  budgetId: number,
  options: ListOccurrencesOptions = { status: 'scheduled' }
) {
  const serialized = JSON.stringify(options ?? {});
  return useSpaceQuery<RecurringOccurrenceWithTemplate[]>({
    key: [RECURRING_OCCURRENCES_KEY, budgetId, serialized],
    enabled: budgetId > 0,
    staleTime: 15_000,
    queryFn: (services) => services.recurring.listOccurrences(budgetId, options ?? {}),
  });
}

/**
 * Scheduled (not yet ready) occurrences projected into a transaction-like
 * shape — used by the account register to show them inline as non-editable
 * rows that affect the projected running balance.
 */
export function useProjectedTransactions(
  budgetId: number,
  options: ListProjectedTransactionsOptions = {}
) {
  const serialized = JSON.stringify(options ?? {});
  return useSpaceQuery<ProjectedTransactionRow[]>({
    key: [RECURRING_OCCURRENCES_KEY, budgetId, 'projected', serialized],
    enabled: budgetId > 0,
    staleTime: 15_000,
    queryFn: (services) => services.recurring.listProjectedTransactions(budgetId, options ?? {}),
  });
}

export function useCreateRecurringTransaction() {
  const runtime = useRuntime();
  const spaceId = useActiveSpaceId();
  return useMutation<RecurringTransaction, Error, CreateRecurringTransactionInput>({
    mutationFn: async (input) => {
      return executeSpaceMutation<RecurringTransaction>(runtime, {
        op: 'recurring.create',
        payload: { input },
        meta: { label: 'useCreateRecurringTransaction' },
      });
    },
    onSuccess: (_template, input) =>
      requestSchedulingGuide(
        'recurring',
        resolveSpaceKey(spaceId),
        input.budgetId,
        input.accountId
      ),
  });
}

export function useUpdateRecurringTransaction() {
  const runtime = useRuntime();
  return useMutation<
    RecurringTransaction,
    Error,
    { id: number; budgetId: number; patch: UpdateRecurringTransactionInput }
  >({
    mutationFn: async ({ id, patch }) => {
      return executeSpaceMutation<RecurringTransaction>(runtime, {
        op: 'recurring.update',
        payload: { id, patch },
        meta: { label: 'useUpdateRecurringTransaction' },
      });
    },
  });
}

export function useDeleteRecurringTransaction() {
  const runtime = useRuntime();
  return useMutation<void, Error, { id: number; budgetId: number }>({
    mutationFn: async ({ id }) => {
      await executeSpaceMutation<void>(runtime, {
        op: 'recurring.delete',
        payload: { id },
        meta: { label: 'useDeleteRecurringTransaction' },
      });
    },
  });
}

/**
 * Occurrence IDs are local to each device, so synced occurrence ops also carry
 * the (template, due date) key that every device resolves to the same bill.
 */
function occurrenceKey(
  runtime: ReturnType<typeof useRuntime>,
  occurrenceId: number | undefined
): { recurringTransactionId?: number; dueDate?: string } {
  if (occurrenceId == null) return {};
  try {
    const occurrence = runtime.services().recurring.getOccurrenceWithTemplate(occurrenceId);
    return {
      recurringTransactionId: occurrence.recurringTransactionId,
      dueDate: occurrence.dueDate,
    };
  } catch {
    return {};
  }
}

export function useMarkRecurringOccurrenceReady() {
  const runtime = useRuntime();
  return useMutation<MarkOccurrenceReadyResult, Error, MarkOccurrenceReadyOptions>({
    mutationFn: async (options) => {
      return executeSpaceMutation<MarkOccurrenceReadyResult>(runtime, {
        op: 'recurring.markReady',
        payload: { options: { ...options, ...occurrenceKey(runtime, options.occurrenceId) } },
        meta: { label: 'useMarkRecurringOccurrenceReady' },
      });
    },
  });
}

export function useSkipRecurringOccurrence() {
  const runtime = useRuntime();
  return useMutation<RecurringOccurrenceWithTemplate, Error, { id: number }>({
    mutationFn: async ({ id }) => {
      return executeSpaceMutation<RecurringOccurrenceWithTemplate>(runtime, {
        op: 'recurring.skip',
        payload: { id, ...occurrenceKey(runtime, id) },
        meta: { label: 'useSkipRecurringOccurrence' },
      });
    },
  });
}

export function useMarkRecurringOccurrenceNotified() {
  const runtime = useRuntime();
  return useMutation<RecurringOccurrenceWithTemplate, Error, { id: number }>({
    mutationFn: async ({ id }) => {
      return executeSpaceMutation<RecurringOccurrenceWithTemplate>(runtime, {
        op: 'recurring.markNotified',
        payload: { id, ...occurrenceKey(runtime, id) },
        meta: { label: 'useMarkRecurringOccurrenceNotified' },
      });
    },
  });
}
