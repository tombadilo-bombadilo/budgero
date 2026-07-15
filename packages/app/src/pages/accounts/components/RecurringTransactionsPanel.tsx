import React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@shared/ui/card';
import { Button } from '@shared/ui/button';
import { Badge } from '@shared/ui/badge';
import {
  CalendarClock,
  ChevronDown,
  Check,
  Clock,
  Tag,
  CalendarDays,
  Loader2,
  Repeat,
} from 'lucide-react';
import { format, formatDistanceToNow, parseISO } from 'date-fns';
import { cn } from '@shared/lib/utils';
import { getTodayISO } from '@shared/lib/date-utils';
import { asMilli, formatMilli } from '@shared/lib/currency/milli';
import type { GetTransactionsByAccountRow } from '@budgero/core/browser';

export interface RecurringOccurrence {
  id: number;
  dueDate: string;
  status: string;
  template: {
    name: string;
    amount: number;
    direction: 'inflow' | 'outflow';
    categoryId: number | null;
    accountId: number;
    toAccountId: number | null;
    destinationAmount?: number | null;
  };
}

export interface UpcomingScheduledTransaction {
  transaction: GetTransactionsByAccountRow;
  parsedDate: Date | null;
}

export interface RecurringTransactionsPanelProps {
  isLoading: boolean;
  isFetching: boolean;
  /** Account whose page hosts the panel — decides which way transfers flow. */
  accountId: number;
  upcomingRecurringOccurrences: RecurringOccurrence[];
  upcomingScheduledTransactions: UpcomingScheduledTransaction[];
  categoriesById: Map<number, string>;
  formatter: { format: (value: number) => string };
  transactionCurrencyDisplay: 'budget' | 'account';
  processingOccurrenceId: number | null;
  isMarkReadyPending: boolean;
  isSkipPending: boolean;
  onOccurrenceAction: (occurrenceId: number, action: 'ready' | 'skip') => void;
}

const EXPANDED_STORAGE_KEY = 'account-upcoming-panel-expanded';
const MAX_VISIBLE_ITEMS = 4;

/**
 * Panel displaying upcoming recurring transactions and scheduled entries.
 * Collapsed by default — the header shows the count and summed flows; the
 * expanded state persists across visits.
 */
export const RecurringTransactionsPanel = React.memo(function RecurringTransactionsPanel({
  isLoading,
  isFetching,
  accountId,
  upcomingRecurringOccurrences,
  upcomingScheduledTransactions,
  categoriesById,
  formatter,
  transactionCurrencyDisplay,
  processingOccurrenceId,
  isMarkReadyPending,
  isSkipPending,
  onOccurrenceAction,
}: RecurringTransactionsPanelProps) {
  const [isExpanded, setIsExpanded] = React.useState(() => {
    try {
      return localStorage.getItem(EXPANDED_STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });

  const toggleExpanded = React.useCallback(() => {
    setIsExpanded((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(EXPANDED_STORAGE_KEY, String(next));
      } catch {
        // Ignore storage errors
      }
      return next;
    });
  }, []);

  const showSkeleton =
    isLoading &&
    upcomingRecurringOccurrences.length === 0 &&
    upcomingScheduledTransactions.length === 0;

  const hasNoContent =
    !showSkeleton &&
    upcomingRecurringOccurrences.length === 0 &&
    upcomingScheduledTransactions.length === 0;

  const upcomingCount = upcomingRecurringOccurrences.length + upcomingScheduledTransactions.length;

  // A transfer occurrence is an outflow on its source account and an inflow
  // on its destination account — same as the two legs of a posted transfer.
  const isOccurrenceOutflow = React.useCallback(
    (template: RecurringOccurrence['template']) =>
      template.toAccountId === accountId ? false : template.direction === 'outflow',
    [accountId]
  );

  // On the destination side of a transfer, show the amount in this account's
  // currency (converted at the latest known rate by the occurrence query).
  const occurrenceAmount = React.useCallback(
    (template: RecurringOccurrence['template']) =>
      template.toAccountId === accountId
        ? (template.destinationAmount ?? template.amount)
        : template.amount,
    [accountId]
  );

  const totals = React.useMemo(() => {
    let inflow = 0;
    let outflow = 0;
    for (const occurrence of upcomingRecurringOccurrences) {
      if (isOccurrenceOutflow(occurrence.template)) {
        outflow += occurrenceAmount(occurrence.template);
      } else {
        inflow += occurrenceAmount(occurrence.template);
      }
    }
    for (const { transaction } of upcomingScheduledTransactions) {
      const inflowValue =
        transactionCurrencyDisplay === 'budget'
          ? transaction.Inflow
          : (transaction.InflowOriginal ?? transaction.Inflow);
      const outflowValue =
        transactionCurrencyDisplay === 'budget'
          ? transaction.Outflow
          : (transaction.OutflowOriginal ?? transaction.Outflow);
      inflow += inflowValue ?? 0;
      outflow += outflowValue ?? 0;
    }
    return { inflow, outflow };
  }, [
    upcomingRecurringOccurrences,
    upcomingScheduledTransactions,
    transactionCurrencyDisplay,
    isOccurrenceOutflow,
    occurrenceAmount,
  ]);

  const todayKey = getTodayISO();
  const visibleOccurrences = upcomingRecurringOccurrences.slice(0, MAX_VISIBLE_ITEMS);
  const visibleScheduled = upcomingScheduledTransactions.slice(0, MAX_VISIBLE_ITEMS);

  return (
    <Card className="border-primary/20 bg-primary/5">
      <CardHeader
        className="cursor-pointer select-none"
        role="button"
        aria-expanded={isExpanded}
        onClick={toggleExpanded}
      >
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex min-w-0 items-center gap-2 text-sm md:text-base">
            <CalendarClock className="h-4 w-4 shrink-0 text-primary" />
            <span className="truncate">Upcoming transactions</span>
            {!showSkeleton && upcomingCount > 0 && (
              <Badge variant="secondary" className="shrink-0 tabular-nums">
                {upcomingCount}
              </Badge>
            )}
          </CardTitle>
          <div className="flex shrink-0 items-center gap-3">
            {!showSkeleton && upcomingCount > 0 && (
              <span className="text-xs font-medium tabular-nums whitespace-nowrap">
                {totals.inflow > 0 && (
                  <span className="text-success">
                    +{formatMilli(formatter, asMilli(totals.inflow))}
                  </span>
                )}
                {totals.inflow > 0 && totals.outflow > 0 && (
                  <span className="text-muted-foreground"> / </span>
                )}
                {totals.outflow > 0 && (
                  <span className="text-destructive">
                    -{formatMilli(formatter, asMilli(totals.outflow))}
                  </span>
                )}
              </span>
            )}
            <ChevronDown
              className={cn(
                'h-4 w-4 text-muted-foreground transition-transform',
                isExpanded && 'rotate-180'
              )}
            />
          </div>
        </div>
        {isExpanded && (
          <CardDescription>
            Automations and scheduled entries that land soon are listed here. Mark recurring items
            ready when you are prepared to post them.
          </CardDescription>
        )}
      </CardHeader>
      {isExpanded && (
        <CardContent className="space-y-4">
          {showSkeleton && (
            <div className="space-y-3">
              {Array.from({ length: 2 }).map((_, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between rounded-lg border border-dashed border-primary/20 bg-background/80 px-3 py-3"
                >
                  <div className="space-y-2">
                    <div className="h-4 w-40 rounded bg-muted animate-pulse" />
                    <div className="h-3 w-24 rounded bg-muted animate-pulse" />
                  </div>
                  <div className="h-8 w-28 rounded bg-muted animate-pulse" />
                </div>
              ))}
            </div>
          )}

          {visibleOccurrences.length > 0 && (
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                From automations
              </p>
              {visibleOccurrences.map((occurrence) => {
                const { template } = occurrence;
                const categoryName = template.categoryId
                  ? categoriesById.get(template.categoryId) || 'Unassigned category'
                  : 'Unassigned category';
                const isOutflow = isOccurrenceOutflow(template);
                const amountLabel = `${isOutflow ? '-' : '+'}${formatMilli(
                  formatter,
                  asMilli(occurrenceAmount(template))
                )}`;
                const dueDate = parseISO(occurrence.dueDate);
                const dueLabel = formatDistanceToNow(dueDate, { addSuffix: true });
                const isOverdue = occurrence.dueDate < todayKey;
                const busy = processingOccurrenceId === occurrence.id;

                return (
                  <div
                    key={occurrence.id}
                    className="flex flex-col gap-3 rounded-lg border border-primary/20 bg-background/90 px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                        <Repeat className="h-3.5 w-3.5 text-primary" />
                        <span>{template.name}</span>
                        <Badge variant="secondary" className="text-[10px] uppercase tracking-wide">
                          Recurring
                        </Badge>
                        {isOverdue && (
                          <Badge
                            variant="destructive"
                            className="text-[10px] uppercase tracking-wide"
                          >
                            Overdue
                          </Badge>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          <Clock className="h-3 w-3" /> Due {occurrence.dueDate} ({dueLabel})
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <Tag className="h-3 w-3" /> {categoryName}
                        </span>
                        <span className="inline-flex items-center gap-1 font-semibold text-foreground">
                          {amountLabel}
                        </span>
                      </div>
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <Button
                        size="sm"
                        disabled={busy || isMarkReadyPending || isFetching}
                        onClick={(e) => {
                          e.stopPropagation();
                          onOccurrenceAction(occurrence.id, 'ready');
                        }}
                      >
                        {busy && isMarkReadyPending ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <Check className="mr-2 h-4 w-4" />
                        )}
                        Mark ready
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-muted-foreground hover:text-foreground"
                        disabled={busy || isSkipPending || isFetching}
                        onClick={(e) => {
                          e.stopPropagation();
                          onOccurrenceAction(occurrence.id, 'skip');
                        }}
                      >
                        Skip this time
                      </Button>
                    </div>
                  </div>
                );
              })}
              {upcomingRecurringOccurrences.length > MAX_VISIBLE_ITEMS && (
                <p className="text-xs text-muted-foreground">
                  +{upcomingRecurringOccurrences.length - MAX_VISIBLE_ITEMS} more in the next month
                </p>
              )}
            </div>
          )}

          {visibleScheduled.length > 0 && (
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Scheduled entries
              </p>
              {visibleScheduled.map(({ transaction, parsedDate }) => {
                if (!parsedDate) return null;
                const payeeName =
                  transaction.Payee || transaction.Memo || `Transaction ${transaction.ID}`;
                const memoNote =
                  transaction.Memo &&
                  transaction.Memo.trim().length > 0 &&
                  transaction.Memo.trim() !== payeeName
                    ? transaction.Memo
                    : null;
                const categoryName =
                  transaction.Category ||
                  (transaction.CategoryID
                    ? categoriesById.get(transaction.CategoryID) || 'Unassigned category'
                    : 'Unassigned category');
                const inflowValue =
                  transactionCurrencyDisplay === 'budget'
                    ? transaction.Inflow
                    : (transaction.InflowOriginal ?? transaction.Inflow);
                const outflowValue =
                  transactionCurrencyDisplay === 'budget'
                    ? transaction.Outflow
                    : (transaction.OutflowOriginal ?? transaction.Outflow);
                const isOutflow =
                  (outflowValue ?? 0) > 0 && (outflowValue ?? 0) >= Math.abs(inflowValue ?? 0);
                const amountValue = isOutflow ? outflowValue : inflowValue;
                const amountLabel = `${isOutflow ? '-' : '+'}${formatMilli(
                  formatter,
                  asMilli(Math.abs(amountValue || 0))
                )}`;
                const dueLabel = formatDistanceToNow(parsedDate, { addSuffix: true });

                return (
                  <div
                    key={`scheduled-${transaction.ID}`}
                    className="flex flex-col gap-3 rounded-lg border border-border/60 bg-background/90 px-3 py-3"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                        <CalendarDays className="h-3.5 w-3.5 text-primary" />
                        <span>{payeeName}</span>
                        <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
                          Scheduled
                        </Badge>
                      </div>
                      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          <Clock className="h-3 w-3" /> Scheduled {format(parsedDate, 'yyyy-MM-dd')}{' '}
                          ({dueLabel})
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <Tag className="h-3 w-3" /> {categoryName}
                        </span>
                        <span className="inline-flex items-center gap-1 font-semibold text-foreground">
                          {amountLabel}
                        </span>
                      </div>
                      {memoNote && (
                        <div className="text-xs text-muted-foreground/80">{memoNote}</div>
                      )}
                    </div>
                  </div>
                );
              })}
              {upcomingScheduledTransactions.length > MAX_VISIBLE_ITEMS && (
                <p className="text-xs text-muted-foreground">
                  +{upcomingScheduledTransactions.length - MAX_VISIBLE_ITEMS} more scheduled
                </p>
              )}
            </div>
          )}

          {hasNoContent && (
            <div className="text-sm text-muted-foreground">
              All set - nothing scheduled for this account right now.
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
});
