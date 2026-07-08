'use client';

import { useMemo } from 'react';
import { Trash2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@shared/ui/dialog';
import { Button } from '@shared/ui/button';
import {
  useMonthlyTransactions,
  useDeleteTransaction,
} from '@entities/transaction/api/useTransactions';
import { useAccounts } from '@entities/account/api/useAccounts';
import { useFormatMaskedMilli } from '@features/budget-planning/lib/useFormatMaskedMilli';
import { findCCAccountForCategory } from './category-row/cc-payment.utils';

export interface CCPaymentActivityDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ccCategoryId: number;
  ccCategoryName: string;
  budgetId: number;
  currentMonth: string;
}

export function CCPaymentActivityDialog({
  open,
  onOpenChange,
  ccCategoryId,
  ccCategoryName,
  budgetId,
  currentMonth,
}: CCPaymentActivityDialogProps) {
  const { data: accounts } = useAccounts(budgetId);
  const ccAccount = useMemo(
    () => findCCAccountForCategory(accounts, ccCategoryId),
    [accounts, ccCategoryId]
  );

  const { data: txs = [], isLoading } = useMonthlyTransactions(ccAccount?.ID ?? 0, currentMonth);

  const payments = useMemo(
    () =>
      txs
        .filter((t) => Boolean(t.TransferID) && (t.Inflow ?? 0) > 0)
        .sort((a, b) => (a.Date < b.Date ? -1 : a.Date > b.Date ? 1 : 0)),
    [txs]
  );

  const formatAmount = useFormatMaskedMilli();

  const deleteTransaction = useDeleteTransaction();

  const totalPaid = payments.reduce((sum, p) => sum + (p.Inflow ?? 0), 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md p-4 sm:p-6 max-h-[min(92vh,calc(100dvh-2rem))] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{ccCategoryName} payments</DialogTitle>
          <DialogDescription>Transfers covering this card in the selected month.</DialogDescription>
        </DialogHeader>

        {!ccAccount ? (
          <div className="py-4 text-sm text-muted-foreground">
            Could not find the credit card account linked to this category.
          </div>
        ) : isLoading ? (
          <div className="py-4 text-sm text-muted-foreground">Loading…</div>
        ) : payments.length === 0 ? (
          <div className="py-4 text-sm text-muted-foreground">
            No payments to this card yet this month.
          </div>
        ) : (
          <>
            <div className="space-y-2">
              {payments.map((p) => (
                <div
                  key={p.ID}
                  className="flex items-start gap-3 rounded-md border border-border bg-card p-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium tabular-nums">{p.Date}</div>
                    <div className="mt-0.5 line-clamp-2 break-words text-xs text-muted-foreground">
                      {p.Memo || 'Transfer'}
                    </div>
                  </div>
                  <div className="shrink-0 text-sm font-semibold tabular-nums text-foreground">
                    {formatAmount(p.Inflow ?? 0)}
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 shrink-0"
                    title="Delete payment"
                    disabled={deleteTransaction.isPending}
                    onClick={() =>
                      deleteTransaction.mutate({
                        transactionId: p.ID,
                        accountId: ccAccount.ID,
                      })
                    }
                  >
                    <Trash2 className="h-4 w-4 text-muted-foreground" />
                  </Button>
                </div>
              ))}
            </div>
            <div className="mt-4 flex items-center justify-between border-t border-border pt-3 text-sm">
              <span className="text-muted-foreground">Total paid this month</span>
              <span className="font-semibold tabular-nums">{formatAmount(totalPaid)}</span>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
