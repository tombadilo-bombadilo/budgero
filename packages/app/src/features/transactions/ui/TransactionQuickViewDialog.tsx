import type { ReactNode } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@shared/ui/dialog';
import { Button } from '@shared/ui/button';
import { MobileTransactionCard } from '@features/transactions/ui/mobile-transaction-card';
import { cn } from '@shared/lib/utils';
import type { GetTransactionsByAccountRow } from '@budgero/core/browser';

export interface TransactionQuickViewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Transaction to show; the dialog body renders only while non-null. */
  transaction: GetTransactionsByAccountRow | null;
  budgetId: number;

  globalLocalizer: Intl.NumberFormat;
  /** Defaults to `globalLocalizer`. */
  accountLocalizer?: Intl.NumberFormat;
  /** Defaults to `globalLocalizer`. */
  currentFormatter?: Intl.NumberFormat;
  transactionCurrencyDisplay?: 'budget' | 'account';

  getPrimaryInflow: (tx: GetTransactionsByAccountRow) => number;
  getPrimaryOutflow: (tx: GetTransactionsByAccountRow) => number;
  getSecondaryInflow: (tx: GetTransactionsByAccountRow) => number;
  getSecondaryOutflow: (tx: GetTransactionsByAccountRow) => number;

  onCellCommit: (
    transactionId: number,
    columnId: string,
    newVal: string | number | Date | null
  ) => void;
  isPending: boolean;
  pendingId?: number;

  hideSecondaryAmounts?: boolean;
  forceLoadSplits?: boolean;

  /** Let the dialog body scroll (`max-h-[90vh] overflow-y-auto`) instead of clipping. */
  scrollable?: boolean;
  /** Screen-reader-only dialog title; also suppresses the missing-description warning. */
  srTitle?: string;
  /** Body wrapper class override; defaults to `px-5 pt-10 pb-2 max-w-full overflow-hidden`. */
  bodyClassName?: string;

  /** When set, renders the standard destructive "Delete transaction" footer button. */
  onDeleteClick?: () => void;
  deleteDisabled?: boolean;
  /** Custom footer below the card; takes precedence over the delete button. */
  footer?: ReactNode;
}

const noopSelectionChange = () => {
  /* selection not used in quick view */
};

/**
 * Quick view/edit dialog wrapping MobileTransactionCard in its popped-out,
 * always-expanded configuration. Shared by the dashboard cards, the command
 * palette, and the mobile spending drawer.
 */
export function TransactionQuickViewDialog({
  open,
  onOpenChange,
  transaction,
  budgetId,
  globalLocalizer,
  accountLocalizer,
  currentFormatter,
  transactionCurrencyDisplay = 'budget',
  getPrimaryInflow,
  getPrimaryOutflow,
  getSecondaryInflow,
  getSecondaryOutflow,
  onCellCommit,
  isPending,
  pendingId,
  hideSecondaryAmounts = false,
  forceLoadSplits = false,
  scrollable = false,
  srTitle,
  bodyClassName,
  onDeleteClick,
  deleteDisabled = false,
  footer,
}: TransactionQuickViewDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          'sm:max-w-[480px] p-0',
          scrollable ? 'max-h-[90vh] overflow-y-auto' : 'overflow-hidden'
        )}
        {...(srTitle ? { 'aria-describedby': undefined } : {})}
      >
        {srTitle ? <DialogTitle className="sr-only">{srTitle}</DialogTitle> : null}
        {transaction && (
          <div className={bodyClassName ?? 'px-5 pt-10 pb-2 max-w-full overflow-hidden'}>
            <MobileTransactionCard
              transaction={transaction}
              isSelected={false}
              isPending={isPending}
              pendingId={pendingId}
              accountLocalizer={accountLocalizer ?? globalLocalizer}
              globalLocalizer={globalLocalizer}
              currentFormatter={currentFormatter ?? globalLocalizer}
              transactionCurrencyDisplay={transactionCurrencyDisplay}
              getPrimaryInflow={getPrimaryInflow}
              getPrimaryOutflow={getPrimaryOutflow}
              getSecondaryInflow={getSecondaryInflow}
              getSecondaryOutflow={getSecondaryOutflow}
              onSelectionChange={noopSelectionChange}
              onCellCommit={onCellCommit}
              hideAccountColumn={false}
              hideSecondaryAmounts={hideSecondaryAmounts}
              budgetId={budgetId}
              forceExpand
              readOnlyCategory={false}
              hideSelection
              hideRunningBalance
              forceLoadSplits={forceLoadSplits}
              isPoppedOut
            />
            {footer ??
              (onDeleteClick ? (
                <div className="pt-3 pb-4">
                  <div className="flex justify-center">
                    <Button variant="destructive" onClick={onDeleteClick} disabled={deleteDisabled}>
                      Delete transaction
                    </Button>
                  </div>
                </div>
              ) : null)}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
