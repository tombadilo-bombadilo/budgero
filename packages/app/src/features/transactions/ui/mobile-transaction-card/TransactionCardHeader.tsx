import { useLingui } from '@lingui/react/macro';
import React, { useMemo } from 'react';
import { TransactionSelectionCheckbox } from '@features/transactions/ui/TransactionSelectionCheckbox';
import { Calendar as CalendarIcon, Tag } from 'lucide-react';
import type { GetTransactionsByAccountRow } from '@budgero/core/browser';
import { formatShortDate } from '@shared/lib/date-utils';
import { parseISO } from 'date-fns';
import { asMilli, formatMilli } from '@shared/lib/currency/milli';
import { StatusIndicatorPopover } from '@features/transactions/ui/StatusIndicatorPopover';
import { ClearedToggle } from '@features/transactions/ui/ClearedToggle';
import { TransactionLabelBadge } from '@features/transactions/ui/TransactionLabelBadge';
import { splitPayeesLabel, transferPayeeLabel } from '@features/transactions/lib/transfer-category';
import { useRegisterDisplay } from '@shared/contexts/RegisterDisplayContext';

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
  const { t } = useLingui();
  const { showTime } = useRegisterDisplay();

  const displayDate = useMemo(() => {
    const rawDate = transaction.Date;
    if (!rawDate) return t`No date`;
    const dateObj = parseISO(rawDate);
    if (isNaN(dateObj.getTime())) return t`No date`;
    return formatShortDate(dateObj, { hideCurrentYear: true });
  }, [transaction, t]);

  const categoryDisplay = displayCategoryOverride || transaction.Category || '';
  // A transfer's other account, or a split's line payees, when it has no payee.
  const transferLabel = transferPayeeLabel(transaction) ?? splitPayeesLabel(transaction);
  return (
    <div className="flex flex-1 items-center gap-2 min-w-0">
      {!hideSelection && (
        <div className="flex-shrink-0">
          <TransactionSelectionCheckbox
            checked={isSelected}
            onCheckedChange={onSelectionChange}
            aria-label={t`Select transaction: ${transaction.Memo || 'No memo'} - ${formatMilli(accountLocalizer, asMilli(transaction.InflowConverted > 0 ? transaction.InflowConverted : transaction.OutflowConverted))}`}
            className="rounded-full"
          />
        </div>
      )}

      <div className="flex-1 min-w-0">
        <div className="flex items-start gap-1.5">
          <CalendarIcon className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
          <div className="flex-1 min-w-0 max-w-[10rem] sm:max-w-[14rem] md:max-w-[18rem] min-[1900px]:max-w-[24rem] text-[0.6875rem] font-medium leading-tight text-current truncate sm:text-xs min-[1900px]:text-sm">
            {displayDate}
            {showTime && transaction.Time ? (
              <span className="ml-1 text-muted-foreground">{transaction.Time}</span>
            ) : null}
          </div>
          {transaction.Reconciled == true ? (
            <StatusIndicatorPopover
              status="reconciled"
              buttonSize="h-6 w-6"
              iconSize="h-3.5 w-3.5"
              contentWidth="w-60"
            />
          ) : (
            transaction.Cleared !== undefined && (
              <ClearedToggle
                transactionId={transaction.ID}
                cleared={Boolean(transaction.Cleared)}
                size="h-6 w-6"
                iconSize="h-3.5 w-3.5"
              />
            )
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
          {transferLabel && <span className="truncate">{transferLabel}</span>}
          {transaction.Label && (
            <TransactionLabelBadge
              label={transaction.Label}
              color={transaction.LabelColor}
              className="max-w-[1.625rem] sm:max-w-[12rem]"
              hideTextOnSmallScreens
            />
          )}
        </div>
      </div>
    </div>
  );
});
