import { Trans, useLingui } from '@lingui/react/macro';
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
import { useReconcileAccount } from '@entities/transaction/api/useTransactions';
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
  const { t } = useLingui();

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
  const reconcileAccountMutation = useReconcileAccount();
  const { data: categories = [] } = useCategories(budgetId);

  const incomeCategory = findCategoryByName(categories, 'Income');

  // The bank statement only reflects cleared transactions, so reconcile against the
  // cleared balance: the full balance minus every uncleared transaction (any date,
  // which also drops scheduled future rows). Matches "Cleared" in the account header.
  const currentBalance = asMilli(account.BalanceNative - (account.UnclearedNative ?? 0));

  // Cross-currency transfers can leave sub-cent residue (a few milliunits) in
  // an account. It displays as 0.00 but the balance is not zero, so any
  // non-zero difference gets an adjustment, even one smaller than a cent;
  // otherwise the user can never bring the account to exactly what the bank
  // shows. Sub-cent differences only get a different explanation in the UI.
  const ONE_CENT_MILLI = 10;

  const handleSubmit = async () => {
    // Synchronous guard against double-clicks (state updates are async)
    if (isSubmittingRef.current) {
      return;
    }

    if (actualBalance === null) {
      toast.error(t`Please enter a valid balance amount`);
      return;
    }

    // Capture the difference at submission time (exact integer milliunits)
    const difference = actualBalance - currentBalance;
    const needsAdjustment = difference !== 0;

    // Validate income category before starting submission
    if (needsAdjustment && !incomeCategory) {
      toast.error(t`Income category not found. Please ensure your budget has an Income category.`);
      return;
    }

    // Set both ref and state to prevent double submissions
    isSubmittingRef.current = true;
    setIsSubmitting(true);

    try {
      const todayDate = getTodayISO();

      // One op adds the cleared adjustment and locks cleared transactions up to
      // today (uncleared ones stay open), so a single undo reverts both.
      const isInflow = difference > 0;
      const adjustmentAmount = asMilli(Math.abs(difference));
      await reconcileAccountMutation.mutateAsync({
        accountId: account.ID,
        reconcileDate: todayDate,
        // incomeCategory is guaranteed to exist here because of the
        // needsAdjustment && !incomeCategory guard above.
        adjustment: needsAdjustment
          ? {
              inflow: isInflow ? adjustmentAmount : ZERO_MILLI,
              outflow: isInflow ? ZERO_MILLI : adjustmentAmount,
              categoryId: incomeCategory!.ID,
              budgetId,
              date: todayDate,
              memo: 'Account Reconciliation',
              payee: 'Budgero',
            }
          : undefined,
      });

      if (needsAdjustment && adjustmentAmount < ONE_CENT_MILLI) {
        toast.success(
          t`Account reconciled successfully. Cleared a fraction of a cent of rounding residue.`
        );
      } else if (needsAdjustment) {
        toast.success(
          t`Account reconciled successfully. ${isInflow ? 'Added' : 'Removed'} ${formatMilli(accountLocalizer, adjustmentAmount)}`
        );
      } else {
        toast.success(t`Account reconciled successfully. Balance matches - no adjustment needed.`);
      }
      setIsOpen(false);
      setActualBalance(null);
      setLiveBalance(null);
      setIsEditingBalance(false);
    } catch (error) {
      console.error('Error reconciling account:', error);
      toast.error(t`Failed to reconcile account. Please try again.`);
    } finally {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  // While the user is typing, preview against the live value; otherwise the committed one.
  const effectiveBalance = isEditingBalance ? liveBalance : actualBalance;

  const difference: MilliUnits | null =
    effectiveBalance === null ? null : asMilli(effectiveBalance - currentBalance);
  // Sub-cent residue renders as 0.00; show it neutrally with its own note
  // instead of a red "-0.00", but still adjust it on submit.
  const isSubCent =
    difference !== null && difference !== 0 && Math.abs(difference) < ONE_CENT_MILLI;

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
          <Trans>
            <Calculator className="h-4 w-4" />
            Reconcile
          </Trans>
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
            <Trans>
              <DollarSign className="h-5 w-5" />
              Reconcile Account
            </Trans>
          </DialogTitle>
          <DialogDescription className="hidden md:block">
            <Trans>
              Enter the balance your bank shows. It is compared with your cleared balance; cleared
              transactions are then locked, and uncleared ones stay open.
            </Trans>
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="order-1 grid grid-cols-2 gap-4 p-4 bg-muted/50 rounded-lg">
            <div>
              <Label className="text-xs md:text-sm font-medium text-muted-foreground">
                <Trans>Cleared Balance</Trans>
              </Label>
              {/* Most reconciles match: one click copies it into Actual Balance. */}
              <button
                type="button"
                onClick={() => {
                  setActualBalance(currentBalance);
                  setLiveBalance(currentBalance);
                }}
                className="group block text-left"
                aria-label={t`Use the cleared balance as the actual balance`}
              >
                <span className="block text-sm md:text-lg font-semibold break-words underline decoration-dotted decoration-muted-foreground/50 underline-offset-4 group-hover:decoration-foreground">
                  {formatMilli(accountLocalizer, currentBalance)}
                </span>
                <span className="mt-0.5 block text-[11px] leading-tight text-muted-foreground group-hover:text-foreground">
                  <Trans>Matches your bank? Click to use it</Trans>
                </span>
              </button>
            </div>
            <div>
              <Label className="text-xs md:text-sm font-medium text-muted-foreground">
                <Trans>Account</Trans>
              </Label>
              <p className="text-sm md:text-lg font-semibold break-words">{account.Name}</p>
            </div>
          </div>

          <Field
            label={t`Actual Balance`}
            htmlFor="actual-balance"
            className="order-3 space-y-2 md:order-2"
          >
            <CalculatorCell
              value={actualBalance ?? ZERO_MILLI}
              onCommit={setActualBalance}
              currencyCode={account.Currency}
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
                <Label className="text-xs md:text-sm font-medium">
                  <Trans>Adjustment Needed:</Trans>
                </Label>
                <span
                  className={`text-sm md:text-base font-semibold whitespace-nowrap ${
                    isSubCent || difference === 0
                      ? 'text-muted-foreground'
                      : difference > 0
                        ? 'text-success'
                        : 'text-destructive'
                  }`}
                >
                  {isSubCent
                    ? `< ${formatMilli(accountLocalizer, asMilli(ONE_CENT_MILLI))}`
                    : `${difference > 0 ? '+' : ''}${formatMilli(accountLocalizer, difference)}`}
                </span>
              </div>
              {difference === 0 && (
                <p className="text-xs md:text-sm text-muted-foreground mt-1">
                  <Trans>
                    Balances match - reconciliation will mark transactions as reconciled
                  </Trans>
                </p>
              )}
              {isSubCent && (
                <p className="text-xs md:text-sm text-muted-foreground mt-1">
                  <Trans>
                    The balance is off by a fraction of a cent (rounding from a currency
                    conversion). Reconciling clears it so the account matches your bank exactly.
                  </Trans>
                </p>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            <Trans>Cancel</Trans>
          </Button>
          <Button onClick={handleSubmit} disabled={actualBalance === null || isSubmitting}>
            {isSubmitting ? t`Reconciling...` : t`Reconcile Account`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
