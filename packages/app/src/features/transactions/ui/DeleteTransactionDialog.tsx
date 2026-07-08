import { ConfirmDialog } from '@shared/ui/confirm-dialog';

/**
 * Confirmation dialog for permanently deleting a single transaction.
 * Shared by the mobile transaction list, the dashboard transaction cards,
 * and the mobile spending drawer.
 */
export function DeleteTransactionDialog({
  open,
  onOpenChange,
  onConfirm,
  isPending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void | Promise<void>;
  isPending: boolean;
}) {
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Delete this transaction?"
      confirmText="Delete"
      loadingText="Deleting..."
      variant="destructive"
      onConfirm={onConfirm}
      isLoading={isPending}
    />
  );
}
