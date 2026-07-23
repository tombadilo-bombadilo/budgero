import { useMemo, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { Popover, PopoverContent, PopoverTrigger } from '@shared/ui/popover';
import { Skeleton } from '@shared/ui/skeleton';
import { cn } from '@shared/lib/utils';
import { useTransactionsByCategoryAndRange } from '@entities/transaction/api/useTransactions';
import { formatMaskedMilli } from '@shared/lib/privacy/mask-numbers';

interface CategoryTransactionCellProps {
  /** Integer milliunits. */
  value: number;
  categoryId: number | null;
  categoryName: string;
  budgetId: number;
  startDate: string;
  endDate: string;
  accountIds: number[];
  globalLocalizer: Intl.NumberFormat;
  privacyMaskNumbers: boolean;
  label: string;
  disabled?: boolean;
  tdClassName?: string;
}

/** One pivot-table cell: an amount that pops over its underlying transactions on click. */
export function CategoryTransactionCell({
  value,
  categoryId,
  categoryName,
  budgetId,
  startDate,
  endDate,
  accountIds,
  globalLocalizer,
  privacyMaskNumbers,
  label,
  disabled,
  tdClassName,
}: CategoryTransactionCellProps) {
  const [open, setOpen] = useState(false);
  const canQuery = Boolean(startDate) && Boolean(endDate) && !disabled && value !== 0;
  const { data = [], isLoading } = useTransactionsByCategoryAndRange(
    budgetId,
    categoryId,
    startDate,
    endDate,
    accountIds,
    open && canQuery
  );

  const amountClass =
    value === 0 ? 'text-muted-foreground' : value < 0 ? 'text-rose-500' : 'text-emerald-600';

  const rangeLabel = useMemo(() => {
    if (!startDate || !endDate) return '';
    try {
      const start = parseISO(startDate);
      const end = parseISO(endDate);
      return `${format(start, 'MMM d, yyyy')} – ${format(end, 'MMM d, yyyy')}`;
    } catch {
      return '';
    }
  }, [startDate, endDate]);

  return (
    <td className={cn('whitespace-nowrap px-3 py-2 text-right', tdClassName)}>
      <Popover open={open} onOpenChange={(next) => setOpen(canQuery ? next : false)}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn(
              'flex w-full justify-end text-xs leading-tight whitespace-nowrap transition hover:underline',
              amountClass,
              (!canQuery || isLoading) && 'cursor-default hover:no-underline'
            )}
            disabled={!canQuery || isLoading}
          >
            {formatMaskedMilli(globalLocalizer, value, privacyMaskNumbers)}
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-[320px] space-y-3 p-3" align="end" sideOffset={8}>
          <div className="space-y-1">
            <div className="text-sm font-semibold">{categoryName}</div>
            <div className="text-xs text-muted-foreground">{label}</div>
            {rangeLabel ? <div className="text-xs text-muted-foreground">{rangeLabel}</div> : null}
          </div>
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          ) : data.length === 0 ? (
            <div className="text-xs text-muted-foreground">No transactions for this selection.</div>
          ) : (
            <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
              {data.map((transaction) => {
                const net = (transaction.Inflow ?? 0) - (transaction.Outflow ?? 0);
                const netLabel = formatMaskedMilli(globalLocalizer, net, privacyMaskNumbers);
                const netClass = net < 0 ? 'text-rose-600' : 'text-emerald-600';
                return (
                  <div
                    key={`${transaction.ID}-${transaction.Date}`}
                    className="rounded-md border border-border/60 bg-muted/20 p-2"
                  >
                    <div className="flex items-center justify-between gap-2 text-xs font-medium">
                      <span>{format(parseISO(transaction.Date), 'MMM d, yyyy')}</span>
                      <span className={cn('font-semibold', netClass)}>{netLabel}</span>
                    </div>
                    <div className="mt-1 flex flex-col gap-1 text-[11px] text-muted-foreground">
                      <span className="truncate font-medium text-foreground">
                        {transaction.Account}
                      </span>
                      {transaction.Memo ? (
                        <span className="truncate">{transaction.Memo}</span>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </PopoverContent>
      </Popover>
    </td>
  );
}
