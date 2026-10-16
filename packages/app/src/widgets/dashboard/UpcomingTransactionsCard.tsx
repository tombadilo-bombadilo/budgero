import { plural } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import { useMemo, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { addMonths, parseISO, differenceInCalendarDays } from 'date-fns';
import { formatDate as format } from '@shared/lib/date-format';
import { CalendarClock, ArrowRight, AlertCircle, RefreshCw } from 'lucide-react';

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
import { Tooltip, TooltipContent, TooltipTrigger } from '@shared/ui/tooltip';
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
import { buildCurrencyLocalizer, useUiStore } from '@shared/store/useUiStore';
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
  budgetAmount: number | null;
  isOutflow: boolean;
  accountId: number | null;
  accountName: string;
  accountCurrency: string | null;
  memo: string | null;
  isRecurring: boolean;
  badgeLabel: string;
  badgeVariant: 'secondary' | 'outline';
  /** Present for one-off items; opens the quick-edit dialog. */
  row: GetTransactionsByAccountRow | null;
};

const getPrimaryInflow = (tx: GetTransactionsByAccountRow) => tx.InflowConverted || 0;
const getPrimaryOutflow = (tx: GetTransactionsByAccountRow) => tx.OutflowConverted || 0;
const getSecondaryInflow = (tx: GetTransactionsByAccountRow) =>
  tx.InflowNative ?? tx.InflowConverted ?? 0;
const getSecondaryOutflow = (tx: GetTransactionsByAccountRow) =>
  tx.OutflowNative ?? tx.OutflowConverted ?? 0;

export function UpcomingTransactionsCard({
  budgetId,
  globalLocalizer,
}: UpcomingTransactionsCardProps) {
  const { t } = useLingui();

  const navigate = useNavigate();
  const privacyMaskNumbers = useUiStore((state) => state.privacyMaskNumbers);
  const selectedBudget = useUiStore((state) => state.selectedBudget);
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
  // Only future-dated rows can be upcoming; the filter below still applies the horizon.
  const { data: transactions = [], isLoading: transactionsLoading } = useAllTransactionsDetailed(
    budgetId,
    { afterDate: fromDate }
  );

  const accountById = useMemo(() => {
    return new Map(accounts.map((account) => [account.ID, account.Name]));
  }, [accounts]);
  const accountByIdMap = useMemo(() => {
    return new Map(accounts.map((account) => [account.ID, account]));
  }, [accounts]);
  const accountLocalizersById = useMemo(() => {
    const map = new Map<number, Intl.NumberFormat>();
    for (const account of accounts) {
      const localizer = buildCurrencyLocalizer(
        account.Currency,
        selectedBudget?.NumberFormat ?? ''
      );
      if (localizer) map.set(account.ID, localizer);
    }
    return map;
  }, [accounts, selectedBudget?.NumberFormat]);
  const accountIdByName = useMemo(() => {
    return new Map(accounts.map((account) => [account.Name, account.ID]));
  }, [accounts]);
  const budgetCurrency =
    selectedBudget?.DisplayCurrency ?? globalLocalizer.resolvedOptions().currency;

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
          budgetAmount: template.budgetAmount != null ? Math.abs(template.budgetAmount) : null,
          isOutflow: template.direction === 'outflow',
          accountId: template.accountId,
          accountName: accountById.get(template.accountId) ?? 'Unknown account',
          accountCurrency: accountByIdMap.get(template.accountId)?.Currency ?? null,
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
      .filter((tx) => !tx.TransferID || (tx.OutflowConverted ?? 0) > 0)
      .map((tx) => {
        const isOutflow = (tx.OutflowConverted ?? 0) > 0;
        const accountId = tx.AccountID ?? accountIdByName.get(tx.Account ?? '') ?? null;
        const nativeAmount = isOutflow ? tx.OutflowNative : tx.InflowNative;
        const convertedAmount = isOutflow ? tx.OutflowConverted : tx.InflowConverted;
        return {
          key: `transaction-${tx.ID}`,
          name: tx.Payee || tx.Memo || tx.Category || t`Scheduled transaction`,
          date: parseISO(tx.Date),
          amount: Math.abs(nativeAmount ?? convertedAmount ?? 0),
          budgetAmount: Math.abs(convertedAmount ?? 0),
          isOutflow,
          accountId,
          accountName: tx.Account ?? 'Unknown account',
          accountCurrency: accountId ? (accountByIdMap.get(accountId)?.Currency ?? null) : null,
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
  }, [
    occurrences,
    transactions,
    accountById,
    accountByIdMap,
    accountIdByName,
    today,
    oneOffHorizon,
    t,
  ]);

  const isLoading = occurrencesLoading || transactionsLoading;

  const renderItem = (item: UpcomingItem) => {
    const accountLocalizer = item.accountId ? accountLocalizersById.get(item.accountId) : undefined;
    const formattedAmount = formatMaskedMilli(
      accountLocalizer ?? globalLocalizer,
      item.amount,
      privacyMaskNumbers
    );
    const formattedBudgetAmount =
      item.budgetAmount != null &&
      item.accountCurrency &&
      budgetCurrency &&
      item.accountCurrency !== budgetCurrency
        ? formatMaskedMilli(globalLocalizer, item.budgetAmount, privacyMaskNumbers)
        : null;
    const daysUntil = differenceInCalendarDays(item.date, today);
    const accentClass = item.isOutflow ? 'text-red-600 dark:text-red-300' : 'text-green-600';
    const Icon = item.isRecurring ? RefreshCw : CalendarClock;

    return (
      <li key={item.key}>
        <button
          type="button"
          onClick={() => handleItemClick(item)}
          className="w-full overflow-hidden rounded-xl border border-border/60 bg-muted/20 px-3 py-2.5 text-left transition-colors hover:border-border hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <div className="flex min-w-0 items-start justify-between gap-3">
            <div className="flex min-w-0 flex-1 flex-col gap-1 overflow-hidden">
              <div className="flex min-w-0 items-center gap-2 text-sm font-medium text-foreground">
                <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 truncate">{item.name}</span>
              </div>
              <div className="truncate text-xs text-muted-foreground">
                {format(item.date, 'EEE, MMM d')} • {item.accountName}
              </div>
              {item.memo ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="truncate text-xs text-muted-foreground/80">{item.memo}</div>
                  </TooltipTrigger>
                  <TooltipContent
                    side="bottom"
                    align="start"
                    className="max-w-sm whitespace-pre-wrap break-all text-sm"
                  >
                    {item.memo}
                  </TooltipContent>
                </Tooltip>
              ) : null}
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <span className={`text-sm font-semibold ${accentClass}`}>
                {item.isOutflow ? '−' : '+'}
                {formattedAmount}
              </span>
              {formattedBudgetAmount ? (
                <span className="text-[11px] text-muted-foreground">≈ {formattedBudgetAmount}</span>
              ) : null}
              <Badge variant={item.badgeVariant}>{item.badgeLabel}</Badge>
              <span className="text-[11px] text-muted-foreground">
                {daysUntil <= 0
                  ? t`Due today`
                  : plural(daysUntil, {
                      one: `Due in # day`,
                      other: `Due in # days`,
                    })}
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
          <Trans>
            <CalendarClock className="h-5 w-5 text-muted-foreground" />
            Upcoming transactions
          </Trans>
        </CardTitle>
        <CardDescription className="text-xs">
          <Trans>
            Next charge for each recurring series, plus scheduled transactions in the next{' '}
            {ONE_OFF_LOOKAHEAD_MONTHS} months.
          </Trans>
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
            <Trans>
              Nothing upcoming. Recurring charges and transactions dated in the next{' '}
              {ONE_OFF_LOOKAHEAD_MONTHS} months appear here.
            </Trans>
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
          <Trans>
            Manage automations
            <ArrowRight className="h-4 w-4" />
          </Trans>
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
