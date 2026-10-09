import { currencyDisplayFor } from '@shared/lib/number-format';
import { AccountTypeLabel } from '@entities/account/ui/AccountTypeLabel';
import { Trans, useLingui } from '@lingui/react/macro';
import React, { useState } from 'react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@shared/ui/dialog';
import { Button } from '@shared/ui/button';
import { Input } from '@shared/ui/input';
import { CalculatorCell } from '@shared/ui/calculator-cell';
import { Popover, PopoverContent, PopoverTrigger } from '@shared/ui/popover';
import { Plus } from 'lucide-react';
import { DatePickerButton } from '@shared/ui/DatePickerButton';
import { parseISO, differenceInMonths } from 'date-fns';
import { Field } from '@shared/ui/field';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@shared/ui/select';
import { useUiStore } from '@shared/store/useUiStore';
import { useNavigate } from 'react-router-dom';
import { CurrencySelector } from '@features/currencies/ui/CurrencySelector';
import { useAddAccount } from '@entities/account/api/useAccounts';
import { getAccountTypesByBudgetType, isLiabilityType } from '@entities/account/model/accountTypes';
import { usePlainNumberFormatter } from '@shared/hooks/useNumberFormatter';
import { roundToFractionDigits } from '@shared/lib/currency/round-amount';
import { fromDecimal, toDecimal, ZERO_MILLI, type MilliUnits } from '@shared/lib/currency/milli';
import { isCryptoCurrency } from '@budgero/core/browser';
import { toastError } from '@shared/lib/errors';
import { OnBudgetToggle } from './OnBudgetToggle';
import { LiabilityNumberCell } from './LiabilityNumberCell';

interface AddAccountDialogProps {
  renderTrigger?: (open: () => void) => React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onSuccess?: (accountId: number) => void;
}

export function AddAccountDialog({
  renderTrigger,
  open: controlOpen,
  onOpenChange,
  onSuccess,
}: AddAccountDialogProps = {}) {
  const { t } = useLingui();

  const { selectedBudget, globalLocalizer } = useUiStore();
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlOpen ?? internalOpen;
  const handleOpenChange = (next: boolean) => {
    if (controlOpen === undefined) {
      setInternalOpen(next);
    }
    onOpenChange?.(next);
  };
  const [name, setName] = useState('');
  const [accType, setAccType] = useState('');
  const [currency, setCurrency] = useState(selectedBudget?.DisplayCurrency || 'USD');
  // Starting balance / paid-so-far, in milliunits (CalculatorCell speaks MilliUnits)
  const [balance, setBalance] = useState<MilliUnits>(ZERO_MILLI);
  const [onBudget, setOnBudget] = useState(true);
  // Liability metadata (optional) — money fields are held as DECIMAL form
  // state and converted with fromDecimal at the submit boundary.
  const [isLiability, setIsLiability] = useState(false);
  const [debtTotal, setDebtTotal] = useState(0); // decimal currency units
  const [interestRate, setInterestRate] = useState(0); // Annual %
  const [computedMinPayment, setComputedMinPayment] = useState<number | null>(null); // decimal
  const [minPayment, setMinPayment] = useState(0); // credit cards only, decimal
  const [startDate, setStartDate] = useState(''); // YYYY-MM-DD
  const [targetDate, setTargetDate] = useState('');
  const [termYears, setTermYears] = useState(0);
  const [isBalanceEditing, setIsBalanceEditing] = useState(false);

  // Create a formatter that uses the selected account currency but respects global locale settings
  const accountCurrencyFormatter = React.useMemo(() => {
    const resolvedOptions = globalLocalizer.resolvedOptions();
    try {
      return new Intl.NumberFormat(resolvedOptions.locale, {
        style: 'currency',
        currency,
        currencyDisplay: currencyDisplayFor(currency),
        minimumFractionDigits: resolvedOptions.minimumFractionDigits,
        maximumFractionDigits: resolvedOptions.maximumFractionDigits,
      });
    } catch {
      // Non-ISO codes (crypto tickers) — plain decimals with a code suffix.
      const base = new Intl.NumberFormat(resolvedOptions.locale, {
        maximumFractionDigits: 8,
      });
      return {
        format: (value: number) => `${base.format(value)} ${currency.toUpperCase()}`,
        resolvedOptions: () => base.resolvedOptions(),
        formatToParts: (value?: number) => base.formatToParts(value ?? 0),
      } as Intl.NumberFormat;
    }
  }, [globalLocalizer, currency]);

  // Plain number formatter for non-currency fields (respects locale decimal/grouping)
  const plainNumberFormatter = usePlainNumberFormatter(globalLocalizer);

  const navigate = useNavigate();

  const addAccountMutation = useAddAccount();

  // Recompute suggested minimum monthly payment whenever inputs change
  React.useEffect(() => {
    // Only auto-calc min payment for loans/mortgages
    if (!isLiability || accType === 'Credit') {
      setComputedMinPayment(null);
      return;
    }
    // Decimal math throughout: debtTotal is decimal form state, balance is milli.
    const principal = Math.max(0, debtTotal - toDecimal(balance));
    const mRate = interestRate > 0 ? interestRate / 100 / 12 : 0;
    let months = 0;
    if (targetDate) {
      months = Math.max(1, differenceInMonths(parseISO(targetDate), new Date()));
    } else if (termYears > 0) {
      const totalMonths = Math.max(1, Math.round(termYears * 12));
      if (startDate) {
        const elapsed = Math.max(0, differenceInMonths(new Date(), parseISO(startDate)));
        months = Math.max(1, totalMonths - elapsed);
      } else {
        months = totalMonths;
      }
    }
    if (principal > 0 && months > 0) {
      const mp =
        mRate > 0 ? (principal * mRate) / (1 - (1 + mRate) ** -months) : principal / months;
      setComputedMinPayment(roundToFractionDigits(mp, 2));
    } else {
      setComputedMinPayment(null);
    }
  }, [isLiability, accType, debtTotal, balance, interestRate, targetDate, termYears, startDate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!accType) {
      return;
    }

    // If calculator sheet is open, wait for it to close first
    if (isBalanceEditing) {
      // Blur any focused input to trigger sheet close
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
      // Wait a tick for the sheet to close
      await new Promise((resolve) => setTimeout(resolve, 150));
    }

    try {
      let metadata;

      if (isLiabilityType(accType)) {
        // Money metadata fields are stored in milliunits; convert decimal form
        // state exactly once here at the submit boundary.
        metadata = {
          liability: true,
          liability_type: accType.toLowerCase(),
          debt_total: debtTotal > 0 ? fromDecimal(debtTotal) : undefined,
          interest_rate_annual: interestRate > 0 ? interestRate : undefined,
          min_payment_monthly:
            accType === 'Credit'
              ? minPayment > 0
                ? fromDecimal(minPayment)
                : undefined
              : computedMinPayment !== null
                ? fromDecimal(computedMinPayment)
                : undefined,
          start_date: accType === 'Credit' ? undefined : startDate || undefined,
          target_date: accType === 'Credit' ? undefined : targetDate || undefined,
          term_years: accType === 'Credit' ? undefined : termYears > 0 ? termYears : undefined,
          payment_frequency: 'monthly',
          paid_so_far: balance || undefined,
        };
      }

      const newAccount = await addAccountMutation.mutateAsync({
        name,
        budget_id: selectedBudget?.ID || 0,
        type: accType,
        currency,
        balance,
        metadata,
        on_budget: onBudget,
      });

      toast.success(t`Account created`, {
        description: t`${name} has been added successfully.`,
      });

      // Reset the form and close the modal first
      setName('');
      setAccType('');
      setCurrency(selectedBudget?.DisplayCurrency || 'USD');
      setBalance(ZERO_MILLI);
      handleOpenChange(false);

      // Navigate after modal closes to avoid sheet conflicts
      if (newAccount?.ID) {
        // Delay to let sheets/dialogs unmount properly
        setTimeout(() => {
          if (onSuccess) {
            onSuccess(newAccount.ID);
          } else {
            void navigate(`/accounts/${newAccount.ID}`);
          }
        }, 300);
      }
    } catch (error) {
      console.error('Failed to add account:', error);
      toastError('Failed to create account', error, 'Please try again.');
    }
  };

  return (
    <>
      {renderTrigger ? (
        renderTrigger(() => handleOpenChange(true))
      ) : (
        <button
          className="flex w-full items-center px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground cursor-default rounded-sm"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            handleOpenChange(true);
          }}
          data-testid="add-account-trigger"
        >
          <Trans>
            <Plus className="h-4 w-4 mr-2" />
            New Account
          </Trans>
        </button>
      )}
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent
          className="p-4 sm:p-6 text-sm sm:text-base max-h-[min(92vh,calc(100dvh-2rem))] overflow-y-auto"
          onPointerDownOutside={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
          data-testid="add-account-modal"
        >
          <DialogHeader>
            <DialogTitle className="text-base sm:text-lg">
              <Trans>Add New Account</Trans>
            </DialogTitle>
            <DialogDescription className="text-xs sm:text-sm">
              <Trans>Fill in the details below to create a new account.</Trans>
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={handleSubmit}
            className="space-y-3 sm:space-y-4"
            // Click handling only shields the dropdown-rendered trigger from
            // bubbled clicks — the form itself is not an interactive target.
            role="presentation"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="grid gap-3 sm:gap-4">
              {/* Account Name */}
              <Field label={t`Account Name`} htmlFor="accountName" className="space-y-1">
                <Input
                  className="h-8 sm:h-9"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t`Enter account name`}
                  required
                  data-testid="account-name-input"
                />
              </Field>
              {/* On/Off Budget Toggle */}
              <OnBudgetToggle
                onBudget={onBudget}
                setOnBudget={setOnBudget}
                accType={accType}
                setAccType={setAccType}
                setIsLiability={setIsLiability}
                switchTestId="account-on-budget-switch"
              />

              {/* Account Type */}
              <Field
                label={t`Account Type`}
                htmlFor="accountType"
                className="space-y-1"
                hint={
                  <span className="hidden sm:block">
                    {onBudget
                      ? t`Showing account types that can affect your budget`
                      : t`Showing account types for net worth tracking`}
                  </span>
                }
              >
                <Select
                  value={accType}
                  onValueChange={(val) => {
                    setAccType(val);
                    setIsLiability(isLiabilityType(val));
                    if (val === 'Mortgage' && termYears === 0) {
                      setTermYears(30);
                    }
                    // Crypto accounts hold coins, not the budget's fiat:
                    // default the currency accordingly (and back again), and
                    // default to tracking-only — market swings shouldn't move
                    // Ready to Assign unless the user opts in via the toggle.
                    if (val === 'Crypto' && !isCryptoCurrency(currency)) {
                      setCurrency('BTC');
                      setOnBudget(false);
                    } else if (val !== 'Crypto' && isCryptoCurrency(currency)) {
                      setCurrency(selectedBudget?.DisplayCurrency || 'USD');
                    }

                    // Note: We don't override the budget setting here since the dropdown is already filtered
                  }}
                >
                  <SelectTrigger size="sm" className="w-full" data-testid="account-type-select">
                    <SelectValue placeholder={t`Select account type`} />
                  </SelectTrigger>
                  <SelectContent>
                    {getAccountTypesByBudgetType(onBudget ? 'on' : 'off').map((type) => (
                      <SelectItem key={type} value={type}>
                        <AccountTypeLabel type={type} />
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              {/* Liability Details */}
              {isLiability && (
                <div className="grid gap-2 sm:gap-3 p-2 sm:p-3 rounded-md border border-border/50 bg-muted/20">
                  <div className="text-xs text-muted-foreground">
                    <Trans>Liability details</Trans>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3">
                    <Field
                      label={t`Original Debt`}
                      htmlFor="debtTotal"
                      className="space-y-1"
                      help={
                        <p>
                          <Trans>Total amount borrowed at origination. Required.</Trans>
                        </p>
                      }
                    >
                      <LiabilityNumberCell
                        value={debtTotal}
                        onCommit={setDebtTotal}
                        placeholder="e.g. 250000"
                        localizer={plainNumberFormatter}
                      />
                    </Field>
                    <Field
                      label={t`Interest % (APR)`}
                      htmlFor="interestRate"
                      className="space-y-1"
                      help={
                        <p>
                          <Trans>Annual percentage rate, e.g., 5 for 5%.</Trans>
                        </p>
                      }
                    >
                      <LiabilityNumberCell
                        value={interestRate}
                        onCommit={setInterestRate}
                        placeholder="e.g. 5.25"
                        localizer={plainNumberFormatter}
                      />
                    </Field>
                  </div>
                  {accType === 'Credit' ? (
                    <div className="grid grid-cols-1 gap-2 sm:gap-3">
                      <Field
                        label={t`Minimum Monthly Payment`}
                        htmlFor="minPayment"
                        className="space-y-1"
                        help={
                          <p>
                            <Trans>Enter your card’s minimum payment from statements.</Trans>
                          </p>
                        }
                      >
                        <LiabilityNumberCell
                          value={minPayment}
                          onCommit={setMinPayment}
                          placeholder="e.g. 35.00"
                          localizer={plainNumberFormatter}
                        />
                      </Field>
                    </div>
                  ) : (
                    <>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3">
                        {/* Computed Minimum Monthly Payment (read-only) */}
                        <Field label={t`Min. Monthly Payment (calculated)`} className="space-y-1">
                          <Input
                            className="h-8 sm:h-9"
                            value={computedMinPayment !== null ? computedMinPayment.toFixed(2) : ''}
                            placeholder={t`Select target date to calculate`}
                            disabled
                          />
                        </Field>
                        <Field
                          label={t`Start Date`}
                          htmlFor="startDate"
                          className="space-y-1"
                          help={
                            <p>
                              <Trans>Date the loan started or was disbursed.</Trans>
                            </p>
                          }
                        >
                          <DatePickerButton value={startDate} onChange={setStartDate} />
                        </Field>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3">
                        <Field
                          label={t`Original Term (years)`}
                          htmlFor="termYears"
                          className="space-y-1"
                          help={
                            <p>
                              <Trans>Total loan duration (e.g., 30 for mortgages, up to 40).</Trans>
                            </p>
                          }
                        >
                          <LiabilityNumberCell
                            value={termYears}
                            onCommit={setTermYears}
                            placeholder={accType === 'Mortgage' ? '30' : 'e.g. 7'}
                            localizer={plainNumberFormatter}
                          />
                        </Field>
                        <div />
                      </div>
                    </>
                  )}
                  {accType !== 'Credit' && (
                    <Field
                      label={t`Target Payoff Date (optional)`}
                      htmlFor="targetDate"
                      className="space-y-1"
                      help={
                        <p>
                          <Trans>Your desired payoff date, used for planning.</Trans>
                        </p>
                      }
                    >
                      <DatePickerButton value={targetDate} onChange={setTargetDate} />
                    </Field>
                  )}
                </div>
              )}
              {/* Currency handling */}
              <div>
                <CurrencySelector
                  value={currency}
                  onValueChange={setCurrency}
                  kind={accType === 'Crypto' ? 'crypto' : 'fiat'}
                  data-testid="account-currency-select"
                />
              </div>
              {/* Balance / Value Field */}
              <Field
                label={isLiability ? t`Paid So Far (optional)` : t`Starting Balance`}
                htmlFor="balance"
                className="space-y-1"
                help={
                  <p>
                    {isLiability
                      ? t`Amount already repaid on this debt.`
                      : t`Opening balance for this account.`}
                  </p>
                }
              >
                <div>
                  <CalculatorCell
                    value={balance}
                    onCommit={setBalance}
                    currencyCode={currency}
                    formatter={accountCurrencyFormatter.format}
                    localizer={accountCurrencyFormatter}
                    inputAlign="left"
                    placeholder={isLiability ? t`e.g. amount you have already paid` : '0.00'}
                    zeroAsEmpty
                    useFormatterForDisplay
                    onEditingChange={setIsBalanceEditing}
                    displayClassName="h-8 sm:h-9 flex items-center rounded-md border border-input bg-background px-3 text-sm"
                    inputClassName="h-8 sm:h-9"
                    data-testid="account-balance-input"
                  />
                </div>
              </Field>
              <div className="w-full justify-center">
                {!accType ? (
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button size="sm" type="button" className="opacity-50 cursor-not-allowed">
                        <Trans>Add Account</Trans>
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-3" side="top">
                      <p className="text-sm">
                        <Trans>Please select an account type first</Trans>
                      </p>
                    </PopoverContent>
                  </Popover>
                ) : (
                  <Button
                    size="sm"
                    type="submit"
                    disabled={addAccountMutation.isPending}
                    data-testid="add-account-submit"
                  >
                    {addAccountMutation.isPending ? t`Adding...` : t`Add Account`}
                  </Button>
                )}
              </div>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
