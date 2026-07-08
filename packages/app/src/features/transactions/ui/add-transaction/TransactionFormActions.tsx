'use client';

/**
 * Transaction Form Actions
 *
 * Form action buttons: Cancel, Quick Add, and Submit.
 */

import * as React from 'react';
import { Loader2 } from 'lucide-react';

import { DialogFooter } from '@shared/ui/dialog';
import { Button } from '@shared/ui/button';

interface TransactionFormActionsProps {
  onCancel: () => void;
  onQuickAdd: () => void;
  isCalculatingTransfer: boolean;
  isTransfer: boolean;
  isInflow: boolean;
  isOutflow: boolean;
}

export const TransactionFormActions = React.memo(function TransactionFormActions({
  onCancel,
  onQuickAdd,
  isCalculatingTransfer,
  isTransfer,
  isInflow,
  isOutflow,
}: TransactionFormActionsProps) {
  const submitButtonClassName = React.useMemo(() => {
    const base = 'h-8 sm:h-9 px-3 sm:px-4 flex-1 sm:flex-initial transition-colors';
    if (isInflow) {
      return `${base} bg-success hover:bg-success/90 text-white`;
    }
    if (isOutflow) {
      return `${base} bg-destructive hover:bg-destructive/90 text-white`;
    }
    return base;
  }, [isInflow, isOutflow]);

  const submitButtonLabel = React.useMemo(() => {
    if (isCalculatingTransfer) {
      return (
        <>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Processing...
        </>
      );
    }
    if (isTransfer) {
      return 'Add Transfer';
    }
    return `Add ${isInflow ? 'Income' : 'Expense'}`;
  }, [isCalculatingTransfer, isTransfer, isInflow]);

  return (
    <DialogFooter className="mt-4 sm:mt-6 flex flex-col sm:flex-row justify-between gap-2 sm:gap-3">
      <div className="flex gap-2 order-2 sm:order-1 items-center">
        <Button
          variant="outline"
          type="button"
          onClick={onCancel}
          className="h-8 sm:h-9 px-3 sm:px-4 flex-1 sm:flex-initial"
        >
          Cancel
        </Button>
        <span className="hidden sm:inline-block text-[10px] text-muted-foreground ml-2">
          Press Cmd+Enter to save
        </span>
      </div>
      <div className="flex gap-2 order-1 sm:order-2">
        <Button
          onClick={onQuickAdd}
          disabled={isCalculatingTransfer}
          variant="outline"
          type="button"
          className="h-8 sm:h-9 px-3 sm:px-4 flex-1 sm:flex-initial"
        >
          Quick Add
        </Button>
        <Button
          disabled={isCalculatingTransfer}
          type="submit"
          className={submitButtonClassName}
          data-testid="add-transaction-submit"
        >
          {submitButtonLabel}
        </Button>
      </div>
    </DialogFooter>
  );
});
