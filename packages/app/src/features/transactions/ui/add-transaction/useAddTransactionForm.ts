/**
 * useAddTransactionForm Hook
 *
 * Custom hook that wraps and consolidates form state for the AddTransactionForm.
 * Combines the base useTransactionForm hook with additional local state and derived values.
 */

import * as React from 'react';
import { toast } from 'sonner';

import { useConnectivity } from '@shared/hooks/useConnectivity';
import { useTransactionForm } from '@features/transactions/api/useTransactionForm';
import { getExchangeRate, getLocalOrManualRate } from '@entities/currency/lib/currency-utils';
import { useUiStore } from '@shared/store/useUiStore';
import { useCategories } from '@entities/category/api/useCategories';
import { useUpsertSplits } from '@entities/transaction/api/useTransactions';
import { useActiveAccounts } from '@entities/account/api/useActiveAccounts';
import { getMonthKey } from '@shared/lib/date-utils';
import { roundMilli } from '@shared/lib/currency/round-amount';
import { useAutofillIntegration } from './useAutofillIntegration';

import type { SplitLine } from '../form';
import {
  convertAmountToFlow,
  validateTransaction,
  validateSplitTotal,
  generateTransferId,
  formatTransferMemo,
  getCurrentDate,
  getCurrentMonth,
  calculateSplitRemaining,
} from './add-transaction.utils';

export interface UseAddTransactionFormOptions {
  budgetId: number;
  selectedAccountId?: number;
  onAddTransaction: (
    date: Date | null,
    category: string,
    memo: string,
    payee: string,
    outflow: number, // milliunits
    inflow: number, // milliunits
    accountId: number,
    labelId: number | null,
    transferId: string | null,
    keepDialogOpen?: boolean
  ) => Promise<number>;
  onCancel: () => void;
}

export function useAddTransactionForm({
  budgetId,
  selectedAccountId,
  onAddTransaction,
  onCancel,
}: UseAddTransactionFormOptions) {
  const upsertSplits = useUpsertSplits();
  const form = useTransactionForm({ selectedAccountId });

  // Destructure setters for use in effects (stable references)
  const {
    setPayee,
    setCategory,
    setFromAccount,
    setLabelId,
    setConvertedAmount,
    setLoadingRate,
    setPendingRatePair,
    setShowRatePrompt,
    previousTransactionType,
  } = form;

  // Split mode state (kept local as it's UI-specific)
  const [isSplit, setIsSplit] = React.useState(false);
  const [splitLines, setSplitLines] = React.useState<SplitLine[]>([]);

  // Track the resolved exchange rate for the currency conversion notice
  const [resolvedRate, setResolvedRate] = React.useState<number | null>(null);

  const { data: categories = [], isLoading: categoriesLoading } = useCategories(budgetId);
  // Hide archived accounts from the add-transaction picker; they remain visible in history.
  const { data: accounts, isLoading: accountsLoading } = useActiveAccounts(budgetId);

  const { clerkToken, apiReachable } = useConnectivity();
  const canUseCurrencyApi = clerkToken && apiReachable;

  const selectedBudget = useUiStore((state) => state.selectedBudget);
  const globalLocalizer = useUiStore((state) => state.globalLocalizer);

  const selectedAccount = React.useMemo(() => {
    return accounts.find((acc) => acc.ID.toString() === form.selectedFromAccount);
  }, [accounts, form.selectedFromAccount]);

  const toAccount = React.useMemo(() => {
    if (form.isTransfer && form.selectedToAccount) {
      return accounts.find((acc) => acc.ID.toString() === form.selectedToAccount);
    }
    return null;
  }, [form.isTransfer, form.selectedToAccount, accounts]);

  // Amounts are entered in the ACCOUNT's currency (accounts can differ from
  // the budget's display currency). When no account is selected yet — or a
  // legacy account has an empty Currency — fall back to the budget's display
  // currency, never a hardcoded USD.
  const currencyCode = selectedAccount?.Currency || selectedBudget?.DisplayCurrency || 'USD';

  const needsCurrencyConversion = React.useMemo(() => {
    if (!form.isTransfer) return false;
    if (!selectedAccount || !toAccount) return false;
    return selectedAccount.Currency !== toAccount.Currency;
  }, [form.isTransfer, selectedAccount, toAccount]);

  // Detect if this is an on-budget → off-budget transfer
  const isOffBudgetTransfer = React.useMemo(() => {
    if (!form.isTransfer) return false;
    const fromAcc = accounts.find((a) => a.ID.toString() === form.selectedFromAccount);
    const toAcc = accounts.find((a) => a.ID.toString() === form.selectedToAccount);
    return fromAcc?.OnBudget && !toAcc?.OnBudget;
  }, [form.isTransfer, form.selectedFromAccount, form.selectedToAccount, accounts]);

  const totalSplits = React.useMemo(
    () => splitLines.reduce((s, l) => s + (l.amount || 0), 0),
    [splitLines]
  );

  const parentSigned = React.useMemo(() => {
    const amt = form.amount ?? 0;
    return form.isTransfer ? 0 : amt;
  }, [form.isTransfer, form.amount]);

  const remaining = calculateSplitRemaining(form.amount, totalSplits, form.isTransfer);

  // Track the last prefilled state to avoid re-prefilling when user clears fields
  // We store both transaction type AND a key representing the lastUsed data
  const lastPrefillKey = React.useRef<string | null>(null);

  // Prefill with last-used fields - only when transaction type or lastUsed data changes
  React.useEffect(() => {
    if (!form.rememberLast) {
      previousTransactionType.current = form.transactionType;
      return;
    }

    const lu = form.lastUsed[form.transactionType] || {};

    // Create a key that represents the current prefill state
    // This changes when transaction type changes OR when lastUsed data is loaded/updated
    const currentPrefillKey = `${form.transactionType}:${lu.payee || ''}:${lu.category || ''}:${lu.accountId || ''}:${lu.labelId || ''}`;

    // Skip if we've already prefilled with this exact data
    if (lastPrefillKey.current === currentPrefillKey) {
      return;
    }

    // Only mark as prefilled if there's actually data to prefill
    // This ensures we re-run when localStorage loads
    if (lu.payee || lu.category || lu.accountId) {
      lastPrefillKey.current = currentPrefillKey;
    }

    if (lu.payee) setPayee(lu.payee);
    if (!form.isTransfer && !isSplit && lu.category) {
      setCategory(lu.category);
    }
    if (typeof lu.labelId === 'number') {
      setLabelId(lu.labelId);
    } else if (lu.labelId === null) {
      // Remembered "No label" — restore it explicitly so a stale label can't linger.
      setLabelId(null);
    }
    const lastAccount = lu.accountId;
    const previousAccount = form.lastUsed[previousTransactionType.current]?.accountId;
    const shouldApplyLastAccount =
      lastAccount && (!form.selectedFromAccount || form.selectedFromAccount === previousAccount);
    if (shouldApplyLastAccount) {
      setFromAccount(lastAccount);
    }
    previousTransactionType.current = form.transactionType;
  }, [
    form.transactionType,
    form.lastUsed,
    form.rememberLast,
    isSplit,
    form.isTransfer,
    form.selectedFromAccount,
    setPayee,
    setCategory,
    setLabelId,
    setFromAccount,
    previousTransactionType,
  ]);

  React.useEffect(() => {
    if (form.isInflow) {
      const incomeCategory = categories.find((cat) => cat.Name === 'Income');
      if (incomeCategory && !form.selectedCategory) {
        setCategory(incomeCategory.Name);
      }
    }
  }, [form.isInflow, categories, form.selectedCategory, setCategory]);

  React.useEffect(() => {
    if (isOffBudgetTransfer && !form.selectedCategory) {
      const transfersCategory = categories.find((cat) => cat.Name === 'Transfers');
      if (transfersCategory) {
        setCategory(transfersCategory.Name);
      }
    }
  }, [isOffBudgetTransfer, form.selectedCategory, categories, setCategory]);

  React.useEffect(() => {
    if (selectedAccountId) {
      setFromAccount(selectedAccountId.toString());
    }
  }, [selectedAccountId, setFromAccount]);

  React.useEffect(() => {
    async function calculatePreview() {
      if (
        !needsCurrencyConversion ||
        !form.amount ||
        !selectedAccount ||
        !toAccount ||
        !selectedBudget
      ) {
        setConvertedAmount(null);
        setResolvedRate(null);
        return;
      }

      setLoadingRate(true);

      if (!canUseCurrencyApi) {
        const month = getCurrentMonth(form.transactionDate);
        const date = getCurrentDate(form.transactionDate);
        const localOrManual = await getLocalOrManualRate(
          selectedAccount.Currency,
          toAccount.Currency,
          month,
          selectedBudget.ID,
          date
        );
        if (!localOrManual) {
          setPendingRatePair({ from: selectedAccount.Currency, to: toAccount.Currency });
          setShowRatePrompt(true);
          setLoadingRate(false);
          return;
        }
      }

      const currentMonth = getCurrentMonth(form.transactionDate);
      const currentDate = getCurrentDate(form.transactionDate);

      try {
        const rate = await getExchangeRate(
          selectedAccount.Currency,
          toAccount.Currency,
          currentMonth,
          selectedBudget.ID,
          currentDate
        );
        // money × rate leaves float milli-space; round back to exact milliunits
        setConvertedAmount(rate ? roundMilli(form.amount * rate) : null);
        setResolvedRate(rate);
      } catch (error) {
        console.error('Failed to get exchange rate:', error);
        setConvertedAmount(null);
      } finally {
        setLoadingRate(false);
      }
    }

    if (needsCurrencyConversion) {
      void calculatePreview();
    }
  }, [
    form.amount,
    needsCurrencyConversion,
    selectedAccount,
    toAccount,
    form.transactionDate,
    selectedBudget,
    canUseCurrencyApi,
    setConvertedAmount,
    setLoadingRate,
    setPendingRatePair,
    setShowRatePrompt,
  ]);

  const {
    autofillAppliedFields,
    autofillAppliedSuggestions,
    resetAutofillSession,
    logAutofillApplications,
  } = useAutofillIntegration({ form, categories, budgetId, selectedBudget, isSplit });

  // Reset form for "Add Another"
  const resetFormFields = React.useCallback(() => {
    form.setCategory('');
    form.setMemo('');
    form.setPayee('');
    form.setLabelId(null);
    form.setAmount(null);
    form.setAmountTouched(false);
    form.setToAccount('');
    form.setConvertedAmount(null);
    form.incrementAmountNonce();
    form.triggerAmountFocus();
    setIsSplit(false);
    setSplitLines([]);
    resetAutofillSession();
    // Reset prefill tracking so "remember last" can run again
    lastPrefillKey.current = null;
  }, [form, resetAutofillSession]);

  const handleSubmit = React.useCallback(
    async (addAnother = false) => {
      const validation = validateTransaction({
        selectedFromAccount: form.selectedFromAccount,
        selectedToAccount: form.selectedToAccount,
        selectedCategory: form.selectedCategory,
        isTransfer: form.isTransfer,
        isSplit,
      });

      if (!validation.isValid && validation.error) {
        toast.error(validation.error.title, { description: validation.error.description });
        return;
      }

      const { inflow, outflow } = convertAmountToFlow(form.amount, form.transactionType);
      const finalCategory = isSplit ? 'Uncategorized' : form.selectedCategory;

      if (form.transactionType === 'transfer') {
        const fromAccount = accounts.find((acc) => acc.ID.toString() === form.selectedFromAccount);
        const toAcc = accounts.find((acc) => acc.ID.toString() === form.selectedToAccount);
        if (fromAccount && toAcc && selectedBudget) {
          form.setCalculatingTransfer(true);

          try {
            const amt = form.amount ?? 0;
            let inflowAmount = amt;
            const outboundPayee = form.payee || toAcc.Name || '';
            const inboundPayee = form.payee || fromAccount.Name || '';

            if (fromAccount.Currency !== toAcc.Currency) {
              const currentMonth = getCurrentMonth(form.transactionDate);
              const currentDate = getCurrentDate(form.transactionDate);
              const rate = await getExchangeRate(
                fromAccount.Currency,
                toAcc.Currency,
                currentMonth,
                selectedBudget.ID,
                currentDate
              );
              if (rate) {
                // money × rate → round back to exact integer milliunits
                inflowAmount = roundMilli(amt * rate);
              }
            }

            const transferMemo = formatTransferMemo({
              fromAccountName: fromAccount.Name,
              toAccountName: toAcc.Name,
              memo: form.memo,
              amount: amt,
              convertedAmount: inflowAmount,
              fromCurrency: fromAccount.Currency,
              toCurrency: toAcc.Currency,
              needsConversion: fromAccount.Currency !== toAcc.Currency,
            });

            const transferId = generateTransferId();

            // For off-budget transfers, use the selected category for the source side
            // This allows users to categorize off-budget transfers as spending
            const sourceCategory = isOffBudgetTransfer
              ? form.selectedCategory || 'Transfers'
              : 'Transfers';

            await onAddTransaction(
              form.transactionDate,
              sourceCategory,
              transferMemo,
              outboundPayee,
              amt,
              0,
              parseInt(form.selectedFromAccount),
              form.selectedLabelId,
              transferId,
              addAnother
            );

            await onAddTransaction(
              form.transactionDate,
              'Transfers',
              transferMemo,
              inboundPayee,
              0,
              inflowAmount,
              parseInt(form.selectedToAccount),
              form.selectedLabelId,
              transferId,
              addAnother
            );

            form.persistLastUsed('transfer', {
              payee: form.payee,
              accountId: form.selectedFromAccount,
              labelId: form.selectedLabelId,
            });

            if (addAnother) {
              resetFormFields();
            }
            toast.success('Transfer added', { description: 'Transfer created successfully.' });
          } finally {
            form.setCalculatingTransfer(false);
          }
        }
        return;
      }

      // Non-transfer transactions
      if (!isSplit) {
        if (!canUseCurrencyApi && selectedAccount && selectedBudget) {
          const budgetCurrency = selectedBudget.DisplayCurrency;
          if (budgetCurrency && selectedAccount.Currency !== budgetCurrency) {
            const m = getMonthKey(form.transactionDate || new Date());
            const d = getCurrentDate(form.transactionDate);
            const localOrManual = await getLocalOrManualRate(
              selectedAccount.Currency,
              budgetCurrency,
              m,
              selectedBudget.ID,
              d
            );
            if (!localOrManual) {
              form.setPendingRatePair({ from: selectedAccount.Currency, to: budgetCurrency });
              form.setPendingAdd({
                date: form.transactionDate,
                category: finalCategory,
                memo: form.memo,
                payee: form.payee,
                labelId: form.selectedLabelId,
                outflow,
                inflow,
                accountId: parseInt(form.selectedFromAccount),
                transferId: null,
              });
              form.setShowRatePrompt(true);
              return;
            }
          }
        }

        const transactionId = await onAddTransaction(
          form.transactionDate,
          finalCategory,
          form.memo,
          form.payee,
          outflow,
          inflow,
          parseInt(form.selectedFromAccount),
          form.selectedLabelId,
          null,
          addAnother
        );

        logAutofillApplications(transactionId, autofillAppliedSuggestions);

        form.persistLastUsed(form.transactionType, {
          category: !form.isTransfer ? finalCategory : undefined,
          payee: form.payee,
          accountId: form.selectedFromAccount,
          labelId: form.selectedLabelId,
        });

        if (addAnother) {
          resetFormFields();
        }
        toast.success('Transaction added', { description: 'Transaction saved successfully.' });
        return;
      }

      // Split-mode
      const splitValidation = validateSplitTotal(remaining);
      if (!splitValidation.isValid && splitValidation.error) {
        toast.error(splitValidation.error.title, {
          description: splitValidation.error.description,
        });
        return;
      }

      const accountId = parseInt(form.selectedFromAccount);
      const transactionId = await onAddTransaction(
        form.transactionDate,
        finalCategory,
        form.memo,
        form.payee,
        outflow,
        inflow,
        accountId,
        form.selectedLabelId,
        null,
        addAnother
      );

      const uncategorized = categories.find((c) => c.Name === 'Uncategorized');
      const uncategorizedId = uncategorized?.ID ?? null;

      const missingAssignment = splitLines.some(
        (l) => (!l.categoryId && !l.transferAccountId) || (l.categoryId && l.transferAccountId)
      );
      if (missingAssignment && !uncategorizedId) {
        toast.error('Split requires category', {
          description: 'Each split line needs a category. Please assign a category to every split.',
        });
        return;
      }

      const prepared = splitLines.map((l, idx) => ({
        category_id: l.categoryId ?? (l.transferAccountId ? null : uncategorizedId),
        transfer_account_id: l.transferAccountId ?? null,
        memo: l.memo ?? '',
        amount: l.amount,
        order_index: idx,
      }));

      try {
        await upsertSplits.mutateAsync({
          transactionId,
          splits: prepared,
          type: form.isInflow ? 'inflow' : 'outflow',
        });

        // Log autofill rule applications (if any were applied before split mode)
        logAutofillApplications(transactionId, autofillAppliedSuggestions);

        form.persistLastUsed(form.transactionType, {
          payee: form.payee,
          category: !form.isTransfer && form.selectedCategory ? form.selectedCategory : undefined,
          accountId: form.selectedFromAccount,
          labelId: form.selectedLabelId,
        });

        if (addAnother) {
          resetFormFields();
        }
        toast.success('Transaction with splits added', {
          description: 'Transaction saved successfully.',
        });
      } catch (e) {
        console.error('Failed to save splits', e);
      }
    },
    [
      form,
      isSplit,
      splitLines,
      accounts,
      categories,
      selectedBudget,
      selectedAccount,
      canUseCurrencyApi,
      remaining,
      onAddTransaction,
      upsertSplits,
      resetFormFields,
      logAutofillApplications,
      autofillAppliedSuggestions,
      isOffBudgetTransfer,
    ]
  );

  const toggleSplit = React.useCallback(() => {
    setIsSplit((v) => !v);
  }, []);

  return {
    // Base form state and actions
    form,

    // Split state
    isSplit,
    setIsSplit,
    splitLines,
    setSplitLines,
    toggleSplit,

    // Data
    categories,
    categoriesLoading,
    accounts,
    accountsLoading,

    // Derived state
    selectedAccount,
    toAccount,
    currencyCode,
    needsCurrencyConversion,
    isOffBudgetTransfer,
    totalSplits,
    parentSigned,
    remaining,
    canUseCurrencyApi,
    selectedBudget,
    globalLocalizer,
    resolvedRate,

    // Autofill
    autofillAppliedFields,

    // Actions
    handleSubmit,
    resetFormFields,
    onCancel,
  };
}

export type UseAddTransactionFormReturn = ReturnType<typeof useAddTransactionForm>;
