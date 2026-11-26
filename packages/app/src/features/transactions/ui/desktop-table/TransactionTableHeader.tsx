import { useLingui } from '@lingui/react/macro';
import React from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { TableHead, TableHeader, TableRow } from '@shared/ui/table';
import { cn } from '@shared/lib/utils';
import { TransactionSelectionCheckbox } from '@features/transactions/ui/TransactionSelectionCheckbox';
import type {
  TransactionSortColumn,
  TransactionSortState,
} from '@features/transactions/lib/transaction-sort';
import { ResizeHandle } from './ResizeHandle';
import type { ColumnWidths } from './useColumnResize';

interface TransactionTableHeaderProps {
  hideAccountColumn?: boolean;
  showBalanceColumn?: boolean;
  showLabelColumn?: boolean;
  showExchangeRateColumn?: boolean;
  /** Show the Memo column (on by default). */
  showMemoColumn?: boolean;
  /** Show the Payee column (on by default). */
  showPayeeColumn?: boolean;
  allPageRowsSelected: boolean;
  somePageRowsSelected: boolean;
  onToggleSelectPage: (checked: boolean) => void;
  columnWidths: ColumnWidths;
  onResize: (column: keyof ColumnWidths, delta: number) => void;
  /** Active sort; null = default (date) order. */
  sort?: TransactionSortState;
  /** A sortable header was clicked (or activated with Enter/Space). */
  onSortChange?: (column: TransactionSortColumn) => void;
}

interface SortableHeadProps {
  label: string;
  width: number;
  sortColumn: TransactionSortColumn;
  sort: TransactionSortState;
  onSortChange?: (column: TransactionSortColumn) => void;
  align?: 'left' | 'right' | 'center';
  /** Resize handle for this column, when it has one. */
  resizeColumn?: keyof ColumnWidths;
  onResize: (column: keyof ColumnWidths, delta: number) => void;
}

/**
 * A header that sorts its column. The sort control is a button beside the
 * resize handle (not around it), so dragging or keyboard-resizing a column
 * never starts a sort.
 */
function SortableHead({
  label,
  width,
  sortColumn,
  sort,
  onSortChange,
  align = 'left',
  resizeColumn,
  onResize,
}: SortableHeadProps) {
  const { t } = useLingui();
  const active = sort?.column === sortColumn ? sort.direction : null;
  const ariaSort = active === 'asc' ? 'ascending' : active === 'desc' ? 'descending' : undefined;
  const Arrow = active === 'desc' ? ArrowDown : ArrowUp;
  const hint =
    active === 'asc'
      ? t`Sorted ascending. Click to sort descending.`
      : active === 'desc'
        ? t`Sorted descending. Click to go back to date order.`
        : t`Click to sort by this column.`;

  return (
    <TableHead
      style={{ width }}
      aria-sort={ariaSort}
      className={cn(
        'relative group',
        align === 'right' && 'text-right',
        align === 'center' && 'text-center'
      )}
    >
      <button
        type="button"
        onClick={() => onSortChange?.(sortColumn)}
        title={hint}
        className={cn(
          'inline-flex max-w-full items-center gap-1 rounded-sm font-medium hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          align === 'right' && 'flex-row-reverse'
        )}
      >
        <span className="truncate">{label}</span>
        <Arrow
          aria-hidden="true"
          className={cn(
            'h-3.5 w-3.5 shrink-0 transition-opacity',
            active ? 'opacity-100' : 'opacity-0 group-hover:opacity-40'
          )}
        />
      </button>
      {resizeColumn && <ResizeHandle column={resizeColumn} onResize={onResize} />}
    </TableHead>
  );
}

export const TransactionTableHeader = React.memo(function TransactionTableHeader({
  hideAccountColumn = false,
  showBalanceColumn = false,
  showLabelColumn = true,
  showExchangeRateColumn = false,
  showMemoColumn = true,
  showPayeeColumn = true,
  allPageRowsSelected,
  somePageRowsSelected,
  onToggleSelectPage,
  columnWidths,
  onResize,
  sort = null,
  onSortChange,
}: TransactionTableHeaderProps) {
  const { t } = useLingui();
  const sortProps = { sort, onSortChange, onResize };

  return (
    <TableHeader className="sticky top-0 z-20 bg-background shadow-[0_1px_0_hsl(var(--border))]">
      <TableRow>
        <TableHead
          style={{ width: columnWidths.checkbox }}
          className="relative group px-0 select-none"
        >
          <div className="flex items-center justify-center">
            <TransactionSelectionCheckbox
              fillCell
              checked={somePageRowsSelected ? 'indeterminate' : allPageRowsSelected}
              onCheckedChange={(checked) => onToggleSelectPage(checked === true)}
              aria-label={t`Select all transactions on this page`}
            />
          </div>
          <ResizeHandle column="checkbox" onResize={onResize} />
        </TableHead>
        <SortableHead
          label={t`Date`}
          width={columnWidths.date}
          sortColumn="date"
          resizeColumn="date"
          {...sortProps}
        />
        {showMemoColumn && (
          <SortableHead
            label={t`Memo`}
            width={columnWidths.memo}
            sortColumn="memo"
            resizeColumn="memo"
            {...sortProps}
          />
        )}
        {!hideAccountColumn && (
          <SortableHead
            label={t`Account`}
            width={columnWidths.account}
            sortColumn="account"
            resizeColumn="account"
            {...sortProps}
          />
        )}
        {showPayeeColumn && (
          <SortableHead
            label={t`Payee`}
            width={columnWidths.payee}
            sortColumn="payee"
            resizeColumn="payee"
            {...sortProps}
          />
        )}
        {showLabelColumn && (
          <SortableHead
            label={t`Label`}
            width={columnWidths.label}
            sortColumn="label"
            resizeColumn="label"
            {...sortProps}
          />
        )}
        <SortableHead
          label={t`Category`}
          width={columnWidths.category}
          sortColumn="category"
          resizeColumn="category"
          {...sortProps}
        />
        <SortableHead
          label={t`Inflow`}
          width={columnWidths.inflow}
          sortColumn="amount"
          resizeColumn="inflow"
          align="right"
          {...sortProps}
        />
        <SortableHead
          label={t`Outflow`}
          width={columnWidths.outflow}
          sortColumn="amount"
          resizeColumn="outflow"
          align="right"
          {...sortProps}
        />
        {showExchangeRateColumn && (
          <TableHead
            style={{ width: columnWidths.exchangeRate }}
            className="text-right relative group"
          >
            {t`Budget rate`}
            <ResizeHandle column="exchangeRate" onResize={onResize} />
          </TableHead>
        )}
        {showBalanceColumn && (
          <TableHead style={{ width: columnWidths.balance }} className="text-right relative group">
            {t`Balance`}
            <ResizeHandle column="balance" onResize={onResize} />
          </TableHead>
        )}
        <SortableHead
          label={t`Status`}
          width={columnWidths.status}
          sortColumn="status"
          align="center"
          {...sortProps}
        />
      </TableRow>
    </TableHeader>
  );
});
