import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getRuntime } from '@shared/runtime/global';
import { getInvalidatesForOp } from '@shared/mutations/op-code-registry';
import type { ParsedMutationHistoryEntry, MutationHistoryListOptions } from '@budgero/core/browser';

/**
 * Hook to fetch mutation history for a workspace/space
 */
export function useMutationHistory(
  spaceId: string | null,
  options: MutationHistoryListOptions = {}
) {
  return useQuery({
    queryKey: ['mutationHistory', spaceId, options],
    queryFn: () => {
      const runtime = getRuntime();
      const services = runtime?.services?.();
      if (!services?.mutationHistory || !spaceId) {
        return [];
      }
      return services.mutationHistory.getHistoryForSpace(spaceId, options);
    },
    enabled: !!spaceId,
    staleTime: 1000 * 30,
  });
}

/**
 * Hook to get mutation history count for a workspace/space
 */
export function useMutationHistoryCount(spaceId: string | null) {
  return useQuery({
    queryKey: ['mutationHistoryCount', spaceId],
    queryFn: () => {
      const runtime = getRuntime();
      const services = runtime?.services?.();
      if (!services?.mutationHistory || !spaceId) {
        return 0;
      }
      return services.mutationHistory.countForSpace(spaceId);
    },
    enabled: !!spaceId,
    staleTime: 1000 * 30,
  });
}

/**
 * Hook to undo a mutation from history
 */
export function useUndoMutationHistoryEntry() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ entry }: { entry: ParsedMutationHistoryEntry }) => {
      const runtime = getRuntime();
      const services = runtime?.services?.();
      const router = runtime?.mutationsRouter?.();

      if (!services?.mutationHistory || !router) {
        throw new Error('Services not available');
      }

      if (!entry.undoOps || entry.undoOps.length === 0) {
        throw new Error('No undo operations available for this entry');
      }

      if (entry.undoneAt) {
        throw new Error('This entry has already been undone');
      }

      // Execute each undo operation. Pass `invalidates` + `forceInvalidate` so
      // the MutationExecutor runs the full query invalidation for the op (local
      // mutations are otherwise skipped) — same as the global undo path.
      for (const op of entry.undoOps) {
        await router.execute({
          op: op.op,
          payload: op.args,
          invalidates: getInvalidatesForOp(op.op),
          meta: { skipUndo: true, label: `Undo: ${entry.op}`, forceInvalidate: true },
        });
      }

      services.mutationHistory.markUndone(entry.mutationId);

      return entry.mutationId;
    },
    onSuccess: () => {
      // Data queries are invalidated by the MutationExecutor (via `invalidates`
      // + `forceInvalidate` above). Here we only refresh the audit log's own views.
      void queryClient.invalidateQueries({ queryKey: ['mutationHistory'] });
      void queryClient.invalidateQueries({ queryKey: ['mutationHistoryCount'] });
    },
  });
}

/**
 * Hook to clear all mutation history for a workspace/space
 */
export function useClearMutationHistory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ spaceId }: { spaceId: string }) => {
      const runtime = getRuntime();
      const services = runtime?.services?.();

      if (!services?.mutationHistory) {
        throw new Error('Services not available');
      }

      services.mutationHistory.clearBySpace(spaceId);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['mutationHistory'] });
      void queryClient.invalidateQueries({ queryKey: ['mutationHistoryCount'] });
    },
  });
}

/**
 * Format an operation code into a human-readable label
 */
export function formatOpCode(op: string): string {
  const opLabels: Record<string, string> = {
    'transactions.add': 'Add Transaction',
    'transactions.updateColumn': 'Update Transaction',
    'transactions.delete': 'Delete Transaction',
    'transactions.moveToNewCategory': 'Move Transaction Category',
    'transactions.moveToNewAccount': 'Move Transaction Account',
    'transactions.reassign': 'Reassign Transactions',
    'transactions.reconcile': 'Reconcile Account',
    'transactions.upsertSplits': 'Update Splits',
    'transactions.clearSplits': 'Clear Splits',
    'categories.create': 'Create Category',
    'categories.updateName': 'Rename Category',
    'categories.delete': 'Delete Category',
    'categories.moveToNewGroup': 'Move Category',
    'categories.updateExcludeFromBudgetPace': 'Update Category Pacing',
    'categoryGroups.create': 'Create Category Group',
    'categoryGroups.update': 'Update Category Group',
    'categoryGroups.delete': 'Delete Category Group',
    'accounts.create': 'Create Account',
    'accounts.update': 'Update Account',
    'accounts.delete': 'Delete Account',
    'accounts.setArchived': 'Archive Account',
    'payees.add': 'Add Payee',
    'payees.rename': 'Rename Payee',
    'payees.delete': 'Delete Payee',
    'labels.add': 'Add Label',
    'labels.update': 'Update Label',
    'labels.delete': 'Delete Label',
    'monthlyBudgets.upsertAssignment': 'Update Budget Assignment',
    'monthlyBudgets.batchUpsertAssignments': 'Batch Update Assignments',
    'goals.create': 'Create Goal',
    'goals.update': 'Update Goal',
    'goals.delete': 'Delete Goal',
    'rules.create': 'Create Rule',
    'rules.update': 'Update Rule',
    'rules.delete': 'Delete Rule',
    'rules.execute': 'Execute Rule',
    'rules.logAutofillApplication': 'Log Autofill Application',
    'recurring.create': 'Create Recurring Transaction',
    'recurring.update': 'Update Recurring Transaction',
    'recurring.delete': 'Delete Recurring Transaction',
    'recurring.markReady': 'Post Recurring Transaction',
    'budgets.create': 'Create Budget',
    'budgets.updateName': 'Rename Budget',
    'budgets.delete': 'Delete Budget',
    'chat.createConversation': 'Create Chat Conversation',
    'chat.updateConversationTitle': 'Rename Chat Conversation',
    'chat.archiveConversation': 'Archive Chat Conversation',
    'chat.deleteConversation': 'Delete Chat Conversation',
    'chat.addMessage': 'Add Chat Message',
    'chat.deleteMessage': 'Delete Chat Message',
    'chat.updateSettings': 'Update Chat Settings',
    'llmSettings.update': 'Update AI Settings',
    'llmSettings.delete': 'Delete AI Settings',
    'push.import': 'Push API Import',
  };

  return (
    opLabels[op] ||
    op
      .replace(/\./g, ' → ')
      .replace(/([A-Z])/g, ' $1')
      .trim()
  );
}

/**
 * Get a color class for an operation type
 */
export function getOpColorClass(op: string): string {
  if (op.includes('delete') || op.includes('Delete')) {
    return 'text-red-600 dark:text-red-400';
  }
  if (op.includes('create') || op.includes('add') || op.includes('Create') || op.includes('Add')) {
    return 'text-green-600 dark:text-green-400';
  }
  if (
    op.includes('update') ||
    op.includes('Update') ||
    op.includes('rename') ||
    op.includes('move')
  ) {
    return 'text-blue-600 dark:text-blue-400';
  }
  return 'text-gray-600 dark:text-gray-400';
}
