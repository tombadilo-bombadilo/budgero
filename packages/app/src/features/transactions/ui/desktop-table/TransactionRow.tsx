import React from 'react';
import type { GetTransactionsByAccountRow } from '@budgero/core/browser';
import { isFutureDate } from '@shared/lib/date-utils';
import { TableCell, TableRow } from '@shared/ui/table';
import { Checkbox } from '@shared/ui/checkbox';
import { Button } from '@shared/ui/button';
import { CalculatorCell } from '@shared/ui/calculator-cell';
import { DatePickerCell } from '@features/transactions/ui/cells/DatePickerCell';
import { CategorySelectCell } from '@features/transactions/ui/cells/CategorySelectCell';
import { AccountSelectCell } from '@features/transactions/ui/cells/AccountSelectCell';
import { EditableCell } from '@features/transactions/ui/cells/EditableCell';
import { ExchangeRateCell } from '@features/transactions/ui/cells/ExchangeRateCell';
import { PayeeSelectCell } from '@features/transactions/ui/cells/PayeeSelectCell';
import { LabelSelectCell } from '@features/transactions/ui/cells/LabelSelectCell';
import { Badge } from '@shared/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@shared/ui/popover';
import { ArrowLeftRight } from 'lucide-react';
import { cn } from '@shared/lib/utils';
import { SecondaryAmount } from '@features/transactions/ui/SecondaryAmount';
import { StatusIndicatorPopover } from '@features/transactions/ui/StatusIndicatorPopover';
import { useUiStore } from '@shared/store/useUiStore';
import { formatMaskedMilli } from '@shared/lib/privacy/mask-numbers';
import { asMilli } from '@shared/lib/currency/milli';
import { getRunningBalance } from '@features/transactions/lib/running-balance';

interface TransactionRowProps {
  transaction: GetTransactionsByAccountRow;
  isSelected: boolean;
  isRowPending: boolean;
  budgetId: number;
  hideAccountColumn: boolean;
  hideSecondaryAmounts?: boolean;
  showBalanceColumn?: boolean;
  showLabelColumn?: boolean;
  showExchangeRateColumn?: boolean;
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
  onCheckboxPointerDown: (e: { shiftKey: boolean; metaKey?: boolean; ctrlKey?: boolean }) => void;
  onCheckboxChange: (checked: boolean) => void;
  onSplitView: (transaction: GetTransactionsByAccountRow) => void;
  onSplitCreate: (transaction: GetTransactionsByAccountRow) => void;
}

export const TransactionRow = React.memo(function TransactionRow({
  transaction,
  isSelected,
  isRowPending,
  budgetId,
  hideAccountColumn,
  hideSecondaryAmounts = false,
  showBalanceColumn = false,
  showLabelColumn = true,
  showExchangeRateColumn = false,
  currentFormatter,
  accountLocalizer,
  globalLocalizer,
  transactionCurrencyDisplay,
  getPrimaryInflow,
  getPrimaryOutflow,
  getSecondaryInflow,
  getSecondaryOutflow,
  onCellCommit,
  onCheckboxPointerDown,
  onCheckboxChange,
  onSplitView,
  onSplitCreate,
}: TransactionRowProps) {
  const privacyMaskNumbers = useUiStore((state) => state.privacyMaskNumbers);
  // Row amounts and running balances are stored milliunits.
  const formatAmount = (formatter: Intl.NumberFormat, value: number) =>
    formatMaskedMilli(formatter, value, privacyMaskNumbers);

  const isFutureTransaction = isFutureDate(transaction.Date);
  const isSplitCategory = transaction.Category === 'Split';
  const hasAmount = getPrimaryInflow(transaction) !== 0 || getPrimaryOutflow(transaction) !== 0;
  // Transfers move money between your own accounts and cannot be split.
  const isTransfer = !!transaction.TransferID && transaction.TransferID.trim() !== '';

  const renderBalanceCell = () => {
    const numValue = getRunningBalance(transaction, transactionCurrencyDisplay);
    if (numValue === null) {
      return <span className="text-muted-foreground">—</span>;
    }
    const isProjectedBalance = !!transaction.RunningBalanceProjected;
    return (
      <span
        className={cn(
          numValue < 0 ? 'text-destructive' : 'text-foreground',
          isProjectedBalance && 'italic opacity-70'
        )}
        title={
          isProjectedBalance
            ? 'Projected balance — includes scheduled recurring entries'
            : undefined
        }
      >
        {isProjectedBalance ? '≈ ' : ''}
        {formatAmount(currentFormatter, numValue)}
      </span>
    );
  };

  // Inflow and outflow cells are identical apart from color, column id, and
  // which amount accessors they read. Rendered via a closure (not a nested
  // component) so CalculatorCell keeps its editing state across re-renders.
  const renderAmountCell = (kind: 'inflow' | 'outflow') => {
    const isInflow = kind === 'inflow';
    const getPrimary = isInflow ? getPrimaryInflow : getPrimaryOutflow;
    const getSecondary = isInflow ? getSecondaryInflow : getSecondaryOutflow;
    const colorClass = isInflow ? 'text-success' : 'text-destructive';
    const amount = isInflow ? transaction.Inflow : transaction.Outflow;
    const originalAmount = isInflow ? transaction.InflowOriginal : transaction.OutflowOriginal;

    return (
      <TableCell className="text-right font-mono text-xs">
        {isSplitCategory ? (
          // Split parents derive their amount from the sum of split lines, so the
          // value isn't independently editable (mirrors the mobile card, which
          // hides these cells for splits). Edit the amounts via "View splits".
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className={cn(
                  'px-2 py-1 font-medium cursor-help rounded-md hover:bg-muted/40',
                  colorClass
                )}
              >
                {formatAmount(currentFormatter, getPrimary(transaction) || 0)}
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-60 text-sm">
              <p>
                This is the total of the split lines. To change it, click{' '}
                <span className="font-medium">View splits</span>.
              </p>
            </PopoverContent>
          </Popover>
        ) : (
          <CalculatorCell
            value={asMilli(getPrimary(transaction) || 0)}
            onCommit={(val) => onCellCommit(transaction.ID, isInflow ? 'Inflow' : 'Outflow', val)}
            formatter={(val) => currentFormatter.format(val)}
            displayFormatter={(val) => currentFormatter.format(val)}
            localizer={currentFormatter}
            inputAlign="right"
            className={cn('text-right font-medium', colorClass)}
            displayClassName={colorClass}
            inputClassName="text-right"
            useFormatterForDisplay
          />
        )}
        {!hideSecondaryAmounts && (
          <SecondaryAmount
            amount={amount}
            originalAmount={originalAmount}
            value={getSecondary(transaction)}
            transactionCurrencyDisplay={transactionCurrencyDisplay}
            accountLocalizer={accountLocalizer}
            globalLocalizer={globalLocalizer}
            approxPrefix="~ "
          />
        )}
      </TableCell>
    );
  };

  // Projected recurring occurrences are read-only forecasts, not records:
  // every cell renders as plain text and the row can't be selected or edited.
  if (transaction.IsProjected) {
    const inflowValue = getPrimaryInflow(transaction) || 0;
    const outflowValue = getPrimaryOutflow(transaction) || 0;
    return (
      <TableRow className="bg-primary/[0.04]">
        <TableCell className="text-center">
          <div className="flex items-center justify-center">
            <Checkbox disabled aria-label="Projected transactions cannot be selected" />
          </div>
        </TableCell>
        <TableCell>
          <span className="px-2 text-xs xl:text-sm text-muted-foreground">{transaction.Date}</span>
        </TableCell>
        <TableCell className="max-w-[220px]">
          <span className="px-2 text-xs xl:text-sm">{transaction.Memo}</span>
        </TableCell>
        {!hideAccountColumn && (
          <TableCell className="max-w-[200px]">
            <span className="px-2 text-xs xl:text-sm">{transaction.Account}</span>
          </TableCell>
        )}
        <TableCell className="max-w-[200px]">
          <span className="px-2 text-xs xl:text-sm">{transaction.Payee}</span>
        </TableCell>
        <TableCell className="max-w-[180px]">
          <span className="px-2 text-xs text-muted-foreground">—</span>
        </TableCell>
        <TableCell className="max-w-[240px]">
          <span className="px-2 text-xs xl:text-sm">{transaction.Category}</span>
        </TableCell>
        <TableCell className="text-right font-mono text-xs">
          {inflowValue !== 0 && (
            <span className="px-2 py-1 font-medium text-success/80">
              {formatAmount(currentFormatter, inflowValue)}
            </span>
          )}
        </TableCell>
        <TableCell className="text-right font-mono text-xs">
          {outflowValue !== 0 && (
            <span className="px-2 py-1 font-medium text-destructive/80">
              {formatAmount(currentFormatter, outflowValue)}
            </span>
          )}
        </TableCell>
        {showExchangeRateColumn && <TableCell />}
        {showBalanceColumn && (
          <TableCell className="text-right font-mono text-xs">{renderBalanceCell()}</TableCell>
        )}
        <TableCell>
          <div className="flex items-center justify-center gap-2">
            <StatusIndicatorPopover status="projected" contentWidth="w-64" />
          </div>
        </TableCell>
      </TableRow>
    );
  }

  return (
    <TableRow
      className={cn(
        isRowPending && 'opacity-70',
        isSelected && 'bg-primary/5 data-[state=selected]:bg-primary/5'
      )}
    >
      {/* Checkbox */}
      <TableCell className="text-center">
        <div className="flex items-center justify-center">
          <Checkbox
            checked={isSelected}
            onPointerDown={onCheckboxPointerDown}
            onCheckedChange={(checked) => onCheckboxChange(checked === true)}
            aria-label={`Select transaction ${transaction.Memo || transaction.ID}`}
          />
        </div>
      </TableCell>

      {/* Date */}
      <TableCell>
        <DatePickerCell
          value={transaction.Date}
          onCommit={(newVal) => onCellCommit(transaction.ID, 'Date', newVal)}
        />
      </TableCell>

      {/* Memo */}
      <TableCell className="max-w-[220px]">
        <EditableCell
          value={transaction.Memo || ''}
          onCommit={(newVal) => onCellCommit(transaction.ID, 'Memo', newVal)}
          className="text-xs xl:text-sm"
          displayClassName="text-xs xl:text-sm"
          inputClassName="text-xs xl:text-sm"
        />
      </TableCell>

      {/* Account (optional) */}
      {!hideAccountColumn && (
        <TableCell className="max-w-[200px]">
          <div className="text-xs xl:text-sm">
            <AccountSelectCell
              accountName={transaction.Account}
              onCommit={(newVal) => onCellCommit(transaction.ID, 'AccountID', newVal)}
              triggerClassName="h-8 text-xs xl:text-sm px-2 truncate w-full"
            />
          </div>
        </TableCell>
      )}

      {/* Payee */}
      <TableCell className="max-w-[200px]">
        <div className="text-xs xl:text-sm">
          <PayeeSelectCell
            budgetId={budgetId}
            value={transaction.Payee ?? ''}
            onCommit={(newVal) => onCellCommit(transaction.ID, 'Payee', newVal)}
            triggerClassName="h-8 text-xs xl:text-sm px-2 truncate"
          />
        </div>
      </TableCell>

      {/* Label */}
      {showLabelColumn && (
        <TableCell className="max-w-[180px]">
          <div className="text-xs xl:text-sm">
            <LabelSelectCell
              budgetId={budgetId}
              value={transaction.LabelID ?? null}
              onCommit={(newVal) => onCellCommit(transaction.ID, 'LabelID', newVal)}
              triggerClassName="h-8 text-xs xl:text-sm px-2.5 truncate w-full rounded-full border-border/70 bg-muted/25 hover:bg-muted/45"
            />
          </div>
        </TableCell>
      )}

      {/* Category */}
      <TableCell className="max-w-[240px]">
        {isSplitCategory ? (
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">Split</Badge>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={(e) => {
                e.stopPropagation();
                onSplitView(transaction);
              }}
            >
              View splits
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <div className="flex-1 [&>div]:w-full text-xs xl:text-sm">
              <CategorySelectCell
                categoryID={transaction.CategoryID || 0}
                onCommit={(newVal) => onCellCommit(transaction.ID, 'CategoryID', newVal)}
                triggerClassName="h-8 w-full text-xs xl:text-sm px-2"
              />
            </div>
            {hasAmount && !isTransfer && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs shrink-0"
                onClick={(e) => {
                  e.stopPropagation();
                  onSplitCreate(transaction);
                }}
              >
                Split
              </Button>
            )}
          </div>
        )}
      </TableCell>

      {/* Inflow */}
      {renderAmountCell('inflow')}

      {/* Outflow */}
      {renderAmountCell('outflow')}

      {/* Exchange Rate (optional) */}
      {showExchangeRateColumn && (
        <TableCell className="text-right font-mono text-xs">
          <div className="flex items-center justify-end gap-1">
            {/* Rates are dimensionless decimals — edited outside the milliunit CalculatorCell */}
            <ExchangeRateCell
              value={transaction.ExchangeRate || 0}
              onCommit={(val) => onCellCommit(transaction.ID, 'ExchangeRate', val)}
              className="text-right text-muted-foreground"
              displayClassName="text-muted-foreground"
              inputClassName="h-8 text-right text-xs"
            />
            {!!transaction.ExchangeRateOverride && (
              <ArrowLeftRight className="h-3 w-3 text-primary shrink-0" />
            )}
          </div>
        </TableCell>
      )}

      {/* Balance (optional) */}
      {showBalanceColumn && (
        <TableCell className="text-right font-mono text-xs">{renderBalanceCell()}</TableCell>
      )}

      {/* Status */}
      <TableCell>
        <div className="flex items-center justify-center gap-2">
          {transaction.Reconciled == true && <StatusIndicatorPopover status="reconciled" />}
          {isFutureTransaction && <StatusIndicatorPopover status="future" />}
        </div>
      </TableCell>
    </TableRow>
  );
});
