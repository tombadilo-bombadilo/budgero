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
    return new Intl.NumberFormat(resolvedOptions.locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: resolvedOptions.minimumFractionDigits,
      maximumFractionDigits: resolvedOptions.maximumFractionDigits,
    });
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

      toast.success('Account created', {
        description: `${name} has been added successfully.`,
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
          <Plus className="h-4 w-4 mr-2" />
          New Account
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
            <DialogTitle className="text-base sm:text-lg">Add New Account</DialogTitle>
            <DialogDescription className="text-xs sm:text-sm">
              Fill in the details below to create a new account.
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
              <Field label="Account Name" htmlFor="accountName" className="space-y-1">
                <Input
                  className="h-8 sm:h-9"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Enter account name"
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
                label="Account Type"
                htmlFor="accountType"
                className="space-y-1"
                hint={
                  <span className="hidden sm:block">
                    {onBudget
                      ? 'Showing account types that can affect your budget'
                      : 'Showing account types for net worth tracking'}
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

                    // Note: We don't override the budget setting here since the dropdown is already filtered
                  }}
                >
                  <SelectTrigger size="sm" className="w-full" data-testid="account-type-select">
                    <SelectValue placeholder="Select account type" />
                  </SelectTrigger>
                  <SelectContent>
                    {getAccountTypesByBudgetType(onBudget ? 'on' : 'off').map((type) => (
                      <SelectItem key={type} value={type}>
                        {type}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              {/* Liability Details */}
              {isLiability && (
                <div className="grid gap-2 sm:gap-3 p-2 sm:p-3 rounded-md border border-border/50 bg-muted/20">
                  <div className="text-xs text-muted-foreground">Liability details</div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3">
                    <Field
                      label="Original Debt"
                      htmlFor="debtTotal"
                      className="space-y-1"
                      help={<p>Total amount borrowed at origination. Required.</p>}
                    >
                      <LiabilityNumberCell
                        value={debtTotal}
                        onCommit={setDebtTotal}
                        placeholder="e.g. 250000"
                        localizer={plainNumberFormatter}
                      />
                    </Field>
                    <Field
                      label="Interest % (APR)"
                      htmlFor="interestRate"
                      className="space-y-1"
                      help={<p>Annual percentage rate, e.g., 5 for 5%.</p>}
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
                        label="Minimum Monthly Payment"
                        htmlFor="minPayment"
                        className="space-y-1"
                        help={<p>Enter your card’s minimum payment from statements.</p>}
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
                        <Field label="Min. Monthly Payment (calculated)" className="space-y-1">
                          <Input
                            className="h-8 sm:h-9"
                            value={computedMinPayment !== null ? computedMinPayment.toFixed(2) : ''}
                            placeholder="Select target date to calculate"
                            disabled
                          />
                        </Field>
                        <Field
                          label="Start Date"
                          htmlFor="startDate"
                          className="space-y-1"
                          help={<p>Date the loan started or was disbursed.</p>}
                        >
                          <DatePickerButton value={startDate} onChange={setStartDate} />
                        </Field>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3">
                        <Field
                          label="Original Term (years)"
                          htmlFor="termYears"
                          className="space-y-1"
                          help={<p>Total loan duration (e.g., 30 for mortgages, up to 40).</p>}
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
                      label="Target Payoff Date (optional)"
                      htmlFor="targetDate"
                      className="space-y-1"
                      help={<p>Your desired payoff date, used for planning.</p>}
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
                  data-testid="account-currency-select"
                />
              </div>
              {/* Balance / Value Field */}
              <Field
                label={isLiability ? 'Paid So Far (optional)' : 'Starting Balance'}
                htmlFor="balance"
                className="space-y-1"
                help={
                  <p>
                    {isLiability
                      ? 'Amount already repaid on this debt.'
                      : 'Opening balance for this account.'}
                  </p>
                }
              >
                <div>
                  <CalculatorCell
                    value={balance}
                    onCommit={setBalance}
                    formatter={accountCurrencyFormatter.format}
                    localizer={accountCurrencyFormatter}
                    inputAlign="left"
                    placeholder={isLiability ? 'e.g. amount you have already paid' : '0.00'}
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
                        Add Account
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-3" side="top">
                      <p className="text-sm">Please select an account type first</p>
                    </PopoverContent>
                  </Popover>
                ) : (
                  <Button
                    size="sm"
                    type="submit"
                    disabled={addAccountMutation.isPending}
                    data-testid="add-account-submit"
                  >
                    {addAccountMutation.isPending ? 'Adding...' : 'Add Account'}
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
