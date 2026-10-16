import { AccountTypeLabel } from '@entities/account/ui/AccountTypeLabel';
import { Trans, useLingui } from '@lingui/react/macro';
import React, { useState, useEffect, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from '@shared/ui/dialog';
import { Button } from '@shared/ui/button';
import { Input } from '@shared/ui/input';
import { Field } from '@shared/ui/field';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@shared/ui/select';

import { Edit3 } from 'lucide-react';
import type { Account } from '@budgero/core/browser';
import { isCryptoCurrency } from '@budgero/core/browser';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import {
  useEditAccount,
  useDeleteAccount,
  useSetAccountArchived,
  type AccountCurrencyChangeMode,
} from '@entities/account/api/useAccounts';
import { useAccountTransactionSummary } from '@entities/transaction/api/queries';
import { CurrencySelector } from '@features/currencies/ui/CurrencySelector';
import { roundMilli } from '@shared/lib/currency/round-amount';
import { toDecimal } from '@shared/lib/currency/milli';
import { Popover, PopoverContent, PopoverTrigger } from '@shared/ui/popover';
import { DatePickerButton } from '@shared/ui/DatePickerButton';
import { parseISO, differenceInMonths } from 'date-fns';
import { getAccountTypesByBudgetType, isLiabilityType } from '@entities/account/model/accountTypes';
import { useUiStore } from '@shared/store/useUiStore';
import { usePlainNumberFormatter } from '@shared/hooks/useNumberFormatter';
import { toastError } from '@shared/lib/errors';
import { OnBudgetToggle } from './OnBudgetToggle';
import { ArchiveAccountDialog } from './ArchiveAccountDialog';
import { LiabilityNumberCell } from './LiabilityNumberCell';
import { AccountCurrencyChangeDialog } from './AccountCurrencyChangeDialog';
import {
  liabilityFormFromMetadata,
  mergeLiabilityMetadata,
  parseAccountMetadata,
  resolveMinPayment,
} from '../lib/edit-account-metadata';

interface EditAccountDialogProps {
  selectedAccount: Account | null;
  budgetId: number;
}

interface EditAccountPayload {
  id: number;
  name: string;
  type: string;
  currency: string;
  budget_id: number;
  oldCurrency: string;
  metadata?: Record<string, unknown>;
  onBudget: boolean;
  currencyChangeMode?: AccountCurrencyChangeMode;
}

export function EditAccountDialog({ selectedAccount, budgetId }: EditAccountDialogProps) {
  const { t } = useLingui();

  const [open, setOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [pendingEdit, setPendingEdit] = useState<EditAccountPayload | null>(null);
  const [currencyChangeMode, setCurrencyChangeMode] =
    useState<AccountCurrencyChangeMode>('convert');

  const selectedBudget = useUiStore((state) => state.selectedBudget);

  // Initialize state with safe fallbacks if selectedAccount is null. A
  // missing account currency defaults to the budget's display currency,
  // never a hardcoded USD.
  const [name, setName] = useState(selectedAccount?.Name || '');
  const [accType, setAccType] = useState(selectedAccount?.Type || '');
  const [currency, setCurrency] = useState(
    selectedAccount?.Currency || selectedBudget?.DisplayCurrency || 'USD'
  );
  const [onBudget, setOnBudget] = useState(selectedAccount?.OnBudget ?? true);
  // Stored metadata and the form values it started from; an edit merges only
  // the fields that differ from these back into it.
  const initialMd = useMemo(
    () => parseAccountMetadata(selectedAccount?.Metadata),
    [selectedAccount?.Metadata]
  );
  const initialForm = useMemo(() => liabilityFormFromMetadata(initialMd), [initialMd]);
  const [isLiability, setIsLiability] = useState(
    Boolean(initialMd.liability) || isLiabilityType(selectedAccount?.Type || '')
  );
  // Edited as a DECIMAL amount; stored metadata is milliunits (fromDecimal at submit).
  const [debtTotal, setDebtTotal] = useState<number>(initialForm.debtTotal);
  const [interestRate, setInterestRate] = useState<number>(initialForm.interestRate);
  const [startDate, setStartDate] = useState(initialForm.startDate);
  const [targetDate, setTargetDate] = useState(initialForm.targetDate);

  const editAccountMutation = useEditAccount();
  const deleteAccountMutation = useDeleteAccount();
  const setArchivedMutation = useSetAccountArchived();
  const { data: transactionSummary, isLoading: isTransactionSummaryLoading } =
    useAccountTransactionSummary(selectedAccount?.ID || 0, undefined, undefined, open);

  const navigate = useNavigate();
  const { globalLocalizer } = useUiStore();

  // Plain number formatter for non-currency fields (respects locale decimal/grouping)
  const plainNumberFormatter = usePlainNumberFormatter(globalLocalizer);

  // Ensure form state reflects the latest account data whenever the dialog opens.
  useEffect(() => {
    if (!open) {
      return;
    }
    void Promise.resolve().then(() => {
      setName(selectedAccount?.Name || '');
      setAccType(selectedAccount?.Type || '');
      setCurrency(selectedAccount?.Currency || selectedBudget?.DisplayCurrency || 'USD');
      setOnBudget(selectedAccount?.OnBudget ?? true);
      setIsLiability(Boolean(initialMd.liability) || isLiabilityType(selectedAccount?.Type || ''));
      setDebtTotal(initialForm.debtTotal);
      setInterestRate(initialForm.interestRate);
      setStartDate(initialForm.startDate);
      setTargetDate(initialForm.targetDate);
    });
  }, [open, selectedAccount, selectedBudget?.DisplayCurrency, initialMd, initialForm]);

  // Close-related cleanup to avoid stale confirmation state on re-open.
  // Uses React-approved "adjusting state when prop changes" pattern
  // See: https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
  const [prevOpen, setPrevOpen] = useState(open);
  if (prevOpen && !open) {
    // Dialog just closed
    setPrevOpen(open);
    if (pendingEdit !== null) setPendingEdit(null);
    if (confirmOpen) setConfirmOpen(false);
  } else if (prevOpen !== open) {
    setPrevOpen(open);
  }

  // Derive suggested minimum monthly payment based on remaining balance, APR
  // and target date. Account.BalanceNative is milliunits, so `mp` is a float in
  // milli-space that rounds back to an exact MilliUnits amount.
  const computedMinPayment = useMemo(() => {
    if (!isLiability) {
      return null;
    }
    const outstanding = Math.abs(selectedAccount?.BalanceNative ?? 0);
    const mRate = interestRate > 0 ? interestRate / 100 / 12 : 0;
    const months = targetDate
      ? Math.max(1, differenceInMonths(parseISO(targetDate), new Date()))
      : 0;
    if (outstanding > 0 && months > 0) {
      let mp: number;
      if (mRate > 0) {
        mp = (outstanding * mRate) / (1 - (1 + mRate) ** -months);
      } else {
        mp = outstanding / months;
      }
      return roundMilli(mp);
    }
    return null;
  }, [isLiability, selectedAccount?.BalanceNative, interestRate, targetDate]);

  const formFields = { debtTotal, interestRate, startDate, targetDate };
  // What the min-payment field shows is what Apply stores.
  const shownMinPayment = isLiability
    ? resolveMinPayment(initialMd, initialForm, formFields, computedMinPayment)
    : undefined;

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!accType) {
      return;
    }

    if (selectedAccount) {
      let nextMetadata;

      if (isLiabilityType(accType) || isLiability) {
        nextMetadata = mergeLiabilityMetadata(
          initialMd,
          accType,
          initialForm,
          formFields,
          computedMinPayment
        );
      }
      const targetCurrency = currency;

      const payload = {
        id: selectedAccount.ID,
        name,
        type: accType,
        currency: targetCurrency,
        budget_id: budgetId,
        oldCurrency: selectedAccount.Currency,
        metadata: nextMetadata,
        onBudget,
      };

      const isCurrencyChanging = selectedAccount.Currency !== targetCurrency;
      if (isCurrencyChanging) {
        setCurrencyChangeMode('convert');
        setPendingEdit(payload);
        setConfirmOpen(true);
        return;
      }

      editAccountMutation.mutate(payload, {
        onSuccess: () => {
          toast.success(t`Account updated`, {
            description: t`${name} has been updated successfully.`,
          });
          setOpen(false);
        },
        onError: (error) => {
          toastError('Failed to update account', error, 'Please try again.');
        },
      });
    }
  };

  const proceedCurrencyChange = () => {
    if (pendingEdit) {
      editAccountMutation.mutate(
        { ...pendingEdit, currencyChangeMode },
        {
          onSuccess: () => {
            toast.success(t`Account updated`, {
              description: t`Account currency has been changed successfully.`,
            });
            setPendingEdit(null);
            setConfirmOpen(false);
            setOpen(false);
          },
          onError: (error) => {
            toastError('Failed to update account currency', error, 'Please try again.');
          },
        }
      );
    }
  };

  const handleUnarchive = async () => {
    if (!selectedAccount) return;
    try {
      await setArchivedMutation.mutateAsync({
        id: selectedAccount.ID,
        budget_id: budgetId,
        archived: false,
      });
      toast.success(t`Account unarchived`, {
        description: t`${selectedAccount.Name} is visible again.`,
      });
      setOpen(false);
    } catch (error) {
      toastError('Failed to unarchive account', error, 'Please try again.');
    }
  };

  const handleDelete = async () => {
    if (!transactionSummary) {
      toast.info(t`Still checking this account`, {
        description: t`Please try again in a moment.`,
      });
      return;
    }
    const transactionCount = transactionSummary.TransactionCount;

    if (transactionCount > 0) {
      toast.error(t`Cannot delete account with transactions!`, {
        description: t`This account has ${transactionCount} transaction(s). Please move or delete all transactions first.`,
      });
      return;
    }

    if (selectedAccount?.BalanceNative !== 0) {
      toast.error(t`You can't delete an account with a non-zero balance!`, {
        description: t`Please move or delete all transactions from this account first.`,
      });
      return;
    }

    if (selectedAccount !== null) {
      deleteAccountMutation.mutate(
        {
          id: selectedAccount.ID,
          budget_id: budgetId,
        },
        {
          onSuccess: () => {
            toast.success(t`Account deleted`, {
              description: t`${selectedAccount.Name} has been permanently removed.`,
            });
            setOpen(false);
            // Navigate to the user's home page after deletion to avoid landing
            // on a now-missing account page. '/' resolves to the configured home.
            void navigate('/');
          },
          onError: (error) => {
            toastError('Failed to delete account', error, 'Please try again.');
          },
        }
      );
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button variant="ghost" size="icon">
            <Edit3 />
          </Button>
        </DialogTrigger>

        <DialogContent className="p-4 sm:p-6 text-sm sm:text-base max-h-[min(92vh,calc(100dvh-2rem))] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-base sm:text-lg">
              <Trans>Edit Account</Trans>
            </DialogTitle>
            <DialogDescription className="text-xs sm:text-sm">
              <Trans>Fill in the details below to edit this account.</Trans>
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleEdit} className="space-y-3 sm:space-y-4">
            <div className="grid gap-3 sm:gap-4">
              {/* Account Name */}
              <Field label={t`Account Name`} htmlFor="accountName" className="space-y-1">
                <Input
                  className="h-8 sm:h-9"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t`Enter account name`}
                  required
                />
              </Field>

              {/* On/Off Budget Toggle */}
              <OnBudgetToggle
                onBudget={onBudget}
                setOnBudget={setOnBudget}
                accType={accType}
                setAccType={setAccType}
                setIsLiability={setIsLiability}
              />

              {/* Account Type */}
              <Field label={t`Account Type`} htmlFor="accountType" className="space-y-1">
                <Select
                  value={accType}
                  onValueChange={(val) => {
                    setAccType(val);
                    setIsLiability(isLiabilityType(val));
                    // Crypto accounts hold coins, not the budget's fiat:
                    // default the currency accordingly (and back again).
                    if (val === 'Crypto' && !isCryptoCurrency(currency)) {
                      setCurrency('BTC');
                    } else if (val !== 'Crypto' && isCryptoCurrency(currency)) {
                      setCurrency(
                        selectedAccount?.Currency && !isCryptoCurrency(selectedAccount.Currency)
                          ? selectedAccount.Currency
                          : selectedBudget?.DisplayCurrency || 'USD'
                      );
                    }

                    // Note: We don't override the budget setting here since the dropdown is already filtered
                  }}
                >
                  <SelectTrigger size="sm" className="w-full">
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
                    <Field label={t`Original Debt`} htmlFor="debtTotal" className="space-y-1">
                      <LiabilityNumberCell
                        value={debtTotal}
                        onCommit={setDebtTotal}
                        placeholder="e.g. 250000"
                        localizer={plainNumberFormatter}
                      />
                    </Field>
                    <Field label={t`Interest % (APR)`} htmlFor="interestRate" className="space-y-1">
                      <LiabilityNumberCell
                        value={interestRate}
                        onCommit={setInterestRate}
                        placeholder="e.g. 5.25"
                        localizer={plainNumberFormatter}
                      />
                    </Field>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3">
                    <Field label={t`Min. Monthly Payment (calculated)`} className="space-y-1">
                      <Input
                        className="h-8 sm:h-9"
                        value={
                          shownMinPayment !== undefined ? toDecimal(shownMinPayment).toFixed(2) : ''
                        }
                        placeholder={t`Select target date to calculate`}
                        disabled
                      />
                    </Field>
                    <Field label={t`Start Date`} htmlFor="startDate" className="space-y-1">
                      <DatePickerButton value={startDate} onChange={setStartDate} />
                    </Field>
                  </div>
                  <Field
                    label={t`Target Payoff Date (optional)`}
                    htmlFor="targetDate"
                    className="space-y-1"
                  >
                    <DatePickerButton value={targetDate} onChange={setTargetDate} />
                  </Field>
                </div>
              )}

              {/* Currency display */}
              <CurrencySelector
                value={currency}
                onValueChange={setCurrency}
                kind={accType === 'Crypto' ? 'crypto' : 'fiat'}
              />
              {isLiability && (
                <div className="rounded-md bg-muted/20 border border-border/50 p-2 text-[11px] text-muted-foreground">
                  <Trans>
                    Paid So Far should be edited via transactions (inflows). Here you can adjust
                    metadata like Original Debt, APR and dates.
                  </Trans>
                </div>
              )}
            </div>

            {/* Buttons */}
            <div className="flex items-center justify-between">
              <div className="space-x-2">
                <Button
                  type="button"
                  variant="destructive"
                  className="h-8 sm:h-9"
                  onClick={handleDelete}
                  disabled={deleteAccountMutation.isPending || isTransactionSummaryLoading}
                >
                  {deleteAccountMutation.isPending ? t`Deleting...` : t`Delete`}
                </Button>
                {selectedAccount?.Archived ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="h-8 sm:h-9"
                    onClick={handleUnarchive}
                    disabled={setArchivedMutation.isPending}
                  >
                    {setArchivedMutation.isPending ? t`Unarchiving...` : t`Unarchive`}
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    className="h-8 sm:h-9"
                    onClick={() => setArchiveOpen(true)}
                  >
                    <Trans>Archive</Trans>
                  </Button>
                )}
              </div>

              {/* Right side: Cancel & Apply */}
              <div className="space-x-2">
                <Button
                  type="button"
                  variant="outline"
                  className="h-8 sm:h-9"
                  onClick={() => setOpen(false)}
                >
                  <Trans>Cancel</Trans>
                </Button>
                {!accType ? (
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button className="h-8 sm:h-9 opacity-50 cursor-not-allowed" type="button">
                        <Trans>Apply</Trans>
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
                    className="h-8 sm:h-9"
                    type="submit"
                    disabled={editAccountMutation.isPending}
                  >
                    {editAccountMutation.isPending ? t`Saving...` : t`Apply`}
                  </Button>
                )}
              </div>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      {/* Confirmation dialog for currency change */}
      <AccountCurrencyChangeDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        accountName={selectedAccount?.Name || 'this account'}
        oldCurrency={selectedAccount?.Currency || ''}
        newCurrency={currency}
        mode={currencyChangeMode}
        onModeChange={setCurrencyChangeMode}
        hasLinkedTransfers={Boolean(transactionSummary?.TransferTransactionCount)}
        isLoading={editAccountMutation.isPending}
        onConfirm={proceedCurrencyChange}
      />
      {selectedAccount && (
        <ArchiveAccountDialog
          account={selectedAccount}
          budgetId={budgetId}
          open={archiveOpen}
          onOpenChange={setArchiveOpen}
          onArchived={() => setOpen(false)}
        />
      )}
    </>
  );
}
