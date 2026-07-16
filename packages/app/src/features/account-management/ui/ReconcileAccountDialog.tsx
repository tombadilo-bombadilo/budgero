import { useState, useRef } from 'react';
import { Button } from '@shared/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@shared/ui/dialog';
import { Label } from '@shared/ui/label';
import { Field } from '@shared/ui/field';
import { CalculatorCell } from '@shared/ui/calculator-cell';
import { useIsMobile } from '@shared/hooks/useIsMobile';
import { cn } from '@shared/lib/utils';
import { getTodayISO } from '@shared/lib/date-utils';
import { useAddTransaction, useReconcileAccount } from '@entities/transaction/api/useTransactions';
import { useCategories } from '@entities/category/api/useCategories';
import { findCategoryByName } from '@entities/category/lib/find-category';
import { useUiStore } from '@shared/store/useUiStore';
import { asMilli, formatMilli, ZERO_MILLI, type MilliUnits } from '@shared/lib/currency/milli';
import { Calculator, DollarSign } from 'lucide-react';
import { toast } from 'sonner';
import type { Account } from '@budgero/core/browser';

interface ReconcileAccountDialogProps {
  account: Account;
  budgetId: number;
}

export function ReconcileAccountDialog({ account, budgetId }: ReconcileAccountDialogProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [actualBalance, setActualBalance] = useState<MilliUnits | null>(null);
  // Live value as the user types (before commit) so the difference updates immediately.
  const [liveBalance, setLiveBalance] = useState<MilliUnits | null>(null);
  const [isEditingBalance, setIsEditingBalance] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Ref-based guard to prevent double submissions (React state updates are async)
  const isSubmittingRef = useRef(false);

  const { accountLocalizer } = useUiStore();
  const isMobile = useIsMobile();
  const addTransactionMutation = useAddTransaction();
  const reconcileAccountMutation = useReconcileAccount();
  const { data: categories = [] } = useCategories(budgetId);

  const incomeCategory = findCategoryByName(categories, 'Income');

  // Reconcile against the realized balance as of today, NOT account.Balance which
  // also bakes in future-dated (upcoming) transactions. Subtract the future impact
  // so the target matches the "Balance" shown in the account header.
  // All milliunits: Account balances are stored MilliUnits values.
  const currentBalance = asMilli(account.Balance - (account.FutureImpactOriginal ?? 0));

  // Differences under one cent (10 milliunits) are treated as matching so
  // milliunit-precision residue never creates a phantom adjustment.
  const ONE_CENT_MILLI = 10;

  const handleSubmit = async () => {
    // Synchronous guard against double-clicks (state updates are async)
    if (isSubmittingRef.current) {
      return;
    }

    if (actualBalance === null) {
      toast.error('Please enter a valid balance amount');
      return;
    }

    // Capture the difference at submission time (exact integer milliunits)
    const difference = actualBalance - currentBalance;
    const needsAdjustment = Math.abs(difference) >= ONE_CENT_MILLI;

    // Validate income category before starting submission
    if (needsAdjustment && !incomeCategory) {
      toast.error('Income category not found. Please ensure your budget has an Income category.');
      return;
    }

    // Set both ref and state to prevent double submissions
    isSubmittingRef.current = true;
    setIsSubmitting(true);

    try {
      const todayDate = getTodayISO();

      if (needsAdjustment) {
        const isInflow = difference > 0;
        const amount = asMilli(Math.abs(difference));

        // incomeCategory is guaranteed to exist here because we checked for it above
        // (the needsAdjustment && !incomeCategory guard) and returned early if missing.
        await addTransactionMutation.mutateAsync({
          inflow: isInflow ? amount : ZERO_MILLI,
          outflow: isInflow ? ZERO_MILLI : amount,
          accountId: account.ID,
          categoryId: incomeCategory!.ID,
          budgetId,
          date: todayDate,
          memo: 'Account Reconciliation',
          payee: 'Budgero',
          transferId: '',
        });
      }

      // Always mark all transactions up to today as reconciled and update the account's reconciled_at timestamp
      await reconcileAccountMutation.mutateAsync({
        accountId: account.ID,
        reconcileDate: todayDate,
      });

      if (needsAdjustment) {
        const isInflow = difference > 0;
        const amount = asMilli(Math.abs(difference));
        toast.success(
          `Account reconciled successfully. ${isInflow ? 'Added' : 'Removed'} ${formatMilli(accountLocalizer, amount)}`
        );
      } else {
        toast.success('Account reconciled successfully. Balance matches - no adjustment needed.');
      }
      setIsOpen(false);
      setActualBalance(null);
      setLiveBalance(null);
      setIsEditingBalance(false);
    } catch (error) {
      console.error('Error reconciling account:', error);
      toast.error('Failed to reconcile account. Please try again.');
    } finally {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  // While the user is typing, preview against the live value; otherwise the committed one.
  const effectiveBalance = isEditingBalance ? liveBalance : actualBalance;

  const calculateDifference = (): MilliUnits | null => {
    if (effectiveBalance === null) return null;
    const raw = effectiveBalance - currentBalance;
    // Snap sub-cent residue to zero so matching balances don't render a
    // phantom "-0.00" adjustment in red.
    return asMilli(Math.abs(raw) < ONE_CENT_MILLI ? 0 : raw);
  };

  const difference = calculateDifference();

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open);
    if (!open) {
      setActualBalance(null);
      setLiveBalance(null);
      setIsEditingBalance(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Calculator className="h-4 w-4" />
          Reconcile
        </Button>
      </DialogTrigger>
      <DialogContent
        className={cn(
          'sm:max-w-md',
          // When the mobile calculator sheet is open it covers the bottom of the
          // screen, so anchor the dialog near the top to keep the input visible.
          isMobile &&
            isEditingBalance &&
            'top-4 translate-y-0 transition-[top,transform] duration-200'
        )}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <DollarSign className="h-5 w-5" />
            Reconcile Account
          </DialogTitle>
          <DialogDescription className="hidden md:block">
            Enter your actual account balance to reconcile with the current balance in the system.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="order-1 grid grid-cols-2 gap-4 p-4 bg-muted/50 rounded-lg">
            <div>
              <Label className="text-xs md:text-sm font-medium text-muted-foreground">
                Current Balance
              </Label>
              <p className="text-sm md:text-lg font-semibold break-words">
                {formatMilli(accountLocalizer, currentBalance)}
              </p>
            </div>
            <div>
              <Label className="text-xs md:text-sm font-medium text-muted-foreground">
                Account
              </Label>
              <p className="text-sm md:text-lg font-semibold break-words">{account.Name}</p>
            </div>
          </div>

          <Field
            label="Actual Balance"
            htmlFor="actual-balance"
            className="order-3 space-y-2 md:order-2"
          >
            <CalculatorCell
              value={actualBalance ?? ZERO_MILLI}
              onCommit={setActualBalance}
              onValueChange={setLiveBalance}
              onEditingChange={setIsEditingBalance}
              formatter={accountLocalizer.format}
              localizer={accountLocalizer}
              placeholder="0.00"
              zeroAsEmpty
              commitUnchanged
              inputAlign="right"
              displayClassName="h-9 flex items-center justify-end rounded-md border border-input bg-background px-3 text-sm"
              inputClassName="text-right"
            />
          </Field>

          {difference !== null && (
            <div className="order-2 p-3 bg-muted/50 rounded-lg md:order-3">
              <div className="flex justify-between items-center gap-2">
                <Label className="text-xs md:text-sm font-medium">Adjustment Needed:</Label>
                <span
                  className={`text-sm md:text-base font-semibold whitespace-nowrap ${
                    difference > 0
                      ? 'text-success'
                      : difference < 0
                        ? 'text-destructive'
                        : 'text-muted-foreground'
                  }`}
                >
                  {difference > 0 ? '+' : ''}
                  {formatMilli(accountLocalizer, difference)}
                </span>
              </div>
              {Math.abs(difference) < ONE_CENT_MILLI && (
                <p className="text-xs md:text-sm text-muted-foreground mt-1">
                  Balances match - reconciliation will mark transactions as reconciled
                </p>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={actualBalance === null || isSubmitting}>
            {isSubmitting ? 'Reconciling...' : 'Reconcile Account'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
