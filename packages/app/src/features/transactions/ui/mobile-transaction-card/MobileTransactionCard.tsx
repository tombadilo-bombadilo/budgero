import React from 'react';
import { Card, CardContent } from '@shared/ui/card';
import { Badge } from '@shared/ui/badge';
import { CalendarClock } from 'lucide-react';
import type { GetTransactionsByAccountRow } from '@budgero/core/browser';
import { useUiStore } from '@shared/store/useUiStore';
import { formatMaskedMilli } from '@shared/lib/privacy/mask-numbers';
import { useMobileTransactionCardState } from './useMobileTransactionCardState';
import { TransactionCardHeader } from './TransactionCardHeader';
import { TransactionCardAmounts } from './TransactionCardAmounts';
import { TransactionCardActions } from './TransactionCardActions';
import { TransactionCardDetails } from './TransactionCardDetails';

interface MobileTransactionCardProps {
  transaction: GetTransactionsByAccountRow;
  isSelected: boolean;
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
  onSelectionChange: (checked: boolean) => void;
  onCellCommit: (
    transactionId: number,
    columnId: string,
    newVal: string | number | Date | null
  ) => void;
  hideAccountColumn?: boolean;
  hideSecondaryAmounts?: boolean;
  budgetId: number;
  // Controls for programmatic expansion when navigating from elsewhere
  forceExpand?: boolean;
  // When true, show category as plain text instead of a selector
  readOnlyCategory?: boolean;
  // When true, hides the row selection checkbox in the header
  hideSelection?: boolean;
  // Optional override to display a category name when source shape differs
  displayCategoryOverride?: string;
  // Hide running balance entirely (for quick view)
  hideRunningBalance?: boolean;
  // Indicates the transaction date is in the future
  isFutureTransaction?: boolean;
  // Force split data to load even if transaction category isn't marked as split
  forceLoadSplits?: boolean;
  // Render flush inside a modal: drop the card chrome (border/ring/shadow/radius)
  // so the dialog is the single surface, and hide the expand/collapse toggle
  // (the modal is always expanded).
  isPoppedOut?: boolean;
}

export const MobileTransactionCard = React.memo(function MobileTransactionCard({
  transaction,
  isSelected,
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
  onSelectionChange,
  onCellCommit,
  hideAccountColumn = false,
  hideSecondaryAmounts = false,
  budgetId,
  forceExpand = false,
  readOnlyCategory = false,
  hideSelection = false,
  displayCategoryOverride,
  hideRunningBalance = false,
  isFutureTransaction = false,
  forceLoadSplits = false,
  isPoppedOut = false,
}: MobileTransactionCardProps) {
  const selectedBudget = useUiStore((state) => state.selectedBudget);
  const privacyMaskNumbers = useUiStore((state) => state.privacyMaskNumbers);

  const {
    isExpanded,
    toggleExpanded,
    splits,
    splitsLoading,
    editSplits,
    canSplitTransaction,
    showSplitSection,
    isClearingSplits,
    splitSaveDisabled,
    remainingAmount,
    parentSplitTarget,
    splitTarget,
    setSplitTarget,
    startEditSplits,
    cancelEditSplits,
    initEditSplitsFromExisting,
    addSplitLine,
    removeSplitLine,
    updateSplitLine,
    saveSplits,
  } = useMobileTransactionCardState({
    transaction,
    getPrimaryInflow,
    getPrimaryOutflow,
    forceExpand,
    forceLoadSplits,
  });

  const isCurrentlyPending = isPending && pendingId === transaction.ID;

  // Projected recurring occurrences are read-only forecasts: render a compact
  // card with no selection, editing, or expansion.
  if (transaction.IsProjected) {
    const inflowValue = getPrimaryInflow(transaction) || 0;
    const outflowValue = getPrimaryOutflow(transaction) || 0;
    const isOutflow = outflowValue > 0;
    const amountValue = isOutflow ? outflowValue : inflowValue;
    return (
      <Card
        id={`transaction-${transaction.ID}`}
        className="mb-1.5 max-w-full overflow-hidden border-primary/20 bg-primary/5"
      >
        <CardContent className="px-3 py-2 sm:px-4 sm:py-3 max-w-full overflow-hidden">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0 space-y-0.5">
              <div className="flex items-center gap-1.5">
                <CalendarClock className="h-3 w-3 text-primary shrink-0" />
                <span className="truncate text-sm font-medium">
                  {transaction.Memo || transaction.Payee}
                </span>
                <Badge variant="secondary" className="shrink-0 text-[9px] uppercase tracking-wide">
                  Projected
                </Badge>
              </div>
              <div className="truncate text-[11px] text-muted-foreground">
                {transaction.Date} · {transaction.Category}
              </div>
            </div>
            <div
              className={`shrink-0 text-sm font-semibold tabular-nums ${
                isOutflow ? 'text-destructive' : 'text-success'
              }`}
            >
              {isOutflow ? '-' : '+'}
              {formatMaskedMilli(currentFormatter, Math.abs(amountValue), privacyMaskNumbers)}
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  const cardClassName = isPoppedOut
    ? `gap-0 rounded-none border-0 bg-transparent dark:bg-transparent ring-0 shadow-none backdrop-blur-none py-0 max-w-full overflow-hidden${
        isCurrentlyPending ? ' opacity-70' : ''
      }`
    : `mb-1.5 transition-all duration-200 ${
        isCurrentlyPending ? 'opacity-70' : ''
      } max-w-full overflow-hidden`;
  const cardContentClassName = isPoppedOut
    ? 'p-0 max-w-full overflow-hidden'
    : 'px-3 py-2 sm:px-4 sm:py-3 max-w-full overflow-hidden';

  // When popped out (rendered flush inside a modal) drop the Card wrapper entirely. Themes
  // style [data-slot='card'] directly (e.g. paper's dashed border), and that selector outranks
  // the border-0/bg-transparent utilities — so the only reliable way to shed the chrome is to
  // not be a card. Plain divs keep the same layout while escaping those theme rules.
  const CardWrapper = (isPoppedOut ? 'div' : Card) as React.ElementType;
  const CardContentWrapper = (isPoppedOut ? 'div' : CardContent) as React.ElementType;

  return (
    <CardWrapper id={`transaction-${transaction.ID}`} className={cardClassName}>
      <CardContentWrapper className={cardContentClassName}>
        {/* Main Row - Always Visible */}
        <div className="flex items-center gap-2">
          <TransactionCardHeader
            transaction={transaction}
            isSelected={isSelected}
            hideSelection={hideSelection}
            isFutureTransaction={isFutureTransaction}
            displayCategoryOverride={displayCategoryOverride}
            accountLocalizer={accountLocalizer}
            onSelectionChange={onSelectionChange}
          />

          <div className="flex items-center gap-1 flex-shrink-0">
            <TransactionCardAmounts
              transaction={transaction}
              currentFormatter={currentFormatter}
              accountLocalizer={accountLocalizer}
              globalLocalizer={globalLocalizer}
              transactionCurrencyDisplay={transactionCurrencyDisplay}
              getPrimaryInflow={getPrimaryInflow}
              getPrimaryOutflow={getPrimaryOutflow}
              getSecondaryInflow={getSecondaryInflow}
              getSecondaryOutflow={getSecondaryOutflow}
              hideRunningBalance={hideRunningBalance}
              hideSecondaryAmounts={hideSecondaryAmounts}
              splits={splits}
              splitTotal={parentSplitTarget}
            />

            {!isPoppedOut && (
              <TransactionCardActions isExpanded={isExpanded} onToggleExpanded={toggleExpanded} />
            )}
          </div>
        </div>

        {/* Expanded Details Section */}
        {isExpanded && (
          <TransactionCardDetails
            transaction={transaction}
            budgetId={budgetId}
            selectedBudgetId={selectedBudget?.ID || 0}
            currentFormatter={currentFormatter}
            accountLocalizer={accountLocalizer}
            globalLocalizer={globalLocalizer}
            transactionCurrencyDisplay={transactionCurrencyDisplay}
            getPrimaryInflow={getPrimaryInflow}
            getPrimaryOutflow={getPrimaryOutflow}
            getSecondaryInflow={getSecondaryInflow}
            getSecondaryOutflow={getSecondaryOutflow}
            onCellCommit={onCellCommit}
            hideAccountColumn={hideAccountColumn}
            hideSecondaryAmounts={hideSecondaryAmounts}
            displayCategoryOverride={displayCategoryOverride}
            readOnlyCategory={readOnlyCategory}
            splits={splits}
            splitsLoading={splitsLoading}
            editSplits={editSplits}
            showSplitSection={showSplitSection}
            canSplitTransaction={canSplitTransaction}
            isClearingSplits={isClearingSplits}
            splitSaveDisabled={splitSaveDisabled}
            remainingAmount={remainingAmount}
            splitTarget={splitTarget}
            onSplitTargetChange={setSplitTarget}
            onStartSplit={startEditSplits}
            onCancelEditSplits={cancelEditSplits}
            onInitEditSplitsFromExisting={initEditSplitsFromExisting}
            onAddSplitLine={addSplitLine}
            onRemoveSplitLine={removeSplitLine}
            onUpdateSplitLine={updateSplitLine}
            onSaveSplits={saveSplits}
          />
        )}
      </CardContentWrapper>
    </CardWrapper>
  );
});
