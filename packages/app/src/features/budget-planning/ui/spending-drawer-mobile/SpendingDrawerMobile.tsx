import React from 'react';
import { Drawer, DrawerContent } from '@shared/ui/drawer';
import { useMaskedLocalizer } from '@shared/lib/privacy/useMaskedLocalizer';
import { useSpendingDrawerState } from './useSpendingDrawerState';
import { CategoryHeader } from './CategoryHeader';
import { SpendingChart } from './SpendingChart';
import { TransactionList } from './TransactionList';
import { TransactionDialogs } from './TransactionDialogs';
import type { SpendingDrawerMobileProps } from './types';

export const SpendingDrawerMobile = React.memo(function SpendingDrawerMobile({
  open,
  onClose,
  selectedCategory,
  currentMonth,
}: SpendingDrawerMobileProps) {
  const [showHeavyContent, setShowHeavyContent] = React.useState(false);

  React.useEffect(() => {
    if (!open) {
      setShowHeavyContent(false);
      return;
    }
    const timer = window.setTimeout(() => {
      setShowHeavyContent(true);
    }, 140);
    return () => {
      window.clearTimeout(timer);
    };
  }, [open, selectedCategory?.id, currentMonth]);

  const state = useSpendingDrawerState(selectedCategory, currentMonth, {
    deferCalculations: !showHeavyContent,
  });

  const hasActiveOverlay = state.quickViewOpen || state.confirmDeleteOpen || state.recatOpen;

  // Use a ref that lingers briefly after sub-dialogs close.
  // When the X button removes a dialog's portal, the click can fall through
  // to the Drawer overlay underneath. The state-based guard is already false
  // by then, so the ref acts as a safety net during the brief gap.
  const overlayGuardRef = React.useRef(false);
  React.useEffect(() => {
    if (hasActiveOverlay) {
      overlayGuardRef.current = true;
      return;
    }
    const timer = window.setTimeout(() => {
      overlayGuardRef.current = false;
    }, 150);
    return () => window.clearTimeout(timer);
  }, [hasActiveOverlay]);

  const handleSheetOpenChange = React.useCallback(
    (open: boolean) => {
      if (!open && overlayGuardRef.current) return;
      if (!open) onClose();
    },
    [onClose]
  );

  const {
    selectedBudget,
    globalLocalizer,
    filteredTransactions,
    cumulativeData,
    totalSpent,
    goalStatus,
    maxValue,
    shouldShowBudgetPace,
    loading,

    page,
    setPage,
    rowsPerPage,

    collapsedDates,
    toggleDateCollapse,

    quickViewOpen,
    setQuickViewOpen,
    quickViewTx,

    confirmDeleteOpen,
    setConfirmDeleteOpen,
    handleDeleteTx,
    isDeleting,

    recatOpen,
    setRecatOpen,
    recatTx,
    handleRecategorize,
    openRecategorize,
    openDeleteConfirm,

    handleTransactionClick,
    handleQuickCommit,

    isPending,
    pendingId,
  } = state;

  const contentLoading = loading || !showHeavyContent;

  // Mask amounts in read-only surfaces while privacy mode is on. The edit
  // dialogs keep the raw localizer so inputs seed with real digits.
  const maskedLocalizer = useMaskedLocalizer(globalLocalizer);

  return (
    <Drawer open={open} onOpenChange={handleSheetOpenChange} dismissible={!hasActiveOverlay}>
      <DrawerContent
        style={{ touchAction: 'pan-y' }}
        className="h-[85vh] data-[vaul-drawer-direction=bottom]:max-h-[85vh] rounded-t-2xl p-0 sm:max-w-[800px] sm:mx-auto flex flex-col bg-background border-t border-border/30 ring-1 ring-black/10 dark:ring-white/10 shadow-lg"
      >
        <div
          data-slot="spending-drawer-scroll"
          className="spending-drawer-scrollbar overflow-y-auto overscroll-contain flex-1 p-4"
          style={{ WebkitOverflowScrolling: 'touch', transform: 'translateZ(0)' }}
        >
          {/* Category Header */}
          <CategoryHeader
            selectedCategory={selectedCategory}
            currentMonth={currentMonth}
            loading={contentLoading}
            totalSpent={totalSpent}
            goalStatus={goalStatus}
            globalLocalizer={maskedLocalizer}
          />

          <div className="space-y-4 max-w-full">
            {contentLoading ? (
              <div className="text-center py-8">Preparing transactions...</div>
            ) : (
              <>
                {/* Chart */}
                <SpendingChart
                  cumulativeData={cumulativeData}
                  maxValue={maxValue}
                  shouldShowBudgetPace={shouldShowBudgetPace}
                  globalLocalizer={maskedLocalizer}
                />

                {/* Transaction List */}
                <TransactionList
                  transactions={filteredTransactions}
                  loading={loading}
                  page={page}
                  rowsPerPage={rowsPerPage}
                  collapsedDates={collapsedDates}
                  globalLocalizer={maskedLocalizer}
                  onPageChange={setPage}
                  onToggleDateCollapse={toggleDateCollapse}
                  onTransactionClick={handleTransactionClick}
                  onRecategorize={openRecategorize}
                  onDelete={openDeleteConfirm}
                />
              </>
            )}
          </div>
        </div>
      </DrawerContent>

      {/* Dialogs */}
      <TransactionDialogs
        quickViewOpen={quickViewOpen}
        quickViewTx={quickViewTx}
        onQuickViewClose={() => setQuickViewOpen(false)}
        onQuickCommit={handleQuickCommit}
        isPending={isPending}
        pendingId={pendingId}
        globalLocalizer={globalLocalizer}
        budgetId={selectedBudget?.ID || 0}
        confirmDeleteOpen={confirmDeleteOpen}
        onConfirmDeleteClose={() => setConfirmDeleteOpen(false)}
        onOpenDeleteConfirm={() => setConfirmDeleteOpen(true)}
        onDeleteConfirm={handleDeleteTx}
        isDeleting={isDeleting}
        recatOpen={recatOpen}
        recatTx={recatTx}
        onRecatClose={() => setRecatOpen(false)}
        onRecategorize={handleRecategorize}
      />
    </Drawer>
  );
});
