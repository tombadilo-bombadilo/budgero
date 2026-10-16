import { t as translate } from '@lingui/core/macro';
import { useLingui } from '@lingui/react/macro';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getRuntime } from '@shared/runtime/global';
import {
  applyReplayOps,
  markHistory,
  undoItemMutationIds,
  useUndoStore,
  type UndoItem,
} from '@shared/mutations/UndoStore';
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

export type AuditUndoBlockReason =
  'no-undo' | 'undone' | 'failed' | 'remote' | 'newer-changes' | 'grouped';

export type AuditUndoAvailability =
  { canUndo: true; viaUndoStack: boolean } | { canUndo: false; reason: AuditUndoBlockReason };

/**
 * Whether the Audit Log may undo `entry`. An inverse op restores the state
 * right after the change, so it is only safe while nothing changed since:
 * the entry must be the newest change of the space still applied
 * (`latestActiveMutationId`). When the entry is the newest Ctrl+Z entry, the
 * undo goes through the UndoStore, so both stay in step.
 */
export function getAuditUndoAvailability(
  entry: Pick<ParsedMutationHistoryEntry, 'mutationId' | 'undoOps' | 'undoneAt' | 'origin'> & {
    status?: string;
  },
  latestActiveMutationId: string | null | undefined,
  undoTop: UndoItem | undefined
): AuditUndoAvailability {
  if (entry.undoneAt) return { canUndo: false, reason: 'undone' };
  if (entry.status === 'failed') return { canUndo: false, reason: 'failed' };
  if (!entry.undoOps || entry.undoOps.length === 0) return { canUndo: false, reason: 'no-undo' };
  if (entry.origin !== 'local') return { canUndo: false, reason: 'remote' };
  if (latestActiveMutationId !== entry.mutationId) {
    return { canUndo: false, reason: 'newer-changes' };
  }
  if (undoTop && undoItemMutationIds(undoTop).includes(entry.mutationId)) {
    // Part of a grouped action: undoing it alone would split the group.
    if (undoItemMutationIds(undoTop).length > 1) return { canUndo: false, reason: 'grouped' };
    return { canUndo: true, viaUndoStack: true };
  }
  return { canUndo: true, viaUndoStack: false };
}

/** The newest still-applied change of a space (see getAuditUndoAvailability). */
export function useLatestActiveMutation(spaceId: string | null) {
  return useQuery({
    queryKey: ['mutationHistory', spaceId, 'latestActive'],
    queryFn: () => {
      const services = getRuntime()?.services?.();
      if (!services?.mutationHistory || !spaceId) return null;
      return services.mutationHistory.getLatestActiveEntryForSpace(spaceId)?.mutationId ?? null;
    },
    enabled: !!spaceId,
    staleTime: 1000 * 30,
  });
}

export class AuditUndoBlockedError extends Error {
  constructor(readonly reason: AuditUndoBlockReason) {
    super(`Audit Log undo not available: ${reason}`);
    this.name = 'AuditUndoBlockedError';
  }
}

/**
 * Undo a history entry from the Audit Log. Re-checks safety at the moment of
 * the undo, applies the inverse atomically and marks the entry undone in the
 * history and the Ctrl+Z stack alike (an entry on top of the stack is undone
 * through the stack, so it can be redone and is not undone twice).
 */
export async function undoMutationHistoryEntry(
  entry: ParsedMutationHistoryEntry,
  label?: string
): Promise<string> {
  const runtime = getRuntime();
  const history = runtime?.services?.()?.mutationHistory;
  if (!history) {
    throw new Error('Services not available');
  }
  const spaceId = runtime?.getActiveSpaceId?.() ?? null;
  const latest = spaceId
    ? (history.getLatestActiveEntryForSpace(spaceId)?.mutationId ?? null)
    : null;
  const store = useUndoStore.getState();
  const top = store.past[store.past.length - 1];
  const availability = getAuditUndoAvailability(entry, latest, top);
  if (!availability.canUndo) throw new AuditUndoBlockedError(availability.reason);

  if (availability.viaUndoStack && top) {
    await store.undoItem(top.id);
    return entry.mutationId;
  }

  await applyReplayOps(entry.undoOps!, 'undo', label);
  markHistory([entry.mutationId], 'undo');
  useUndoStore.getState().remove(entry.mutationId);
  return entry.mutationId;
}

/** Hook to undo a mutation from history (see undoMutationHistoryEntry). */
export function useUndoMutationHistoryEntry() {
  const { t } = useLingui();

  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ entry }: { entry: ParsedMutationHistoryEntry }) => {
      try {
        return await undoMutationHistoryEntry(entry, t`Undo: ${entry.op}`);
      } catch (error) {
        if (error instanceof AuditUndoBlockedError) {
          throw new Error(auditUndoBlockMessage(error.reason));
        }
        throw error;
      }
    },
    onSettled: () => {
      // Data queries are invalidated by the MutationExecutor (via `invalidates`
      // + `forceInvalidate`). Here we only refresh the audit log's own views.
      void queryClient.invalidateQueries({ queryKey: ['mutationHistory'] });
      void queryClient.invalidateQueries({ queryKey: ['mutationHistoryCount'] });
    },
  });
}

export function auditUndoBlockMessage(reason: AuditUndoBlockReason): string {
  switch (reason) {
    case 'undone':
      return translate`This action has already been undone.`;
    case 'failed':
      return translate`This action failed, so there is nothing to undo.`;
    case 'no-undo':
      return translate`This action cannot be undone.`;
    case 'remote':
      return translate`Changes from other devices can only be undone on the device that made them.`;
    case 'newer-changes':
      return translate`Only the most recent change can be undone. Undo the newer changes first.`;
    case 'grouped':
      return translate`This change is part of a larger action. Use Undo (Ctrl+Z) to revert it.`;
  }
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
    'transactions.import': 'Import Transaction',
    'transactions.addTransfer': 'Add Transfer',
    'transactions.updateColumn': 'Update Transaction',
    'transactions.delete': 'Delete Transaction',
    'transactions.moveToNewCategory': 'Move Transaction Category',
    'transactions.moveToNewAccount': 'Move Transaction Account',
    'transactions.reassign': 'Reassign Transactions',
    'transactions.reconcile': 'Reconcile Account',
    'transactions.reconcileCleared': 'Reconcile Account',
    'transactions.unreconcile': 'Undo Reconcile',
    'transactions.upsertSplits': 'Update Splits',
    'transactions.clearSplits': 'Clear Splits',
    'categories.create': 'Create Category',
    'categories.updateName': 'Rename Category',
    'categories.updateNote': 'Edit Category Note',
    'categories.updateDetails': 'Edit Category',
    'categories.updateFundingPriorities': 'Change Funding Priorities',
    'budgets.updateGoalFundingSettings': 'Change Goal Funding Settings',
    'categories.delete': 'Delete Category',
    'categories.deleteAndReassign': 'Delete Category',
    'categories.restoreDeleted': 'Restore Category',
    'categoryGroups.deleteAndReassign': 'Delete Category Group',
    'categories.moveToNewGroup': 'Move Category',
    'categories.updateExcludeFromBudgetPace': 'Update Category Pacing',
    'categoryGroups.create': 'Create Category Group',
    'categoryGroups.update': 'Update Category Group',
    'categoryGroups.delete': 'Delete Category Group',
    'accounts.create': 'Create Account',
    'accounts.update': 'Update Account',
    'accounts.delete': 'Delete Account',
    'accounts.createLinked': 'Create Linked Account',
    'accounts.restoreDeleted': 'Restore Account',
    'accounts.setArchived': 'Archive Account',
    'payees.add': 'Add Payee',
    'payees.rename': 'Rename Payee',
    'payees.delete': 'Delete Payee',
    'payees.deleteMany': 'Delete Payees',
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
    'bankSync.saveConnection': 'Connect Bank Sync',
    'bankSync.deleteConnection': 'Disconnect Bank Sync',
    'bankSync.saveEnableBankingConnection': 'Connect Enable Banking',
    'bankSync.saveEnableBankingSession': 'Authorize Bank',
    'bankSync.removeEnableBankingSession': 'Remove Bank',
    'bankSync.saveLink': 'Link Bank Account',
    'bankSync.deleteLink': 'Unlink Bank Account',
    'bankSync.updateLinkSettings': 'Change Bank Feed Settings',
    'bankSync.recordSync': 'Bank Sync',
    'bankSync.addReviews': 'Queue Bank Matches',
    'bankSync.setReviewStatus': 'Review Bank Match',
    'push.import': 'Push API Import',
    'history.applyOps': 'Undo / Redo',
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
