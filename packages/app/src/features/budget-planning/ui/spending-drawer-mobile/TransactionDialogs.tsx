import { memo, useMemo } from 'react';
import { Button } from '@shared/ui/button';
import { DeleteTransactionDialog } from '@features/transactions/ui/DeleteTransactionDialog';
import { TransactionQuickViewDialog } from '@features/transactions/ui/TransactionQuickViewDialog';
import { RecategorizeDialog } from '@features/transactions/ui/RecategorizeDialog';
import { makeAmountAccessors } from '@features/transactions/lib/amount-accessors';
import { mapToTransactionRow } from './spending-drawer.utils';
import type { TransactionDialogsProps } from './types';

// The drawer always displays amounts in budget currency.
const { getPrimaryInflow, getPrimaryOutflow, getSecondaryInflow, getSecondaryOutflow } =
  makeAmountAccessors('budget');

export const TransactionDialogs = memo(function TransactionDialogs({
  // Quick View Dialog
  quickViewOpen,
  quickViewTx,
  onQuickViewClose,
  onQuickCommit,
  isPending,
  pendingId,
  globalLocalizer,
  budgetId,
  // Confirm Delete Dialog
  confirmDeleteOpen,
  onConfirmDeleteClose,
  onOpenDeleteConfirm,
  onDeleteConfirm,
  isDeleting,
  // Recategorize Dialog
  recatOpen,
  recatTx,
  onRecatClose,
  onRecategorize,
}: TransactionDialogsProps) {
  const mappedTransaction = useMemo(
    () => (quickViewTx ? mapToTransactionRow(quickViewTx) : null),
    [quickViewTx]
  );

  return (
    <>
      {/* Quick View Dialog for a transaction */}
      <TransactionQuickViewDialog
        open={quickViewOpen}
        onOpenChange={(open) => {
          if (!open) onQuickViewClose();
        }}
        transaction={mappedTransaction}
        budgetId={budgetId}
        globalLocalizer={globalLocalizer}
        scrollable
        bodyClassName="px-5 pb-5 pt-10 max-w-full overflow-hidden"
        hideSecondaryAmounts
        forceLoadSplits
        getPrimaryInflow={getPrimaryInflow}
        getPrimaryOutflow={getPrimaryOutflow}
        getSecondaryInflow={getSecondaryInflow}
        getSecondaryOutflow={getSecondaryOutflow}
        onCellCommit={onQuickCommit}
        isPending={isPending}
        pendingId={pendingId}
        footer={
          <div className="flex justify-center pt-4">
            <Button variant="destructive" onClick={onOpenDeleteConfirm} disabled={isDeleting}>
              Delete transaction
            </Button>
          </div>
        }
      />

      {/* Confirm Delete */}
      <DeleteTransactionDialog
        open={confirmDeleteOpen}
        onOpenChange={(open) => {
          if (!open) onConfirmDeleteClose();
        }}
        onConfirm={onDeleteConfirm}
        isPending={isDeleting}
      />

      {/* Reassign Category */}
      <RecategorizeDialog
        open={recatOpen}
        onOpenChange={(open) => {
          if (!open) onRecatClose();
        }}
        budgetId={budgetId}
        hasTransaction={!!recatTx}
        onCategorySelect={onRecategorize}
      />
    </>
  );
});
