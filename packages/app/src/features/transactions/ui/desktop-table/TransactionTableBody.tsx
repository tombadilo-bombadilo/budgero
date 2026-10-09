import { Trans } from '@lingui/react/macro';
import React, { useCallback, useRef } from 'react';
import type { GetTransactionsByAccountRow } from '@budgero/core/browser';
import { TableBody } from '@shared/ui/table';
import { TransactionRow } from './TransactionRow';
import type {
  TransactionEditableColumn,
  TransactionEditorDirectories,
} from './transaction-editor-types';

interface TransactionTableBodyProps {
  transactions: GetTransactionsByAccountRow[];
  selectionTransactions?: GetTransactionsByAccountRow[];
  rowOffset?: number;
  topSpacerHeight?: number;
  bottomSpacerHeight?: number;
  columnCount?: number;
  rowSelection: Record<string, boolean>;
  isPending: boolean;
  pendingId?: number;
  budgetId: number;
  hideAccountColumn: boolean;
  hideSecondaryAmounts?: boolean;
  showBalanceColumn?: boolean;
  showLabelColumn?: boolean;
  showExchangeRateColumn?: boolean;
  editorDirectories: TransactionEditorDirectories;
  editingCell: { transactionId: number; column: TransactionEditableColumn } | null;
  currentFormatter: Intl.NumberFormat;
  accountLocalizer: Intl.NumberFormat;
  globalLocalizer: Intl.NumberFormat;
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
  onSplitView: (transaction: GetTransactionsByAccountRow) => void;
  onSplitCreate: (transaction: GetTransactionsByAccountRow) => void;
  onActivateCell: (transactionId: number, column: TransactionEditableColumn) => void;
  onDeactivateCell: () => void;
  /** Rendered above the transactions, e.g. the inline add row. */
  leadingRows?: React.ReactNode;
}

export const TransactionTableBody = React.memo(function TransactionTableBody({
  transactions,
  selectionTransactions = transactions,
  rowOffset = 0,
  topSpacerHeight = 0,
  bottomSpacerHeight = 0,
  columnCount = 1,
  rowSelection,
  isPending,
  pendingId,
  budgetId,
  hideAccountColumn,
  hideSecondaryAmounts = false,
  showBalanceColumn = false,
  showLabelColumn = true,
  showExchangeRateColumn = false,
  editorDirectories,
  editingCell,
  currentFormatter,
  accountLocalizer,
  globalLocalizer,
  transactionCurrencyDisplay,
  getPrimaryInflow,
  getPrimaryOutflow,
  getSecondaryInflow,
  getSecondaryOutflow,
  onCellCommit,
  onSelectionChange,
  onSplitView,
  onSplitCreate,
  onActivateCell,
  onDeactivateCell,
  leadingRows,
}: TransactionTableBodyProps) {
  const lastSelectedIndexRef = useRef<number | null>(null);
  const shiftPressedRef = useRef(false);
  const additiveSelectionPressedRef = useRef(false);

  const handleCheckboxPointerDown = useCallback(
    (e: { shiftKey: boolean; metaKey?: boolean; ctrlKey?: boolean }) => {
      shiftPressedRef.current = e.shiftKey;
      additiveSelectionPressedRef.current = Boolean(e.metaKey || e.ctrlKey);
    },
    []
  );

  const handleCheckboxChange = useCallback(
    (transaction: GetTransactionsByAccountRow, rowIndex: number, shouldSelect: boolean) => {
      const idStr = transaction.ID.toString();
      const isShift = shiftPressedRef.current;
      const isAdditive = additiveSelectionPressedRef.current;
      shiftPressedRef.current = false;
      additiveSelectionPressedRef.current = false;

      const shouldReplaceSelection = shouldSelect && !isShift && !isAdditive;
      const shouldReplaceWithRange = isShift && !isAdditive && shouldSelect;

      if (isShift && lastSelectedIndexRef.current !== null) {
        const start = Math.min(lastSelectedIndexRef.current, rowIndex);
        const end = Math.max(lastSelectedIndexRef.current, rowIndex);
        const rangeIds = selectionTransactions.slice(start, end + 1).map((t) => t.ID.toString());
        onSelectionChange(idStr, shouldSelect, rangeIds, shouldReplaceWithRange);
      } else {
        onSelectionChange(idStr, shouldSelect, undefined, shouldReplaceSelection);
      }

      if (shouldSelect) {
        lastSelectedIndexRef.current = rowIndex;
      } else if (shouldReplaceSelection) {
        lastSelectedIndexRef.current = null;
      }
    },
    [selectionTransactions, onSelectionChange]
  );

  return (
    <TableBody>
      {leadingRows}
      {topSpacerHeight > 0 && (
        <tr aria-hidden="true">
          <td colSpan={columnCount} style={{ height: topSpacerHeight, padding: 0, border: 0 }}>
            <span className="sr-only">
              <Trans>Rows above the visible area</Trans>
            </span>
          </td>
        </tr>
      )}
      {transactions.map((transaction, rowIndex) => {
        const idStr = transaction.ID.toString();
        const isSelected = Boolean(rowSelection[idStr]);
        const isRowPending = isPending && pendingId === transaction.ID;

        return (
          <TransactionRow
            key={transaction.ID}
            transaction={transaction}
            isSelected={isSelected}
            isRowPending={isRowPending}
            budgetId={budgetId}
            hideAccountColumn={hideAccountColumn}
            hideSecondaryAmounts={hideSecondaryAmounts}
            showBalanceColumn={showBalanceColumn}
            showLabelColumn={showLabelColumn}
            showExchangeRateColumn={showExchangeRateColumn}
            editorDirectories={editorDirectories}
            editingColumn={
              editingCell?.transactionId === transaction.ID ? editingCell.column : null
            }
            currentFormatter={currentFormatter}
            accountLocalizer={accountLocalizer}
            globalLocalizer={globalLocalizer}
            transactionCurrencyDisplay={transactionCurrencyDisplay}
            getPrimaryInflow={getPrimaryInflow}
            getPrimaryOutflow={getPrimaryOutflow}
            getSecondaryInflow={getSecondaryInflow}
            getSecondaryOutflow={getSecondaryOutflow}
            onCellCommit={onCellCommit}
            onCheckboxPointerDown={handleCheckboxPointerDown}
            rowIndex={rowOffset + rowIndex}
            onCheckboxChange={handleCheckboxChange}
            onSplitView={onSplitView}
            onSplitCreate={onSplitCreate}
            onActivateCell={onActivateCell}
            onDeactivateCell={onDeactivateCell}
          />
        );
      })}
      {bottomSpacerHeight > 0 && (
        <tr aria-hidden="true">
          <td colSpan={columnCount} style={{ height: bottomSpacerHeight, padding: 0, border: 0 }}>
            <span className="sr-only">
              <Trans>Rows below the visible area</Trans>
            </span>
          </td>
        </tr>
      )}
    </TableBody>
  );
});
