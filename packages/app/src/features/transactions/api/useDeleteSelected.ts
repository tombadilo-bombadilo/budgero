import { plural } from '@lingui/core/macro';
import { useLingui } from '@lingui/react/macro';
import { useCallback } from 'react';
import { toast } from 'sonner';
import { useDeleteTransactions } from '@entities/transaction/api/useTransactions';
import { latestUndoId, useUndoStore } from '@shared/mutations/UndoStore';
import { toastError } from '@shared/lib/errors';

/** Deletes transactions with a toast that offers Undo. Shared by the batch toolbar and Delete key. */
export function useDeleteSelected() {
  const { t } = useLingui();
  const deleteTransactions = useDeleteTransactions();
  const undoItem = useUndoStore((state) => state.undoItem);

  const deleteRows = useCallback(
    async (ids: number[], onDeleted?: () => void) => {
      if (!ids.length || deleteTransactions.isPending) return;
      try {
        const before = latestUndoId();
        await deleteTransactions.mutateAsync({ transactionIds: ids });
        // The toast undoes THIS delete, not whatever is newest when clicked.
        const after = latestUndoId();
        const undoId = after !== before ? after : undefined;
        const count = ids.length;
        toast.success(
          plural(count, { one: '# transaction deleted', other: '# transactions deleted' }),
          {
            action: undoId
              ? {
                  label: t`Undo`,
                  onClick: () => {
                    undoItem(undoId).catch((error: unknown) =>
                      toastError(t`Failed to undo the delete`, error)
                    );
                  },
                }
              : undefined,
          }
        );
        onDeleted?.();
      } catch (error) {
        console.error('Error deleting transactions:', error);
        toastError(t`Failed to delete transactions`, error, t`Please try again.`);
      }
    },
    [deleteTransactions, undoItem, t]
  );

  return { deleteRows, isDeleting: deleteTransactions.isPending };
}
