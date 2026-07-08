'use client';

import { useId, useMemo, useState, useCallback } from 'react';
import { toast } from 'sonner';
import { Button } from '@shared/ui/button';
import { Label } from '@shared/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@shared/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@shared/ui/select';
import { CalculatorCell } from '@shared/ui/calculator-cell';
import { cn } from '@shared/lib/utils';
import { getTodayISO } from '@shared/lib/date-utils';
import { availableAmountClass } from '@shared/lib/amount-color';
import { ZERO_MILLI, type MilliUnits } from '@shared/lib/currency/milli';
import { roundMilli } from '@shared/lib/currency/round-amount';
import { useUiStore } from '@shared/store/useUiStore';
import { useFormatMaskedMilli } from '@features/budget-planning/lib/useFormatMaskedMilli';
import { useAccounts } from '@entities/account/api/useAccounts';
import { useAddTransaction } from '@entities/transaction/api/useTransactions';
import {
  formatTransferMemo,
  generateTransferId,
  getCurrentMonth,
  getCurrentDate,
} from '@features/transactions/ui/add-transaction/add-transaction.utils';
import { getExchangeRate, getLocalOrManualRate } from '@entities/currency/lib/currency-utils';
import { useConnectivity } from '@shared/hooks/useConnectivity';
import { toastError } from '@shared/lib/errors';
import { findCCAccountForCategory, listSourceAccountsForCCPayment } from './cc-payment.utils';

export interface CCPaymentCoverPopoverProps {
  available: MilliUnits;
  ccCategoryId: number;
  budgetId: number;
  globalLocalizer: Intl.NumberFormat;
  className?: string;
  align?: 'start' | 'center' | 'end';
  triggerClassName?: string;
}

export function CCPaymentCoverPopover({
  available,
  ccCategoryId,
  budgetId,
  globalLocalizer,
  className,
  align = 'end',
  triggerClassName,
}: CCPaymentCoverPopoverProps) {
  const sourceAccountTriggerId = useId();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState<MilliUnits>(ZERO_MILLI);
  const [sourceAccountId, setSourceAccountId] = useState<number | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);

  const selectedBudget = useUiStore((s) => s.selectedBudget);
  const { clerkToken, apiReachable } = useConnectivity();
  const canUseCurrencyApi = clerkToken && apiReachable;
  const formatAmount = useFormatMaskedMilli(globalLocalizer);

  const { data: accounts } = useAccounts(budgetId);
  const ccAccount = useMemo(
    () => findCCAccountForCategory(accounts, ccCategoryId),
    [accounts, ccCategoryId]
  );
  const sourceAccounts = useMemo(() => listSourceAccountsForCCPayment(accounts), [accounts]);

  const handleOpenChange = (next: boolean) => {
    if (next) {
      setAmount(available > 0 ? available : ZERO_MILLI);
      if (sourceAccountId === null && sourceAccounts.length > 0) {
        setSourceAccountId(sourceAccounts[0].ID);
      }
    }
    setOpen(next);
  };

  const addTransaction = useAddTransaction();

  const sourceAccount = sourceAccounts.find((a) => a.ID === sourceAccountId);

  // Overpayment (paying more than the card owes) is intentionally not blocked here.
  const canConfirm =
    !!ccAccount && !!sourceAccount && amount > 0 && !addTransaction.isPending && !isConfirming;

  const handleConfirm = useCallback(async () => {
    if (!ccAccount || !sourceAccount || amount <= 0) return;
    setIsConfirming(true);

    try {
      const today = getTodayISO();
      const currentMonth = getCurrentMonth(new Date());
      const currentDate = getCurrentDate(new Date());
      const budgetCurrency = selectedBudget?.DisplayCurrency || '';
      const needsSourceConversion = sourceAccount.Currency !== budgetCurrency;
      const needsCCConversion = ccAccount.Currency !== budgetCurrency;
      let sourceOutflow: MilliUnits = amount;
      let ccInflow: MilliUnits = amount;

      if ((needsSourceConversion || needsCCConversion) && selectedBudget) {
        if (!canUseCurrencyApi) {
          const localOrManual = await getLocalOrManualRate(
            sourceAccount.Currency,
            ccAccount.Currency,
            currentMonth,
            selectedBudget.ID,
            currentDate
          );
          if (!localOrManual) {
            toast.error('No exchange rate available', {
              description:
                'Please add a manual exchange rate in Settings → Currencies, or create this transfer from the transaction form.',
            });
            setIsConfirming(false);
            return;
          }
        }

        // amount is in budget currency; convert to each account's currency independently
        if (needsSourceConversion) {
          const rateBudgetToSource = await getExchangeRate(
            budgetCurrency,
            sourceAccount.Currency,
            currentMonth,
            selectedBudget.ID,
            currentDate
          );
          if (rateBudgetToSource) {
            sourceOutflow = roundMilli(amount * rateBudgetToSource);
          }
        }

        if (needsCCConversion) {
          const rateBudgetToCC = await getExchangeRate(
            budgetCurrency,
            ccAccount.Currency,
            currentMonth,
            selectedBudget.ID,
            currentDate
          );
          if (rateBudgetToCC) {
            ccInflow = roundMilli(amount * rateBudgetToCC);
          }
        }
      }

      const needsConversion = needsSourceConversion || needsCCConversion;
      // formatTransferMemo takes milliunit amounts and renders decimals itself
      const transferMemo = formatTransferMemo({
        fromAccountName: sourceAccount.Name,
        toAccountName: ccAccount.Name,
        memo: '',
        amount: sourceOutflow,
        convertedAmount: ccInflow,
        fromCurrency: sourceAccount.Currency,
        toCurrency: ccAccount.Currency,
        needsConversion,
      });
      const transferId = generateTransferId();

      // Source side (outflow on the funding account)
      await addTransaction.mutateAsync({
        inflow: 0,
        outflow: sourceOutflow,
        accountId: sourceAccount.ID,
        categoryId: 0, // server resolves to Transfers
        budgetId,
        date: today,
        memo: transferMemo,
        payee: ccAccount.Name,
        transferId,
      });

      // Destination side (inflow on the credit card)
      await addTransaction.mutateAsync({
        inflow: ccInflow,
        outflow: 0,
        accountId: ccAccount.ID,
        categoryId: 0,
        budgetId,
        date: today,
        memo: transferMemo,
        payee: sourceAccount.Name,
        transferId,
      });

      toast.success('Card payment recorded', {
        description: `${formatAmount(sourceOutflow)} ${sourceAccount.Currency} transferred to ${ccAccount.Name}.`,
      });
      setOpen(false);
    } catch (err) {
      toastError('Failed to record card payment', err, 'Unknown error');
    } finally {
      setIsConfirming(false);
    }
  }, [
    amount,
    ccAccount,
    sourceAccount,
    budgetId,
    selectedBudget,
    canUseCurrencyApi,
    addTransaction,
    formatAmount,
  ]);

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'underline decoration-dotted underline-offset-2 hover:text-primary focus:outline-none',
            availableAmountClass(available),
            triggerClassName
          )}
          title="Cover this card"
          onClick={(e) => {
            e.stopPropagation();
            handleOpenChange(true);
          }}
        >
          {formatAmount(available)}
        </button>
      </PopoverTrigger>
      <PopoverContent className={cn('w-72 p-3', className)} align={align}>
        <div className="space-y-3">
          <div className="text-sm font-medium">Cover {ccAccount?.Name || 'card'}</div>

          {sourceAccounts.length === 0 ? (
            <div className="text-xs text-muted-foreground">
              No on-budget checking/savings accounts available to pay from.
            </div>
          ) : (
            <>
              <div className="space-y-1">
                {/* Caption, not a <label>: CalculatorCell exposes no labelable control. */}
                <span className="text-xs text-muted-foreground">Amount</span>
                <CalculatorCell
                  value={amount}
                  onCommit={setAmount}
                  formatter={globalLocalizer.format}
                  localizer={globalLocalizer}
                  placeholder="0.00"
                  zeroAsEmpty
                  inputAlign="left"
                  displayClassName="h-9 flex items-center rounded-md border border-input bg-background px-3 text-sm"
                  inputClassName="h-9"
                />
                <div className="text-[10px] text-muted-foreground">
                  Available to cover: {formatAmount(Math.max(0, available || 0))}
                </div>
              </div>

              <div className="space-y-1">
                <Label
                  htmlFor={sourceAccountTriggerId}
                  className="font-normal text-xs text-muted-foreground"
                >
                  From account
                </Label>
                <Select
                  value={sourceAccountId !== null ? String(sourceAccountId) : ''}
                  onValueChange={(v) => setSourceAccountId(Number(v))}
                >
                  <SelectTrigger id={sourceAccountTriggerId} className="h-8 w-full">
                    <SelectValue placeholder="Select account" />
                  </SelectTrigger>
                  <SelectContent>
                    {sourceAccounts.map((a) => (
                      <SelectItem key={a.ID} value={String(a.ID)}>
                        {a.Name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center justify-end gap-2 pt-1">
                <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button size="sm" onClick={handleConfirm} disabled={!canConfirm}>
                  {addTransaction.isPending || isConfirming ? 'Recording…' : 'Pay'}
                </Button>
              </div>
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
