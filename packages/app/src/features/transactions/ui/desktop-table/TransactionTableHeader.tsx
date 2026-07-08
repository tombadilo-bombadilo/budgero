import React from 'react';
import { TableHead, TableHeader, TableRow } from '@shared/ui/table';
import { Checkbox } from '@shared/ui/checkbox';
import { ResizeHandle } from './ResizeHandle';
import type { ColumnWidths } from './useColumnResize';

interface TransactionTableHeaderProps {
  hideAccountColumn?: boolean;
  showBalanceColumn?: boolean;
  showLabelColumn?: boolean;
  showExchangeRateColumn?: boolean;
  allPageRowsSelected: boolean;
  somePageRowsSelected: boolean;
  onToggleSelectPage: (checked: boolean) => void;
  columnWidths: ColumnWidths;
  onResize: (column: keyof ColumnWidths, delta: number) => void;
}

export const TransactionTableHeader = React.memo(function TransactionTableHeader({
  hideAccountColumn = false,
  showBalanceColumn = false,
  showLabelColumn = true,
  showExchangeRateColumn = false,
  allPageRowsSelected,
  somePageRowsSelected,
  onToggleSelectPage,
  columnWidths,
  onResize,
}: TransactionTableHeaderProps) {
  return (
    <TableHeader>
      <TableRow>
        <TableHead style={{ width: columnWidths.checkbox }} className="relative group">
          <div className="flex items-center justify-center">
            <Checkbox
              checked={somePageRowsSelected ? 'indeterminate' : allPageRowsSelected}
              onCheckedChange={(checked) => onToggleSelectPage(checked === true)}
              aria-label="Select all transactions on this page"
            />
          </div>
          <ResizeHandle column="checkbox" onResize={onResize} />
        </TableHead>
        <TableHead style={{ width: columnWidths.date }} className="relative group">
          Date
          <ResizeHandle column="date" onResize={onResize} />
        </TableHead>
        <TableHead style={{ width: columnWidths.memo }} className="relative group">
          Memo
          <ResizeHandle column="memo" onResize={onResize} />
        </TableHead>
        {!hideAccountColumn && (
          <TableHead style={{ width: columnWidths.account }} className="relative group">
            Account
            <ResizeHandle column="account" onResize={onResize} />
          </TableHead>
        )}
        <TableHead style={{ width: columnWidths.payee }} className="relative group">
          Payee
          <ResizeHandle column="payee" onResize={onResize} />
        </TableHead>
        {showLabelColumn && (
          <TableHead style={{ width: columnWidths.label }} className="relative group">
            Label
            <ResizeHandle column="label" onResize={onResize} />
          </TableHead>
        )}
        <TableHead style={{ width: columnWidths.category }} className="relative group">
          Category
          <ResizeHandle column="category" onResize={onResize} />
        </TableHead>
        <TableHead style={{ width: columnWidths.inflow }} className="text-right relative group">
          Inflow
          <ResizeHandle column="inflow" onResize={onResize} />
        </TableHead>
        <TableHead style={{ width: columnWidths.outflow }} className="text-right relative group">
          Outflow
          <ResizeHandle column="outflow" onResize={onResize} />
        </TableHead>
        {showExchangeRateColumn && (
          <TableHead
            style={{ width: columnWidths.exchangeRate }}
            className="text-right relative group"
          >
            Rate
            <ResizeHandle column="exchangeRate" onResize={onResize} />
          </TableHead>
        )}
        {showBalanceColumn && (
          <TableHead style={{ width: columnWidths.balance }} className="text-right relative group">
            Balance
            <ResizeHandle column="balance" onResize={onResize} />
          </TableHead>
        )}
        <TableHead style={{ width: columnWidths.status }} className="text-center">
          Status
        </TableHead>
      </TableRow>
    </TableHeader>
  );
});
