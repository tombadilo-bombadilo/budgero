import React, { useMemo, useState } from 'react';
import { isFutureDate, groupTransactionsByDateKey, formatShortDate } from '@shared/lib/date-utils';
import { toast } from 'sonner';
import { MobileTransactionCard } from '@features/transactions/ui/mobile-transaction-card';
import { Button } from '@shared/ui/button';
import { Loader2 } from 'lucide-react';
import { GetTransactionsByAccountRow } from '@budgero/core/browser';
import { SwipeRow } from '@shared/ui/SwipeRow';
import { DeleteTransactionDialog } from '@features/transactions/ui/DeleteTransactionDialog';
import { RecategorizeDialog } from '@features/transactions/ui/RecategorizeDialog';
import { useUiStore } from '@shared/store/useUiStore';
import { useAccounts } from '@entities/account/api/useAccounts';
import { useDeleteTransaction } from '@entities/transaction/api/useTransactions';
import { useTransactionCellCommit } from '@features/transactions/api/useTransactionCellCommit';
import { cn } from '@shared/lib/utils';
import { toastError } from '@shared/lib/errors';

interface MobileTransactionListProps {
  transactions: GetTransactionsByAccountRow[];
  rowSelection: Record<string, boolean>;
  page: number;
  pageSize: number;
  isPending: boolean;
  pendingId?: number;
  accountLocalizer: Intl.NumberFormat;
  globalLocalizer: Intl.NumberFormat;
  currentFormatter: Intl.NumberFormat;
  transactionCurrencyDisplay: 'budget' | 'account';
  getPrimaryInflow: (transaction: GetTransactionsByAccountRow) => number;
  getPrimaryOutflow: (transaction: GetTransactionsByAccountRow) => number;
  getSecondaryInflow: (transaction: GetTransactionsByAccountRow) => number;
  getSecondaryOutflow: (transaction: GetTransactionsByAccountRow) => number;
  onCellCommit: (
    transactionId: number,
    columnId: string,
    newVal: string | number | Date | null
  ) => void;
  onSelectionChange: (rowId: string, checked: boolean) => void;
  hideAccountColumn?: boolean;
  hideSecondaryAmounts?: boolean;
  budgetId: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  onNextPage: () => void;
  onPreviousPage: () => void;
  currentPage: number;
  totalPages: number;
  isLoadingMore?: boolean;
  footerSize?: 'default' | 'compact';
  stickyFooter?: boolean;
}

export const MobileTransactionList = React.memo(function MobileTransactionList({
  transactions,
  rowSelection,
  page,
  pageSize,
  isPending,
  pendingId,
  accountLocalizer,
  globalLocalizer,
  currentFormatter,
  transactionCurrencyDisplay,
  getPrimaryInflow,
  getPrimaryOutflow,
  getSecondaryInflow,
  getSecondaryOutflow,
  onCellCommit,
  onSelectionChange,
  hideAccountColumn = false,
  hideSecondaryAmounts = false,
  budgetId,
  hasNextPage,
  hasPreviousPage,
  onNextPage,
  onPreviousPage,
  currentPage,
  totalPages,
  isLoadingMore = false,
  footerSize = 'default',
  stickyFooter = true,
}: MobileTransactionListProps) {
  const selectedBudget = useUiStore((s) => s.selectedBudget);
  const { data: accounts } = useAccounts(selectedBudget?.ID || 0);
  const cellCommit = useTransactionCellCommit();
  const deleteTransaction = useDeleteTransaction();
  const effectiveBudgetId = budgetId || selectedBudget?.ID || 0;
  const isCompactFooter = footerSize === 'compact';
  const containerClasses = cn('space-y-0', stickyFooter && isCompactFooter && 'pb-6');
  const mobileBottomNavHeight = 'var(--mobile-bottom-nav-height, 96px)';

  const resolveAccountIdForTransaction = (tx: GetTransactionsByAccountRow) => {
    const name = tx.Account;
    const acc = accounts?.find((a) => a.Name === name);
    return acc?.ID || 0;
  };

  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [activeTransaction, setActiveTransaction] = useState<GetTransactionsByAccountRow | null>(
    null
  );
  const [recatOpen, setRecatOpen] = useState(false);
  const selectedTransactionId = React.useMemo(() => {
    const raw = localStorage.getItem('expandTransactionId');
    const id = raw ? parseInt(raw) : NaN;
    return Number.isNaN(id) ? null : id;
  }, []);

  // Slice data for current page (like SpendingDrawer pattern)
  const paginatedTransactions = useMemo(() => {
    const startIndex = page * pageSize;
    const endIndex = startIndex + pageSize;
    return transactions.slice(startIndex, endIndex);
  }, [transactions, page, pageSize]);

  // Group transactions by date, timezone-agnostic, newest first
  const groupedTransactions = useMemo(() => {
    return groupTransactionsByDateKey(paginatedTransactions, (transaction) => transaction.Date);
  }, [paginatedTransactions]);

  if (paginatedTransactions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-4">
        <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
          <svg
            className="w-8 h-8 text-muted-foreground"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
        </div>
        <div className="text-center">
          <p className="text-lg font-medium text-muted-foreground mb-2">No transactions found</p>
          <p className="text-sm text-muted-foreground/70">
            Try adjusting your search filters or add a new transaction
          </p>
        </div>
        {/* Bottom spacer so empty state doesn't hide behind mobile bottom nav */}
        {totalPages <= 1 && <div className="sm:hidden" style={{ height: mobileBottomNavHeight }} />}
      </div>
    );
  }

  return (
    <div className={containerClasses}>
      {/* Grouped Transaction Cards */}
      <div className="space-y-3 min-h-[400px]">
        {groupedTransactions.map(({ key, date, transactions }) => {
          const displayDate = date
            ? formatShortDate(date, { hideCurrentYear: true, weekday: 'long' })
            : 'Unknown date';

          return (
            <div key={key} className="space-y-0">
              {/* Date Header */}
              <div className="bg-background/95 backdrop-blur-sm -mx-3 px-3 py-1.5 mb-1.5">
                <h3 className="text-xs font-medium text-foreground/80 tracking-wide">
                  {displayDate}
                </h3>
              </div>

              {/* Transactions for this date */}
              <div className="space-y-0">
                {transactions.map((transaction) => {
                  const isSelected = rowSelection[transaction.ID.toString()] || false;
                  const forceExpand = selectedTransactionId === transaction.ID;
                  const isFutureTransaction = isFutureDate(transaction.Date);

                  return (
                    <SwipeRow
                      key={transaction.ID}
                      captureClicks
                      animatedSnapBack
                      onRightAction={() => {
                        setActiveTransaction(transaction);
                        setConfirmDeleteOpen(true);
                      }}
                      onLeftAction={() => {
                        setActiveTransaction(transaction);
                        setRecatOpen(true);
                      }}
                    >
                      <MobileTransactionCard
                        transaction={transaction}
                        isSelected={isSelected}
                        isPending={isPending}
                        pendingId={pendingId}
                        accountLocalizer={accountLocalizer}
                        globalLocalizer={globalLocalizer}
                        currentFormatter={currentFormatter}
                        transactionCurrencyDisplay={transactionCurrencyDisplay}
                        getPrimaryInflow={getPrimaryInflow}
                        getPrimaryOutflow={getPrimaryOutflow}
                        getSecondaryInflow={getSecondaryInflow}
                        getSecondaryOutflow={getSecondaryOutflow}
                        onSelectionChange={(checked) =>
                          onSelectionChange(transaction.ID.toString(), checked)
                        }
                        onCellCommit={onCellCommit}
                        hideAccountColumn={hideAccountColumn}
                        hideSecondaryAmounts={hideSecondaryAmounts}
                        budgetId={effectiveBudgetId}
                        forceExpand={forceExpand}
                        isFutureTransaction={Boolean(isFutureTransaction)}
                      />
                    </SwipeRow>
                  );
                })}
              </div>
            </div>
          );
        })}

        {/* Loading indicator when fetching more */}
        {isLoadingMore && (
          <div className="flex justify-center py-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading more transactions...
            </div>
          </div>
        )}
      </div>

      {/* Bottom spacer when no pagination (prevents overlap with mobile nav) */}
      {totalPages <= 1 && <div className="sm:hidden" style={{ height: mobileBottomNavHeight }} />}

      {/* Pagination Controls (hidden if single page) */}
      {totalPages > 1 && (
        <div
          className={cn(
            'flex items-center justify-between border-t border-border/50 bg-background/95 backdrop-blur',
            isCompactFooter ? 'pt-3 pb-6' : 'pt-4',
            stickyFooter && 'sticky'
          )}
          style={
            isCompactFooter
              ? stickyFooter
                ? { bottom: '0.5rem' }
                : undefined
              : {
                  bottom: stickyFooter ? mobileBottomNavHeight : undefined,
                  paddingBottom: stickyFooter ? '1rem' : mobileBottomNavHeight,
                }
          }
        >
          <Button
            variant="outline"
            size="sm"
            onClick={onPreviousPage}
            disabled={!hasPreviousPage}
            className="flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 19l-7-7 7-7"
              />
            </svg>
            Previous
          </Button>

          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">
              Page {currentPage + 1} of {totalPages}
            </span>
            <div className="flex gap-1">
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                let pageNum;
                if (totalPages <= 5) {
                  pageNum = i;
                } else if (currentPage < 3) {
                  pageNum = i;
                } else if (currentPage > totalPages - 4) {
                  pageNum = totalPages - 5 + i;
                } else {
                  pageNum = currentPage - 2 + i;
                }

                return (
                  <div
                    key={pageNum}
                    className={`w-2 h-2 rounded-full transition-colors ${
                      pageNum === currentPage ? 'bg-primary' : 'bg-muted'
                    }`}
                  />
                );
              })}
            </div>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={onNextPage}
            disabled={!hasNextPage}
            className="flex items-center gap-2"
          >
            Next
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </Button>
        </div>
      )}
      <DeleteTransactionDialog
        open={confirmDeleteOpen}
        onOpenChange={setConfirmDeleteOpen}
        isPending={deleteTransaction.isPending}
        onConfirm={async () => {
          if (!activeTransaction) return;
          const accountId = resolveAccountIdForTransaction(activeTransaction);
          try {
            await deleteTransaction.mutateAsync({
              transactionId: Number(activeTransaction.ID),
              accountId,
            });
            toast.success('Transaction deleted', {
              description: 'The transaction has been permanently removed.',
            });
            setConfirmDeleteOpen(false);
            setActiveTransaction(null);
          } catch (error) {
            toastError('Failed to delete transaction', error, 'Please try again.');
          }
        }}
      />

      {/* Recategorize dialog */}
      <RecategorizeDialog
        open={recatOpen}
        onOpenChange={setRecatOpen}
        budgetId={selectedBudget?.ID || 0}
        hasTransaction={!!activeTransaction}
        onCategorySelect={(categoryId) => {
          if (!activeTransaction) return;
          const accountId = resolveAccountIdForTransaction(activeTransaction);
          cellCommit.mutate(Number(activeTransaction.ID), 'CategoryID', categoryId, {
            accountId,
          });
          setRecatOpen(false);
          setActiveTransaction(null);
        }}
      />
    </div>
  );
});
