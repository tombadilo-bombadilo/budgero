'use client';

/**
 * Transaction Details Section
 *
 * Core form fields: amount, type, date, accounts, payee, category, and memo.
 */

import * as React from 'react';
import { User, Tag, Tags, FileText } from 'lucide-react';

import { Input } from '@shared/ui/input';
import { AutofillIndicator } from '@shared/ui/autofill-indicator';
import { SearchableCategorySelect } from '@features/category-management/ui/SearchableCategorySelect';
import { PayeeCombobox } from '@features/payees/ui/PayeeCombobox';
import { LabelCombobox } from '@features/labels/ui/LabelCombobox';

import type { TransactionType } from '@features/transactions/api/useTransactionForm';
import type { MilliUnits } from '@shared/lib/currency/milli';
import {
  TransactionTypeSelector,
  AmountInput,
  DatePickerQuick,
  FromAccountSelect,
  ToAccountSelect,
  CurrencyConversionNotice,
} from '../form';

interface Account {
  ID: number;
  Name: string;
  Currency: string;
}

interface Category {
  ID: number;
  Name: string;
}

interface TransactionDetailsSectionProps {
  // Budget
  budgetId: number;

  // Amount
  /** Amount in integer milliunits. */
  amount: MilliUnits | null;
  amountTouched: boolean;
  currencyCode: string;
  transactionType: TransactionType;
  amountInputNonce: number;
  amountFocusSignal: number;
  globalLocalizer: Intl.NumberFormat;
  onAmountCommit: (value: MilliUnits | null) => void;
  onAmountTouched: () => void;
  onAmountEditingChange: (editing: boolean) => void;

  // Type
  onTransactionTypeChange: (type: TransactionType) => void;

  // Date
  transactionDate: Date | null;
  dateOpen: boolean;
  onDateOpenChange: (open: boolean) => void;
  onDateChange: (date: Date | null) => void;

  // Accounts
  selectedFromAccount: string;
  selectedToAccount: string;
  onFromAccountChange: (accountId: string) => void;
  onToAccountChange: (accountId: string) => void;
  accounts: Account[];
  accountsLoading: boolean;
  isTransfer: boolean;

  // Currency conversion
  needsCurrencyConversion: boolean;
  convertedAmount: number | null;
  isLoadingRate: boolean;
  selectedAccount: Account | undefined;
  toAccount: Account | null;
  canUseCurrencyApi: boolean;
  exchangeRate?: number | null;

  // Off-budget transfer (allows category selection)
  isOffBudgetTransfer: boolean;

  // Payee
  payee: string;
  onPayeeChange: (payee: string) => void;

  // Label
  selectedLabelId: number | null;
  onLabelChange: (labelId: number | null) => void;

  // Category
  selectedCategory: string;
  onCategoryChange: (categoryName: string) => void;
  categories: Category[];
  categoriesLoading: boolean;
  isSplit: boolean;

  // Memo
  memo: string;
  onMemoChange: (memo: string) => void;

  // Autofill indicator
  autofillAppliedFields?: Set<string>;
}

export const TransactionDetailsSection = React.memo(function TransactionDetailsSection({
  budgetId,
  amount,
  amountTouched,
  currencyCode,
  transactionType,
  amountInputNonce,
  amountFocusSignal,
  globalLocalizer,
  onAmountCommit,
  onAmountTouched,
  onAmountEditingChange,
  onTransactionTypeChange,
  transactionDate,
  dateOpen,
  onDateOpenChange,
  onDateChange,
  selectedFromAccount,
  selectedToAccount,
  onFromAccountChange,
  onToAccountChange,
  accounts,
  accountsLoading,
  isTransfer,
  isOffBudgetTransfer,
  needsCurrencyConversion,
  convertedAmount,
  isLoadingRate,
  selectedAccount,
  toAccount,
  canUseCurrencyApi,
  exchangeRate,
  payee,
  onPayeeChange,
  selectedLabelId,
  onLabelChange,
  selectedCategory,
  onCategoryChange,
  categories,
  categoriesLoading,
  isSplit,
  memo,
  onMemoChange,
  autofillAppliedFields,
}: TransactionDetailsSectionProps) {
  const selectedCategoryId = React.useMemo(() => {
    const category = categories.find((cat) => cat.Name === selectedCategory);
    return category?.ID || null;
  }, [categories, selectedCategory]);

  const handleCategorySelect = React.useCallback(
    (categoryId: number) => {
      const category = categories.find((cat) => cat.ID === categoryId);
      if (category) {
        onCategoryChange(category.Name);
      }
    },
    [categories, onCategoryChange]
  );

  return (
    <div className="mt-3 sm:mt-4 space-y-2.5 sm:space-y-4">
      <AmountInput
        value={amount}
        touched={amountTouched}
        currencyCode={currencyCode}
        transactionType={transactionType}
        nonce={amountInputNonce}
        focusSignal={amountFocusSignal}
        globalLocalizer={globalLocalizer}
        onCommit={onAmountCommit}
        onTouched={onAmountTouched}
        onEditingChange={onAmountEditingChange}
      />

      <TransactionTypeSelector value={transactionType} onChange={onTransactionTypeChange} />

      <DatePickerQuick
        value={transactionDate}
        open={dateOpen}
        onOpenChange={onDateOpenChange}
        onChange={onDateChange}
      />

      <FromAccountSelect
        value={selectedFromAccount}
        onChange={onFromAccountChange}
        accounts={accounts}
        isLoading={accountsLoading}
        transactionType={transactionType}
        showAutofillIndicator={autofillAppliedFields?.has('account') ?? false}
      />

      {isTransfer && (
        <ToAccountSelect
          value={selectedToAccount}
          onChange={onToAccountChange}
          accounts={accounts}
          excludeAccountId={selectedFromAccount}
          isLoading={accountsLoading}
        />
      )}

      {needsCurrencyConversion && isTransfer && (
        <CurrencyConversionNotice
          amount={amount ?? 0}
          convertedAmount={convertedAmount}
          isLoadingRate={isLoadingRate}
          fromCurrency={selectedAccount?.Currency || ''}
          toCurrency={toAccount?.Currency || ''}
          canUseCurrencyApi={canUseCurrencyApi}
          exchangeRate={exchangeRate}
        />
      )}

      {/* Payee Input */}
      <div className="space-y-1.5 sm:space-y-2" data-testid="transaction-payee-field">
        <div className="flex items-center gap-2">
          <div className="relative">
            <User className="h-4 w-4 text-muted-foreground" />
            <AutofillIndicator
              show={autofillAppliedFields?.has('payee') ?? false}
              className="absolute -top-0.5 -right-0.5"
            />
          </div>
          <div className="flex-1">
            <PayeeCombobox
              budgetId={budgetId}
              value={payee}
              onChange={onPayeeChange}
              placeholder="Select payee"
              triggerClassName="h-8 sm:h-10"
            />
          </div>
        </div>
      </div>

      {/* Label Selector */}
      <div className="space-y-1.5 sm:space-y-2" data-testid="transaction-label-field">
        <div className="flex items-center gap-2">
          <Tags className="h-4 w-4 text-muted-foreground" />
          <div className="flex-1">
            <LabelCombobox
              budgetId={budgetId}
              value={selectedLabelId}
              onChange={onLabelChange}
              placeholder="No label"
              triggerClassName="h-8 sm:h-10 rounded-full border-border/70 bg-muted/20 hover:bg-muted/40"
            />
          </div>
        </div>
      </div>

      {/* Category Selector - show for non-transfers OR off-budget transfers */}
      {(!isTransfer || isOffBudgetTransfer) && !isSplit && (
        <div className="space-y-1.5 sm:space-y-2" data-testid="transaction-category-field">
          <div className="flex items-center gap-2">
            <div className="relative">
              <Tag className="h-4 w-4 text-muted-foreground" />
              <AutofillIndicator
                show={autofillAppliedFields?.has('category') ?? false}
                className="absolute -top-0.5 -right-0.5"
              />
            </div>
            <div className="flex-1">
              <SearchableCategorySelect
                budgetId={budgetId}
                selectedCategoryId={selectedCategoryId}
                onCategorySelect={handleCategorySelect}
                placeholder={categoriesLoading ? 'Loading categories...' : 'Select category'}
                triggerClassName="w-full h-8 sm:h-10 bg-background border-input hover:bg-accent hover:text-accent-foreground transition-colors"
                popoverContentClassName="w-[320px] max-w-[90vw]"
              />
            </div>
          </div>
          {isOffBudgetTransfer && (
            <p className="text-xs text-muted-foreground ml-6">
              Use &apos;Transfers&apos; to deduct from Ready to Assign, or select a category to
              treat as spending
            </p>
          )}
        </div>
      )}

      {/* Memo Input */}
      <div className="space-y-1.5 sm:space-y-2">
        <div className="flex items-center gap-2">
          <div className="relative">
            <FileText className="h-4 w-4 text-muted-foreground" />
            <AutofillIndicator
              show={autofillAppliedFields?.has('memo') ?? false}
              className="absolute -top-0.5 -right-0.5"
            />
          </div>
          <Input
            id="memo"
            type="text"
            value={memo}
            onChange={(e) => onMemoChange(e.target.value)}
            placeholder={isTransfer ? 'Add a note for this transfer...' : 'Add a description...'}
            className="h-8 sm:h-10 bg-background border-input transition-colors focus:border-primary/50 focus:ring-primary/20"
            data-testid="transaction-memo-input"
          />
        </div>
      </div>
    </div>
  );
});
