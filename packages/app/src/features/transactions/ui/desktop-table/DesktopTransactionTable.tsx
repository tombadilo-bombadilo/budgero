import React, { useCallback, useMemo, useState } from 'react';
import type { GetTransactionsByAccountRow } from '@budgero/core/browser';
import { Table } from '@shared/ui/table';
import { TransactionTableHeader } from './TransactionTableHeader';
import { TransactionTableBody } from './TransactionTableBody';
import { TransactionTableFooter } from './TransactionTableFooter';
import { SplitDetailsDialog } from './SplitDetailsDialog';
import { useColumnResize } from './useColumnResize';

export interface DesktopTransactionTableProps {
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
  budgetId: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  onNextPage: () => void;
  onPreviousPage: () => void;
  currentPage: number;
  totalPages: number;
}

export function DesktopTransactionTable({
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
  showBalanceColumn = false,
  showLabelColumn = true,
  showExchangeRateColumn = false,
  budgetId,
  hasNextPage,
  hasPreviousPage,
  onNextPage,
  onPreviousPage,
  currentPage,
  totalPages,
}: DesktopTransactionTableProps) {
  const [splitDialogState, setSplitDialogState] = useState<{
    transaction: GetTransactionsByAccountRow;
    startEditing?: boolean;
  } | null>(null);

  const { columnWidths, handleResize, totalWidth } = useColumnResize(
    hideAccountColumn,
    showBalanceColumn,
    showExchangeRateColumn,
    showLabelColumn
  );

  const paginatedTransactions = useMemo(() => {
    const startIndex = page * pageSize;
    const endIndex = startIndex + pageSize;
    return transactions.slice(startIndex, endIndex);
  }, [transactions, page, pageSize]);

  const pageTransactionIds = useMemo(
    () => paginatedTransactions.map((transaction) => transaction.ID.toString()),
    [paginatedTransactions]
  );

  const selectedPageCount = useMemo(() => {
    return pageTransactionIds.reduce(
      (count, id) => count + (rowSelection[id] || rowSelection[Number(id)] ? 1 : 0),
      0
    );
  }, [pageTransactionIds, rowSelection]);

  const allPageRowsSelected =
    pageTransactionIds.length > 0 && selectedPageCount === pageTransactionIds.length;
  const somePageRowsSelected = selectedPageCount > 0 && !allPageRowsSelected;

  const handleToggleSelectPage = useCallback(
    (checked: boolean) => {
      if (pageTransactionIds.length === 0) return;
      onSelectionChange(pageTransactionIds[0], checked, pageTransactionIds);
    },
    [onSelectionChange, pageTransactionIds]
  );

  const handleSplitView = (transaction: GetTransactionsByAccountRow) => {
    setSplitDialogState({ transaction });
  };

  const handleSplitCreate = (transaction: GetTransactionsByAccountRow) => {
    setSplitDialogState({ transaction, startEditing: true });
  };

  // Empty state
  if (paginatedTransactions.length === 0) {
    return (
      <div className="hidden sm:flex flex-col items-center justify-center py-16 border rounded-md border-dashed text-muted-foreground">
        <p className="text-lg font-medium mb-2">No transactions found</p>
        <p className="text-sm text-muted-foreground/80">
          Adjust your filters or add a new transaction to get started.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="hidden sm:flex flex-col gap-3">
        <div className="rounded-md border bg-background overflow-x-auto">
          <Table style={{ minWidth: totalWidth, tableLayout: 'fixed' }}>
            <TransactionTableHeader
              hideAccountColumn={hideAccountColumn}
              showBalanceColumn={showBalanceColumn}
              showLabelColumn={showLabelColumn}
              showExchangeRateColumn={showExchangeRateColumn}
              allPageRowsSelected={allPageRowsSelected}
              somePageRowsSelected={somePageRowsSelected}
              onToggleSelectPage={handleToggleSelectPage}
              columnWidths={columnWidths}
              onResize={handleResize}
            />
            <TransactionTableBody
              transactions={paginatedTransactions}
              rowSelection={rowSelection}
              isPending={isPending}
              pendingId={pendingId}
              budgetId={budgetId}
              hideAccountColumn={hideAccountColumn}
              hideSecondaryAmounts={hideSecondaryAmounts}
              showBalanceColumn={showBalanceColumn}
              showLabelColumn={showLabelColumn}
              showExchangeRateColumn={showExchangeRateColumn}
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
            />
          </Table>
        </div>

        <TransactionTableFooter
          currentPage={currentPage}
          totalPages={totalPages}
          hasNextPage={hasNextPage}
          hasPreviousPage={hasPreviousPage}
          onNextPage={onNextPage}
          onPreviousPage={onPreviousPage}
        />
      </div>

      <SplitDetailsDialog
        transaction={splitDialogState?.transaction ?? null}
        startInEditMode={Boolean(splitDialogState?.startEditing)}
        onClose={() => setSplitDialogState(null)}
        globalLocalizer={globalLocalizer}
        currentFormatter={currentFormatter}
        getPrimaryInflow={getPrimaryInflow}
        getPrimaryOutflow={getPrimaryOutflow}
        budgetId={budgetId}
      />
    </>
  );
}
