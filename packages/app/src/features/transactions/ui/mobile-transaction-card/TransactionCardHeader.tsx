import React, { useMemo } from 'react';
import { Checkbox } from '@shared/ui/checkbox';
import { Badge } from '@shared/ui/badge';
import { Calendar as CalendarIcon, Tag } from 'lucide-react';
import type { GetTransactionsByAccountRow } from '@budgero/core/browser';
import { hexToRgba } from '@shared/lib/color/hex';
import { formatShortDate } from '@shared/lib/date-utils';
import { parseISO } from 'date-fns';
import { asMilli, formatMilli } from '@shared/lib/currency/milli';
import { StatusIndicatorPopover } from '@features/transactions/ui/StatusIndicatorPopover';

interface TransactionCardHeaderProps {
  transaction: GetTransactionsByAccountRow;
  isSelected: boolean;
  hideSelection?: boolean;
  isFutureTransaction?: boolean;
  displayCategoryOverride?: string;
  accountLocalizer: Intl.NumberFormat;
  onSelectionChange: (checked: boolean) => void;
}

export const TransactionCardHeader = React.memo(function TransactionCardHeader({
  transaction,
  isSelected,
  hideSelection = false,
  isFutureTransaction = false,
  displayCategoryOverride,
  accountLocalizer,
  onSelectionChange,
}: TransactionCardHeaderProps) {
  const displayDate = useMemo(() => {
    const rawDate = transaction.Date;
    if (!rawDate) return 'No date';
    const dateObj = parseISO(rawDate);
    if (isNaN(dateObj.getTime())) return 'No date';
    return formatShortDate(dateObj, { hideCurrentYear: true });
  }, [transaction]);

  const categoryDisplay = displayCategoryOverride || transaction.Category || '';
  const labelColor = transaction.LabelColor || '#9CA3AF';

  return (
    <div className="flex flex-1 items-center gap-2 min-w-0">
      {!hideSelection && (
        <div className="flex-shrink-0">
          <Checkbox
            checked={isSelected}
            onCheckedChange={onSelectionChange}
            aria-label={`Select transaction: ${transaction.Memo || 'No memo'} - ${formatMilli(accountLocalizer, asMilli(transaction.Inflow > 0 ? transaction.Inflow : transaction.Outflow))}`}
            className="rounded-full"
          />
        </div>
      )}

      <div className="flex-1 min-w-0">
        <div className="flex items-start gap-1.5">
          <CalendarIcon className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
          <div className="flex-1 min-w-0 max-w-[10rem] sm:max-w-[14rem] md:max-w-[18rem] min-[1900px]:max-w-[24rem] text-[11px] font-medium leading-tight text-current truncate sm:text-xs min-[1900px]:text-sm">
            {displayDate}
          </div>
          {transaction.Reconciled == true && (
            <StatusIndicatorPopover
              status="reconciled"
              buttonSize="h-6 w-6"
              iconSize="h-3.5 w-3.5"
              contentWidth="w-60"
            />
          )}
          {isFutureTransaction && (
            <StatusIndicatorPopover
              status="future"
              buttonSize="h-6 w-6"
              iconSize="h-3.5 w-3.5"
              contentWidth="w-64"
            />
          )}
        </div>
        <div className="text-xs text-muted-foreground truncate flex items-center gap-2 min-[1900px]:text-sm">
          <span className="inline-flex items-center gap-1 min-w-0 truncate">
            <Tag className="h-3 w-3" />
            <span className="truncate">{categoryDisplay}</span>
          </span>
          {transaction.Label && (
            <Badge
              variant="outline"
              className="h-5 rounded-full px-1.5 py-0 sm:px-2 max-w-[1.625rem] sm:max-w-[12rem] inline-flex items-center gap-1"
              style={{
                backgroundColor: hexToRgba(labelColor, 0.12),
                borderColor: hexToRgba(labelColor, 0.4),
              }}
              title={transaction.Label}
              aria-label={`Label: ${transaction.Label}`}
            >
              <span
                className="inline-block h-2 w-2 rounded-full border border-white/60 shrink-0"
                style={{ backgroundColor: labelColor }}
                aria-hidden
              />
              <span className="sr-only sm:hidden">{transaction.Label}</span>
              <span className="hidden sm:inline truncate">{transaction.Label}</span>
            </Badge>
          )}
        </div>
      </div>
    </div>
  );
});
