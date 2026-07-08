import { useMemo, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { format, addMonths, parseISO, differenceInCalendarDays } from 'date-fns';
import { CalendarClock, ArrowRight, AlertCircle, Repeat } from 'lucide-react';

import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from '@shared/ui/card';
import { Badge } from '@shared/ui/badge';
import { Button } from '@shared/ui/button';
import { EmptyStateRow } from '@shared/ui/EmptyStateRow';
import { DeleteTransactionDialog } from '@features/transactions/ui/DeleteTransactionDialog';
import { TransactionQuickViewDialog } from '@features/transactions/ui/TransactionQuickViewDialog';
import { useRecurringOccurrences } from '@entities/recurring/api/useRecurringTransactions';
import { useAllTransactionsDetailed } from '@entities/transaction/api/queries';
import { useDeleteTransaction } from '@entities/transaction/api/mutations';
import { type TransactionColumnName as DbTransactionColumn } from '@entities/transaction/api/mutations';
import { useTransactionCellCommit } from '@features/transactions/api/useTransactionCellCommit';
import { useAccounts } from '@entities/account/api/useAccounts';
import type { GetTransactionsByAccountRow } from '@budgero/core/browser';
import { useUiStore } from '@shared/store/useUiStore';
import { formatMaskedMilli } from '@shared/lib/privacy/mask-numbers';

type UpcomingTransactionsCardProps = {
  budgetId: number;
  globalLocalizer: Intl.NumberFormat;
};

// Occurrences are materialized 6 months ahead (recurring service horizon);
// fetching that far guarantees we see each template's next occurrence.
const RECURRING_LOOKAHEAD_MONTHS = 6;
const ONE_OFF_LOOKAHEAD_MONTHS = 3;
const MAX_ITEMS = 6;

type UpcomingItem = {
  key: string;
  name: string;
  date: Date;
  amount: number;
  isOutflow: boolean;
  accountId: number | null;
  accountName: string;
  memo: string | null;
  isRecurring: boolean;
  badgeLabel: string;
  badgeVariant: 'secondary' | 'outline';
  /** Present for one-off items; opens the quick-edit dialog. */
  row: GetTransactionsByAccountRow | null;
};

const getPrimaryInflow = (tx: GetTransactionsByAccountRow) => tx.Inflow || 0;
const getPrimaryOutflow = (tx: GetTransactionsByAccountRow) => tx.Outflow || 0;
const getSecondaryInflow = (tx: GetTransactionsByAccountRow) => tx.InflowOriginal ?? tx.Inflow ?? 0;
const getSecondaryOutflow = (tx: GetTransactionsByAccountRow) =>
  tx.OutflowOriginal ?? tx.Outflow ?? 0;

export function UpcomingTransactionsCard({
  budgetId,
  globalLocalizer,
}: UpcomingTransactionsCardProps) {
  const navigate = useNavigate();
  const privacyMaskNumbers = useUiStore((state) => state.privacyMaskNumbers);
  const today = useMemo(() => new Date(), []);
  const fromDate = format(today, 'yyyy-MM-dd');
  const recurringToDate = format(addMonths(today, RECURRING_LOOKAHEAD_MONTHS), 'yyyy-MM-dd');
  const oneOffHorizon = useMemo(() => addMonths(today, ONE_OFF_LOOKAHEAD_MONTHS), [today]);

  const { data: accounts = [] } = useAccounts(budgetId);
  const { data: occurrences = [], isLoading: occurrencesLoading } = useRecurringOccurrences(
    budgetId,
    {
      status: ['scheduled', 'ready'],
      fromDate,
      toDate: recurringToDate,
    }
  );
  const { data: transactions = [], isLoading: transactionsLoading } =
    useAllTransactionsDetailed(budgetId);

  const accountById = useMemo(() => {
    return new Map(accounts.map((account) => [account.ID, account.Name]));
  }, [accounts]);
  const accountIdByName = useMemo(() => {
    return new Map(accounts.map((account) => [account.Name, account.ID]));
  }, [accounts]);

  // Quick-edit dialog state for one-off scheduled transactions
  const [quickViewTx, setQuickViewTx] = useState<GetTransactionsByAccountRow | null>(null);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const cellCommit = useTransactionCellCommit();
  const deleteTransaction = useDeleteTransaction();

  const resolveAccountId = useCallback(
    (tx: GetTransactionsByAccountRow) => accountIdByName.get(tx.Account ?? '') ?? 0,
    [accountIdByName]
  );

  const handleQuickCommit = useCallback(
    (transactionId: number, columnId: string, newVal: string | number | Date | null) => {
      if (!quickViewTx) return;
      const patch = cellCommit.mutate(transactionId, columnId as DbTransactionColumn, newVal, {
        accountId: resolveAccountId(quickViewTx),
      });
      if (!patch) return;
      setQuickViewTx((prev) => (prev ? { ...prev, ...patch } : prev));
    },
    [quickViewTx, cellCommit, resolveAccountId]
  );

  const handleDeleteTx = useCallback(async () => {
    if (!quickViewTx) return;
    await deleteTransaction.mutateAsync({
      transactionId: quickViewTx.ID,
      accountId: resolveAccountId(quickViewTx),
    });
    setConfirmDeleteOpen(false);
    setQuickViewTx(null);
  }, [quickViewTx, deleteTransaction, resolveAccountId]);

  const handleItemClick = useCallback(
    (item: UpcomingItem) => {
      if (item.row) {
        setQuickViewTx(item.row);
        return;
      }
      if (item.accountId) {
        void navigate(`/accounts/${item.accountId}`);
      }
    },
    [navigate]
  );

  const upcoming = useMemo(() => {
    // Recurring: only the next occurrence of each template.
    const nextPerTemplate = new Map<number, (typeof occurrences)[number]>();
    for (const occurrence of [...occurrences].sort((a, b) => (a.dueDate > b.dueDate ? 1 : -1))) {
      if (!occurrence?.dueDate) continue;
      if (differenceInCalendarDays(parseISO(occurrence.dueDate), today) < 0) continue;
      if (!nextPerTemplate.has(occurrence.recurringTransactionId)) {
        nextPerTemplate.set(occurrence.recurringTransactionId, occurrence);
      }
    }

    // Transactions already created by a recurring occurrence ("ready" posts
    // a real future-dated transaction) must not show up twice.
    const occurrenceTransactionIds = new Set(
      occurrences.map((occurrence) => occurrence.transactionId).filter((id) => id !== null)
    );

    const recurringItems: UpcomingItem[] = Array.from(nextPerTemplate.values()).map(
      (occurrence) => {
        const { template } = occurrence;
        return {
          key: `occurrence-${occurrence.id}`,
          name: template.name,
          date: parseISO(occurrence.dueDate),
          amount: Math.abs(template.amount),
          isOutflow: template.direction === 'outflow',
          accountId: template.accountId,
          accountName: accountById.get(template.accountId) ?? 'Unknown account',
          memo: template.memo || null,
          isRecurring: true,
          badgeLabel: occurrence.status === 'ready' ? 'Ready to post' : 'Recurring',
          badgeVariant: occurrence.status === 'ready' ? 'secondary' : 'outline',
          row: null,
        };
      }
    );

    // One-off: future-dated transactions the user entered manually.
    const oneOffItems: UpcomingItem[] = transactions
      .filter((tx) => {
        if (!tx.Date) return false;
        if (occurrenceTransactionIds.has(tx.ID)) return false;
        const txDate = parseISO(tx.Date);
        return differenceInCalendarDays(txDate, today) > 0 && txDate <= oneOffHorizon;
      })
      // Transfers create two future rows; show only the outflow leg.
      .filter((tx) => !tx.TransferID || (tx.Outflow ?? 0) > 0)
      .map((tx) => {
        const isOutflow = (tx.Outflow ?? 0) > 0;
        return {
          key: `transaction-${tx.ID}`,
          name: tx.Payee || tx.Memo || tx.Category || 'Scheduled transaction',
          date: parseISO(tx.Date),
          amount: Math.abs(isOutflow ? (tx.Outflow ?? 0) : (tx.Inflow ?? 0)),
          isOutflow,
          accountId: accountIdByName.get(tx.Account ?? '') ?? null,
          accountName: tx.Account ?? 'Unknown account',
          memo: tx.Payee && tx.Memo ? tx.Memo : null,
          isRecurring: false,
          badgeLabel: 'Scheduled',
          badgeVariant: 'outline' as const,
          row: tx,
        };
      });

    return [...recurringItems, ...oneOffItems]
      .sort((a, b) => a.date.getTime() - b.date.getTime())
      .slice(0, MAX_ITEMS);
  }, [occurrences, transactions, accountById, accountIdByName, today, oneOffHorizon]);

  const isLoading = occurrencesLoading || transactionsLoading;

  const renderItem = (item: UpcomingItem) => {
    const formattedAmount = formatMaskedMilli(globalLocalizer, item.amount, privacyMaskNumbers);
    const daysUntil = differenceInCalendarDays(item.date, today);
    const accentClass = item.isOutflow ? 'text-red-600 dark:text-red-300' : 'text-green-600';
    const Icon = item.isRecurring ? Repeat : CalendarClock;

    return (
      <li key={item.key}>
        <button
          type="button"
          onClick={() => handleItemClick(item)}
          className="w-full rounded-xl border border-border/60 bg-muted/20 px-3 py-2.5 text-left transition-colors hover:border-border hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                <Icon className="h-4 w-4 text-muted-foreground" />
                <span className="truncate">{item.name}</span>
              </div>
              <div className="text-xs text-muted-foreground">
                {format(item.date, 'EEE, MMM d')} • {item.accountName}
              </div>
              {item.memo ? (
                <div className="text-xs text-muted-foreground/80 line-clamp-1">{item.memo}</div>
              ) : null}
            </div>
            <div className="flex flex-col items-end gap-1">
              <span className={`text-sm font-semibold ${accentClass}`}>
                {item.isOutflow ? '−' : '+'}
                {formattedAmount}
              </span>
              <Badge variant={item.badgeVariant}>{item.badgeLabel}</Badge>
              <span className="text-[11px] text-muted-foreground">
                {daysUntil <= 0
                  ? 'Due today'
                  : `Due in ${daysUntil} day${daysUntil === 1 ? '' : 's'}`}
              </span>
            </div>
          </div>
        </button>
      </li>
    );
  };

  return (
    <Card className="h-full">
      <CardHeader className="pb-1">
        <CardTitle className="flex items-center gap-2 text-base font-semibold">
          <CalendarClock className="h-5 w-5 text-muted-foreground" />
          Upcoming transactions
        </CardTitle>
        <CardDescription className="text-xs">
          Next charge for each recurring series, plus scheduled transactions in the next{' '}
          {ONE_OFF_LOOKAHEAD_MONTHS} months.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <div className="space-y-2 text-sm text-muted-foreground">
            <div className="h-16 animate-pulse rounded-xl bg-muted/40" />
            <div className="h-16 animate-pulse rounded-xl bg-muted/40" />
          </div>
        ) : upcoming.length > 0 ? (
          <ul className="space-y-2">{upcoming.map(renderItem)}</ul>
        ) : (
          <EmptyStateRow icon={AlertCircle}>
            Nothing upcoming. Recurring charges and transactions dated in the next{' '}
            {ONE_OFF_LOOKAHEAD_MONTHS} months appear here.
          </EmptyStateRow>
        )}
      </CardContent>
      <CardFooter className="pt-0">
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto gap-2"
          onClick={() => navigate('/settings/recurring')}
        >
          Manage automations
          <ArrowRight className="h-4 w-4" />
        </Button>
      </CardFooter>

      {/* Quick-edit dialog for one-off scheduled transactions */}
      <TransactionQuickViewDialog
        open={quickViewTx !== null}
        onOpenChange={(open) => {
          if (!open) setQuickViewTx(null);
        }}
        transaction={quickViewTx}
        budgetId={budgetId}
        globalLocalizer={globalLocalizer}
        scrollable
        srTitle="Edit scheduled transaction"
        hideSecondaryAmounts
        forceLoadSplits
        getPrimaryInflow={getPrimaryInflow}
        getPrimaryOutflow={getPrimaryOutflow}
        getSecondaryInflow={getSecondaryInflow}
        getSecondaryOutflow={getSecondaryOutflow}
        onCellCommit={handleQuickCommit}
        isPending={cellCommit.isPending}
        pendingId={cellCommit.pendingId}
        onDeleteClick={() => setConfirmDeleteOpen(true)}
        deleteDisabled={deleteTransaction.isPending}
      />

      <DeleteTransactionDialog
        open={confirmDeleteOpen}
        onOpenChange={(open) => {
          if (!open) setConfirmDeleteOpen(false);
        }}
        onConfirm={handleDeleteTx}
        isPending={deleteTransaction.isPending}
      />
    </Card>
  );
}
