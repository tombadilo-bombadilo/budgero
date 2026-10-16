import { plural } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, Tag, Sparkles } from 'lucide-react';
import { parseISO } from 'date-fns';
import { formatDate as format } from '@shared/lib/date-format';

import type { GetAllTransactions, GetTransactionsByAccountRow } from '@budgero/core/browser';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@shared/ui/card';
import { Button } from '@shared/ui/button';
import { Badge } from '@shared/ui/badge';
import { EmptyStateRow } from '@shared/ui/EmptyStateRow';
import { DeleteTransactionDialog } from '@features/transactions/ui/DeleteTransactionDialog';
import { TransactionQuickViewDialog } from '@features/transactions/ui/TransactionQuickViewDialog';
import { useDeleteTransaction } from '@entities/transaction/api/useTransactions';
import {
  useRecentUncategorizedTransactions,
  useUncategorizedTransactions,
} from '@entities/transaction/api/useUncategorizedTransactions';
import { useTransactionCellCommit } from '@features/transactions/api/useTransactionCellCommit';
import { type TransactionColumnName as DbTransactionColumn } from '@entities/transaction/api/mutations';
import { useAccounts } from '@entities/account/api/useAccounts';
import { useUiStore } from '@shared/store/useUiStore';
import { AICategorizeDialog } from '@features/ai/ui/AICategorizeDialog';
import { useLLMSettings } from '@features/ai/api/useLLMSettings';
import { formatMaskedMilli } from '@shared/lib/privacy/mask-numbers';
import { toastError } from '@shared/lib/errors';
import { buttonizeProps } from '@shared/lib/a11y';

type UncategorizedTransactionsCardProps = {
  budgetId: number;
  globalLocalizer: Intl.NumberFormat;
};

type TransactionCardRow = GetTransactionsByAccountRow & {
  AccountId?: number;
  AccountName?: string;
};

const MAX_ROWS = 6;

export function UncategorizedTransactionsCard({
  budgetId,
  globalLocalizer,
}: UncategorizedTransactionsCardProps) {
  const { t } = useLingui();

  // The newest few rows and the per-account counts, not the whole ledger.
  const { data: transactions = [], isLoading } = useRecentUncategorizedTransactions(
    budgetId,
    MAX_ROWS
  );
  const { data: uncategorizedCounts } = useUncategorizedTransactions(budgetId);
  const { data: accounts = [] } = useAccounts(budgetId);
  const { data: llmSettings } = useLLMSettings(budgetId);
  const accountLocalizer = useUiStore((state) => state.accountLocalizer);
  const privacyMaskNumbers = useUiStore((state) => state.privacyMaskNumbers);

  const [quickViewOpen, setQuickViewOpen] = useState(false);
  const [aiCategorizeOpen, setAiCategorizeOpen] = useState(false);
  const [quickViewTx, setQuickViewTx] = useState<TransactionCardRow | null>(null);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  const cellCommit = useTransactionCellCommit();
  const deleteTransaction = useDeleteTransaction();

  const accountById = useMemo(() => {
    return new Map(accounts.map((account) => [account.ID, account.Name]));
  }, [accounts]);

  const uncategorized = useMemo(() => {
    return transactions
      .filter((transaction) => {
        if (!transaction) return false;
        if (transaction.Category === 'Split') return false;
        return (
          !transaction.CategoryID ||
          transaction.CategoryID === 0 ||
          !transaction.Category ||
          transaction.Category === 'Uncategorized'
        );
      })
      .sort((a, b) => {
        const aDate = a.Date ? new Date(a.Date) : new Date(0);
        const bDate = b.Date ? new Date(b.Date) : new Date(0);
        return bDate.getTime() - aDate.getTime();
      })
      .slice(0, MAX_ROWS);
  }, [transactions]);

  // Same rule as the old in-memory count over every transaction (split parents
  // excluded; CategoryID 0, a missing category, '' or 'Uncategorized').
  const totalCount = uncategorizedCounts.total;

  const toTransactionCardRow = (transaction: GetAllTransactions): TransactionCardRow => {
    const accountId = transaction.AccountId ?? 0;
    const accountName = accountById.get(accountId) || transaction.AccountName || t`Unknown account`;

    return {
      ID: transaction.ID,
      Date: transaction.Date,
      CategoryID: transaction.CategoryID,
      Category: transaction.Category,
      Memo: transaction.Memo,
      Reconciled: false,
      InflowConverted: transaction.InflowConverted,
      OutflowConverted: transaction.OutflowConverted,
      RunningBalanceConverted: transaction.RunningBalanceConverted ?? null,
      TransferID: transaction.TransferID,
      Account: accountName,
      AccountId: accountId,
      AccountName: accountName,
      Payee: transaction.Payee,
      LabelID: transaction.LabelID ?? null,
      Label: transaction.Label ?? null,
      LabelColor: transaction.LabelColor ?? null,
    };
  };

  const handleTransactionClick = (transaction: GetAllTransactions) => {
    setQuickViewTx(toTransactionCardRow(transaction));
    setQuickViewOpen(true);
  };

  const handleQuickCommit = (
    transactionId: number,
    columnId: string,
    newVal: string | number | Date | null
  ) => {
    if (!quickViewTx) return;
    const account = accounts?.find((a) => a.Name === quickViewTx.Account);
    const patch = cellCommit.mutate(transactionId, columnId as DbTransactionColumn, newVal, {
      accountId: account?.ID || 0,
    });
    if (!patch) return;
    setQuickViewTx((prev) => (prev ? ({ ...prev, ...patch } as TransactionCardRow) : prev));
  };

  const resolveAccountIdForTx = (tx: TransactionCardRow) => {
    if (tx.AccountId) return Number(tx.AccountId);
    const name = tx.Account || tx.AccountName;
    const acc = accounts?.find((a) => a.Name === name);
    return acc?.ID || 0;
  };

  const handleDeleteTx = async () => {
    if (!quickViewTx) return;
    const accountId = resolveAccountIdForTx(quickViewTx);
    try {
      await deleteTransaction.mutateAsync({
        transactionId: Number(quickViewTx.ID),
        accountId,
      });
      toast.success(t`Transaction deleted`, {
        description: t`The transaction has been permanently removed.`,
      });
      setConfirmDeleteOpen(false);
      setQuickViewOpen(false);
      setQuickViewTx(null);
    } catch (error) {
      toastError('Failed to delete transaction', error, 'Please try again.');
    }
  };

  const getPrimaryInflow = (tx: { InflowConverted: number }) => tx.InflowConverted || 0;
  const getPrimaryOutflow = (tx: { OutflowConverted: number }) => tx.OutflowConverted || 0;
  const getSecondaryInflow = (tx: { InflowConverted: number }) => tx.InflowConverted ?? 0;
  const getSecondaryOutflow = (tx: { OutflowConverted: number }) => tx.OutflowConverted ?? 0;

  return (
    <>
      <Card className="h-full">
        <CardHeader className="pb-1">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base font-semibold">
              <Trans>
                <AlertTriangle className="h-5 w-5 text-muted-foreground" />
                Needs categorising
              </Trans>
            </CardTitle>
            {llmSettings?.Enabled && totalCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setAiCategorizeOpen(true)}
                className="h-8 px-2 text-xs"
              >
                <Trans>
                  <Sparkles className="h-3.5 w-3.5 mr-1" />
                  AI Categorize
                </Trans>
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {isLoading ? (
            <div className="space-y-2">
              <div className="h-16 animate-pulse rounded-xl bg-muted/40" />
              <div className="h-16 animate-pulse rounded-xl bg-muted/40" />
            </div>
          ) : uncategorized.length > 0 ? (
            <ul className="space-y-2">
              {uncategorized.map((transaction) => {
                const dateLabel = transaction.Date
                  ? format(parseISO(transaction.Date), 'MMM d')
                  : t`Unknown date`;
                const memo = transaction.Memo?.trim() ? transaction.Memo : t`No memo`;
                const accountName =
                  accountById.get(transaction.AccountId ?? 0) ||
                  transaction.AccountName ||
                  String((transaction as { Account?: string }).Account ?? '') ||
                  t`Unknown account`;
                const inflow = Number(transaction.InflowConverted || 0);
                const outflow = Number(transaction.OutflowConverted || 0);
                const amount = inflow > 0 ? inflow : outflow;
                const isIncome = inflow > 0;
                const formattedAmount = formatMaskedMilli(
                  globalLocalizer,
                  amount,
                  privacyMaskNumbers
                );

                return (
                  <li
                    key={transaction.ID}
                    className="overflow-hidden rounded-xl border border-border/60 bg-muted/15 transition-colors hover:border-border hover:bg-muted/25"
                  >
                    <div
                      className="flex items-start justify-between gap-2 px-2 py-1.5 sm:px-3 sm:py-2.5 cursor-pointer"
                      {...buttonizeProps(() => handleTransactionClick(transaction))}
                    >
                      <div className="min-w-0 flex-1 flex flex-col gap-0.5 sm:gap-1">
                        <div className="flex items-center gap-1.5 sm:gap-2 text-xs sm:text-sm font-medium text-foreground min-w-0">
                          <Tag className="h-3 w-3 sm:h-4 sm:w-4 shrink-0 text-muted-foreground" />
                          <span className="truncate">{memo}</span>
                        </div>
                        <div className="truncate text-[10px] sm:text-xs text-muted-foreground">
                          {dateLabel} • {accountName}
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-0.5 sm:gap-1">
                        <span
                          className={`whitespace-nowrap text-xs sm:text-sm font-semibold tabular-nums ${
                            isIncome ? 'text-green-600' : 'text-red-600 dark:text-red-300'
                          }`}
                        >
                          {isIncome ? '+' : '−'}
                          {formattedAmount}
                        </span>
                        <Badge
                          variant="outline"
                          className="text-[10px] sm:text-xs px-1.5 sm:px-2.5 py-0 sm:py-0.5"
                        >
                          <Trans>Uncategorised</Trans>
                        </Badge>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyStateRow icon={AlertTriangle}>
              <Trans>Great job! No uncategorised transactions left.</Trans>
            </EmptyStateRow>
          )}
        </CardContent>
        <CardFooter className="pt-0 text-xs text-muted-foreground">
          <span>
            {totalCount > 0
              ? plural(totalCount, {
                  one: `# transaction waiting`,
                  other: `# transactions waiting`,
                })
              : t`All caught up`}
          </span>
        </CardFooter>
      </Card>

      {/* Quick View Dialog for a transaction */}
      <TransactionQuickViewDialog
        open={quickViewOpen}
        onOpenChange={setQuickViewOpen}
        transaction={quickViewTx}
        budgetId={budgetId}
        globalLocalizer={globalLocalizer}
        accountLocalizer={accountLocalizer}
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
        onOpenChange={setConfirmDeleteOpen}
        onConfirm={handleDeleteTx}
        isPending={deleteTransaction.isPending}
      />

      {/* AI Categorize Dialog */}
      <AICategorizeDialog
        open={aiCategorizeOpen}
        onOpenChange={setAiCategorizeOpen}
        budgetId={budgetId}
      />
    </>
  );
}
