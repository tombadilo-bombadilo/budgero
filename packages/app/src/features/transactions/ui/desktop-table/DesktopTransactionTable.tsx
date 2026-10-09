import { Trans } from '@lingui/react/macro';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { GetTransactionsByAccountRow } from '@budgero/core/browser';
import { Table } from '@shared/ui/table';
import { TransactionTableHeader } from './TransactionTableHeader';
import { TransactionTableBody } from './TransactionTableBody';
import { SplitDetailsDialog } from './SplitDetailsDialog';
import { useColumnResize } from './useColumnResize';
import type {
  TransactionEditableColumn,
  TransactionEditorDirectories,
} from './transaction-editor-types';
import { useVirtualizedTransactionRows } from './useVirtualizedTransactionRows';
import { useTransactionViewportHeight } from './useTransactionViewportHeight';
import { InlineTransactionRow } from './InlineTransactionRow';

export interface DesktopTransactionTableProps {
  transactions: GetTransactionsByAccountRow[];
  rowSelection: Record<string, boolean>;
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
  onSelectionChange: (
    rowId: string,
    checked: boolean,
    rangeIds?: string[],
    replaceSelection?: boolean
  ) => void;
  hideAccountColumn?: boolean;
  /** Hide secondary/original amount display. Used with forceBudgetCurrency. */
  hideSecondaryAmounts?: boolean;
  /** Show optional Balance column. */
  showBalanceColumn?: boolean;
  /** Show the Label column (on by default). */
  showLabelColumn?: boolean;
  /** Show optional Exchange Rate column (for foreign-currency accounts). */
  showExchangeRateColumn?: boolean;
  editorDirectories: TransactionEditorDirectories;
  budgetId: number;
  scrollResetKey: string;
  canLoadMore?: boolean;
  isLoadingMore?: boolean;
  onLoadMore?: () => Promise<unknown>;
  /** Present while the inline add row is open. */
  inlineAdd?: {
    accountId?: number;
    onClose: () => void;
  };
}

export function DesktopTransactionTable({
  transactions,
  rowSelection,
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
  showBalanceColumn = false,
  showLabelColumn = true,
  showExchangeRateColumn = false,
  editorDirectories,
  budgetId,
  scrollResetKey,
  canLoadMore = false,
  isLoadingMore = false,
  onLoadMore,
  inlineAdd,
}: DesktopTransactionTableProps) {
  const [splitDialogState, setSplitDialogState] = useState<{
    transaction: GetTransactionsByAccountRow;
    startEditing?: boolean;
  } | null>(null);
  const [editingCell, setEditingCell] = useState<{
    transactionId: number;
    column: TransactionEditableColumn;
  } | null>(null);

  const handleActivateCell = useCallback(
    (transactionId: number, column: TransactionEditableColumn) => {
      setEditingCell({ transactionId, column });
    },
    []
  );
  const handleDeactivateCell = useCallback(() => setEditingCell(null), []);

  const { columnWidths, handleResize, totalWidth } = useColumnResize(
    hideAccountColumn,
    showBalanceColumn,
    showExchangeRateColumn,
    showLabelColumn
  );

  const {
    viewportRef,
    handleScroll,
    scrollToIndex,
    visibleItems,
    startIndex,
    topSpacerHeight,
    bottomSpacerHeight,
    endIndex,
  } = useVirtualizedTransactionRows(transactions);

  useTransactionViewportHeight(viewportRef, transactions.length > 0);

  // Opening an editor can itself trigger a browser scroll adjustment. Keep it
  // open while its row is rendered, but forget it once virtualization removes
  // the row so scrolling back cannot reopen an abandoned editor.
  if (
    editingCell &&
    !visibleItems.some((transaction) => transaction.ID === editingCell.transactionId)
  ) {
    setEditingCell(null);
  }

  useEffect(() => {
    if (!canLoadMore || isLoadingMore || endIndex < transactions.length - 20) return;
    void onLoadMore?.();
  }, [canLoadMore, endIndex, isLoadingMore, onLoadMore, transactions.length]);

  const transactionIds = useMemo(
    () => transactions.map((transaction) => transaction.ID.toString()),
    [transactions]
  );

  const selectedCount = useMemo(() => {
    return transactionIds.reduce(
      (count, id) => count + (rowSelection[id] || rowSelection[Number(id)] ? 1 : 0),
      0
    );
  }, [transactionIds, rowSelection]);

  const allRowsSelected = transactionIds.length > 0 && selectedCount === transactionIds.length;
  const someRowsSelected = selectedCount > 0 && !allRowsSelected;

  const handleToggleSelectAll = useCallback(
    (checked: boolean) => {
      if (transactionIds.length === 0) return;
      onSelectionChange(transactionIds[0], checked, transactionIds);
    },
    [onSelectionChange, transactionIds]
  );

  useEffect(() => {
    const frame = requestAnimationFrame(() => scrollToIndex(0));
    return () => cancelAnimationFrame(frame);
  }, [scrollResetKey, scrollToIndex]);

  useEffect(() => {
    const rawId = localStorage.getItem('selectedTransactionId');
    if (!rawId) return;
    const selectedId = Number.parseInt(rawId, 10);
    if (!Number.isFinite(selectedId)) return;
    const index = transactions.findIndex((transaction) => transaction.ID === selectedId);
    if (index < 0) return;
    const frame = requestAnimationFrame(() => scrollToIndex(index));
    return () => cancelAnimationFrame(frame);
  }, [scrollToIndex, transactions]);

  const columnCount =
    8 +
    (hideAccountColumn ? 0 : 1) +
    (showLabelColumn ? 1 : 0) +
    (showExchangeRateColumn ? 1 : 0) +
    (showBalanceColumn ? 1 : 0);

  const isInlineAddOpen = !!inlineAdd;
  useEffect(() => {
    if (!isInlineAddOpen) return;
    const frame = requestAnimationFrame(() => scrollToIndex(0));
    return () => cancelAnimationFrame(frame);
  }, [isInlineAddOpen, scrollToIndex]);

  const handleSplitView = useCallback((transaction: GetTransactionsByAccountRow) => {
    setSplitDialogState({ transaction });
  }, []);

  const handleSplitCreate = useCallback((transaction: GetTransactionsByAccountRow) => {
    setSplitDialogState({ transaction, startEditing: true });
  }, []);

  // Empty state
  if (transactions.length === 0 && !inlineAdd) {
    return (
      <div className="hidden sm:flex flex-col items-center justify-center py-16 border rounded-md border-dashed text-muted-foreground">
        <p className="text-lg font-medium mb-2">
          <Trans>No transactions found</Trans>
        </p>
        <p className="text-sm text-muted-foreground/80">
          <Trans>Adjust your filters or add a new transaction to get started.</Trans>
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="hidden sm:flex flex-col gap-3">
        <div className="overflow-hidden rounded-md border bg-background">
          <Table
            containerRef={viewportRef}
            containerClassName="overflow-auto overscroll-contain"
            containerProps={{ onScroll: handleScroll }}
            style={{ minWidth: totalWidth, tableLayout: 'fixed' }}
          >
            <TransactionTableHeader
              hideAccountColumn={hideAccountColumn}
              showBalanceColumn={showBalanceColumn}
              showLabelColumn={showLabelColumn}
              showExchangeRateColumn={showExchangeRateColumn}
              allPageRowsSelected={allRowsSelected}
              somePageRowsSelected={someRowsSelected}
              onToggleSelectPage={handleToggleSelectAll}
              columnWidths={columnWidths}
              onResize={handleResize}
            />
            <TransactionTableBody
              transactions={visibleItems}
              selectionTransactions={transactions}
              rowOffset={startIndex}
              topSpacerHeight={topSpacerHeight}
              bottomSpacerHeight={bottomSpacerHeight}
              columnCount={columnCount}
              rowSelection={rowSelection}
              isPending={isPending}
              pendingId={pendingId}
              budgetId={budgetId}
              hideAccountColumn={hideAccountColumn}
              hideSecondaryAmounts={hideSecondaryAmounts}
              showBalanceColumn={showBalanceColumn}
              showLabelColumn={showLabelColumn}
              showExchangeRateColumn={showExchangeRateColumn}
              editorDirectories={editorDirectories}
              editingCell={editingCell}
              currentFormatter={currentFormatter}
              accountLocalizer={accountLocalizer}
              globalLocalizer={globalLocalizer}
              transactionCurrencyDisplay={transactionCurrencyDisplay}
              getPrimaryInflow={getPrimaryInflow}
              getPrimaryOutflow={getPrimaryOutflow}
              getSecondaryInflow={getSecondaryInflow}
              getSecondaryOutflow={getSecondaryOutflow}
              onCellCommit={onCellCommit}
              onSelectionChange={onSelectionChange}
              onSplitView={handleSplitView}
              onSplitCreate={handleSplitCreate}
              onActivateCell={handleActivateCell}
              onDeactivateCell={handleDeactivateCell}
              leadingRows={
                inlineAdd && (
                  <InlineTransactionRow
                    budgetId={budgetId}
                    accountId={inlineAdd.accountId}
                    hideAccountColumn={hideAccountColumn}
                    showLabelColumn={showLabelColumn}
                    showExchangeRateColumn={showExchangeRateColumn}
                    showBalanceColumn={showBalanceColumn}
                    columnCount={columnCount}
                    editorDirectories={editorDirectories}
                    onClose={inlineAdd.onClose}
                  />
                )
              }
            />
          </Table>
        </div>
      </div>

      <SplitDetailsDialog
        transaction={splitDialogState?.transaction ?? null}
        startInEditMode={Boolean(splitDialogState?.startEditing)}
        onClose={() => setSplitDialogState(null)}
        currentFormatter={currentFormatter}
        transactionCurrencyDisplay={transactionCurrencyDisplay}
        getPrimaryInflow={getPrimaryInflow}
        getPrimaryOutflow={getPrimaryOutflow}
        budgetId={budgetId}
      />
    </>
  );
}
