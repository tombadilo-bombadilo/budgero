'use client';

/**
 * Add Transaction Form
 *
 * Main shell component that composes the transaction form from sub-components.
 * Uses useAddTransactionForm hook for state management.
 */

import * as React from 'react';

import { ManualRatePrompt } from '@features/currencies/ui/ManualRatePrompt';
import { saveManualRate } from '@entities/currency/lib/currency-utils';
import { toastError } from '@shared/lib/errors';
import { Card, CardContent } from '@shared/ui/card';
import { Button } from '@shared/ui/button';
import { DialogHeader, DialogTitle, DialogDescription } from '@shared/ui/dialog';
import { AddAccountDialog } from '@features/account-management/ui/AddAccountDialog';

import { TransactionFormHeader } from './TransactionFormHeader';
import { TransactionDetailsSection } from './TransactionDetailsSection';
import { TransactionSplitSection } from './TransactionSplitSection';
import { TransactionFormActions } from './TransactionFormActions';
import { useAddTransactionForm } from './useAddTransactionForm';

export interface AddTransactionFormProps {
  budgetId: number;
  selectedAccountId?: number;
  onAddTransaction: (
    date: Date | null,
    category: string,
    memo: string,
    payee: string,
    outflow: number,
    inflow: number,
    accountId: number,
    labelId: number | null,
    transferId: string | null,
    keepDialogOpen?: boolean
  ) => Promise<number>;
  onCancel: () => void;
}

export function AddTransactionForm({
  budgetId,
  selectedAccountId,
  onAddTransaction,
  onCancel,
}: AddTransactionFormProps) {
  const {
    form,
    isSplit,
    splitLines,
    setSplitLines,
    toggleSplit,
    categories,
    categoriesLoading,
    accounts,
    accountsLoading,
    selectedAccount,
    toAccount = null,
    currencyCode,
    needsCurrencyConversion,
    isOffBudgetTransfer = false,
    parentSigned,
    remaining,
    canUseCurrencyApi,
    selectedBudget,
    globalLocalizer,
    autofillAppliedFields,
    resolvedRate,
    handleSubmit,
  } = useAddTransactionForm({
    budgetId,
    selectedAccountId,
    onAddTransaction,
    onCancel,
  });

  const submitTransaction = React.useCallback(
    (addAnother: boolean) => {
      handleSubmit(addAnother).catch((error) => {
        toastError('Failed to add transaction', error, 'Please try again.');
      });
    },
    [handleSubmit]
  );

  const onFormSubmit = React.useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      submitTransaction(false);
    },
    [submitTransaction]
  );

  const onQuickAdd = React.useCallback(() => {
    submitTransaction(true);
  }, [submitTransaction]);

  const handleKeyDown = React.useCallback(
    (e: React.KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      const role = target?.getAttribute?.('role');
      const inCommandLike =
        role === 'combobox' || role === 'option' || target?.closest('[role="listbox"]');

      if (form.isAmountEditing && e.key === 'Enter') return;

      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        submitTransaction(false);
        return;
      }

      if (e.key === 'Enter' && !e.shiftKey && !e.altKey && !e.metaKey && !e.ctrlKey) {
        if (tag === 'textarea' || inCommandLike) return;
        e.preventDefault();
        submitTransaction(false);
      }
    },
    [form.isAmountEditing, submitTransaction]
  );

  const handleRatePromptConfirm = React.useCallback(
    async (rate: number, base: string, quote: string) => {
      if (selectedBudget) await saveManualRate(base, quote, rate, selectedBudget.ID);
      form.setShowRatePrompt(false);
      if (form.pendingAdd) {
        await onAddTransaction(
          form.pendingAdd.date,
          form.pendingAdd.category,
          form.pendingAdd.memo,
          form.pendingAdd.payee,
          form.pendingAdd.outflow,
          form.pendingAdd.inflow,
          form.pendingAdd.accountId,
          form.pendingAdd.labelId,
          form.pendingAdd.transferId,
          false
        );
        form.setPendingAdd(null);
        return;
      }
      setTimeout(() => form.setAmount(form.amount), 0);
    },
    [selectedBudget, form, onAddTransaction]
  );

  // No accounts prompt
  if (!accountsLoading && accounts.length === 0) {
    return (
      <div className="max-w-lg w-full mx-auto space-y-4 p-2 sm:p-4">
        <DialogHeader className="space-y-1.5">
          <DialogTitle className="text-lg sm:text-xl font-semibold">
            Add an account first
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            Create an account to start recording transactions.
          </DialogDescription>
        </DialogHeader>
        <Card>
          <CardContent className="space-y-4 pt-6">
            <p className="text-sm text-muted-foreground">
              You need at least one account before adding transactions.
            </p>
            <div className="flex flex-wrap gap-2">
              <AddAccountDialog
                open={form.addAccountOpen}
                onOpenChange={form.setAddAccountOpen}
                onSuccess={(accountId) => {
                  form.setFromAccount(accountId.toString());
                  form.setAddAccountOpen(false);
                }}
                renderTrigger={(open) => (
                  <Button type="button" onClick={open}>
                    Create Account
                  </Button>
                )}
              />
              <Button type="button" variant="outline" onClick={onCancel}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <form
      onSubmit={onFormSubmit}
      onKeyDownCapture={handleKeyDown}
      className="max-w-lg w-full mx-auto max-h-[calc(100dvh-1rem)] sm:max-h-[min(92vh,calc(100dvh-2rem))] overflow-y-auto px-1 sm:px-0"
      data-testid="add-transaction-form"
    >
      {form.showRatePrompt && form.pendingRatePair && (
        <ManualRatePrompt
          from={form.pendingRatePair.from}
          to={form.pendingRatePair.to}
          onCancel={() => form.setShowRatePrompt(false)}
          onConfirm={handleRatePromptConfirm}
        />
      )}

      <TransactionFormHeader
        rememberLast={form.rememberLast}
        onRememberLastChange={form.setRememberLast}
      />

      <TransactionDetailsSection
        budgetId={budgetId}
        amount={form.amount}
        amountTouched={form.amountTouched}
        currencyCode={currencyCode}
        transactionType={form.transactionType}
        amountInputNonce={form.amountInputNonce}
        amountFocusSignal={form.amountFocusSignal}
        globalLocalizer={globalLocalizer}
        onAmountCommit={form.setAmount}
        onAmountTouched={() => form.setAmountTouched(true)}
        onAmountEditingChange={form.setAmountEditing}
        onTransactionTypeChange={form.setTransactionType}
        transactionDate={form.transactionDate}
        dateOpen={form.dateOpen}
        onDateOpenChange={form.setDateOpen}
        onDateChange={form.setDate}
        selectedFromAccount={form.selectedFromAccount}
        selectedToAccount={form.selectedToAccount}
        onFromAccountChange={form.setFromAccount}
        onToAccountChange={form.setToAccount}
        accounts={accounts}
        accountsLoading={accountsLoading}
        isTransfer={form.isTransfer}
        isOffBudgetTransfer={isOffBudgetTransfer}
        needsCurrencyConversion={needsCurrencyConversion}
        convertedAmount={form.convertedAmount}
        isLoadingRate={form.isLoadingRate}
        selectedAccount={selectedAccount}
        toAccount={toAccount}
        canUseCurrencyApi={canUseCurrencyApi}
        exchangeRate={resolvedRate}
        payee={form.payee}
        onPayeeChange={form.setPayee}
        selectedLabelId={form.selectedLabelId}
        onLabelChange={form.setLabelId}
        selectedCategory={form.selectedCategory}
        onCategoryChange={form.setCategory}
        categories={categories}
        categoriesLoading={categoriesLoading}
        isSplit={isSplit}
        memo={form.memo}
        onMemoChange={form.setMemo}
        autofillAppliedFields={autofillAppliedFields}
      />

      <TransactionSplitSection
        budgetId={budgetId}
        isTransfer={form.isTransfer}
        isSplit={isSplit}
        onToggleSplit={toggleSplit}
        splitLines={splitLines}
        onSplitLinesChange={setSplitLines}
        remaining={remaining}
        parentAmount={parentSigned}
        formatter={globalLocalizer}
      />

      <TransactionFormActions
        onCancel={onCancel}
        onQuickAdd={onQuickAdd}
        isCalculatingTransfer={form.isCalculatingTransfer}
        isTransfer={form.isTransfer}
        isInflow={form.isInflow}
        isOutflow={form.isOutflow}
      />
    </form>
  );
}
