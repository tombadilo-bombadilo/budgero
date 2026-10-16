'use client';

import { Trans, useLingui } from '@lingui/react/macro';

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

import { formatShortDate, parseDateKey } from '@shared/lib/date-utils';

import type { TransactionType } from '@features/transactions/api/useTransactionForm';
import type { MilliUnits } from '@shared/lib/currency/milli';
import type { PayeeCategoryMemory } from '@budgero/core/browser';
import { resolveCategoryId } from '@features/transactions/lib/category-selection';
import { shouldShowPayeeField } from './add-transaction.utils';
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
  OnBudget: boolean;
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
  /** Regular transaction in an account whose currency differs from the budget's. */
  needsBudgetConversion?: boolean;
  /** Currency the converted amount is shown in (destination account or budget). */
  conversionTargetCurrency?: string | null;
  convertedAmount: number | null;
  isLoadingRate: boolean;
  selectedAccount: Account | undefined;
  toAccount: Account | null;
  canUseCurrencyApi: boolean;
  exchangeRate?: number | null;
  receivedAmount: number | null;
  onReceivedAmountChange: (amount: number | null) => void;
  showCurrencyConversion?: boolean;

  // Off-budget transfer (allows category selection)
  transferInvolvesOffBudget: boolean;

  // Payee
  payee: string;
  onPayeeChange: (payee: string) => void;

  // Label
  selectedLabelId: number | null;
  onLabelChange: (labelId: number | null) => void;
  showLabel?: boolean;

  // Category
  /** Display name of the picked category. */
  selectedCategory: string;
  /** The picked category; names aren't unique, so this decides which one. */
  selectedCategoryId?: number | null;
  onCategoryChange: (categoryName: string, categoryId: number) => void;
  categories: Category[];
  categoriesLoading: boolean;
  isSplit: boolean;

  // Memo
  memo: string;
  onMemoChange: (memo: string) => void;

  // Autofill indicator
  autofillAppliedFields?: Set<string>;
  /** Category came from the payee's last transaction, not from a rule. */
  payeeCategoryApplied?: boolean;
  payeeCategorySource?: PayeeCategoryMemory | null;
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
  transferInvolvesOffBudget,
  needsCurrencyConversion,
  needsBudgetConversion = false,
  conversionTargetCurrency = null,
  convertedAmount,
  isLoadingRate,
  selectedAccount,
  toAccount,
  canUseCurrencyApi,
  exchangeRate,
  receivedAmount,
  onReceivedAmountChange,
  showCurrencyConversion = true,
  payee,
  onPayeeChange,
  selectedLabelId,
  onLabelChange,
  showLabel = true,
  selectedCategory,
  selectedCategoryId: pickedCategoryId = null,
  onCategoryChange,
  categories,
  categoriesLoading,
  isSplit,
  memo,
  onMemoChange,
  autofillAppliedFields,
  payeeCategoryApplied = false,
  payeeCategorySource = null,
}: TransactionDetailsSectionProps) {
  const { t } = useLingui();

  // Names the payee and when it was last filed here, so the softer amber cue
  // reads differently from a rule's "Auto-filled by rule".
  const payeeMemoryLabel = React.useMemo(() => {
    const name = payee.trim();
    if (!name) return undefined;
    const lastUsed = payeeCategorySource ? parseDateKey(payeeCategorySource.Date) : null;
    return lastUsed
      ? t`Last used for "${name}" on ${formatShortDate(lastUsed)}`
      : t`From your last transaction for "${name}"`;
  }, [payee, payeeCategorySource, t]);

  const selectedCategoryId = React.useMemo(
    () =>
      resolveCategoryId(
        categories,
        selectedCategory,
        pickedCategoryId,
        payeeCategorySource?.CategoryID
      ),
    [categories, selectedCategory, pickedCategoryId, payeeCategorySource]
  );

  const handleCategorySelect = React.useCallback(
    (categoryId: number) => {
      const category = categories.find((cat) => cat.ID === categoryId);
      if (category) {
        onCategoryChange(category.Name, category.ID);
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

      {showCurrencyConversion &&
        ((needsCurrencyConversion && isTransfer) || (needsBudgetConversion && !isTransfer)) && (
          <CurrencyConversionNotice
            mode={isTransfer ? 'transfer' : 'budget'}
            amount={amount ?? 0}
            convertedAmount={convertedAmount}
            isLoadingRate={isLoadingRate}
            fromCurrency={selectedAccount?.Currency || ''}
            toCurrency={(isTransfer ? toAccount?.Currency : conversionTargetCurrency) || ''}
            canUseCurrencyApi={canUseCurrencyApi}
            exchangeRate={exchangeRate}
            receivedAmount={receivedAmount}
            onReceivedAmountChange={onReceivedAmountChange}
            onEditingChange={onAmountEditingChange}
            localizer={globalLocalizer}
          />
        )}

      {/* Internal transfers do not have a payee; an off-budget account is external to the budget. */}
      {shouldShowPayeeField(isTransfer, transferInvolvesOffBudget) && (
        <div className="space-y-1.5 sm:space-y-2" data-testid="transaction-payee-field">
          <div className="flex items-center gap-2">
            <div className="relative">
              <User className="h-4 w-4 text-muted-foreground" />
              <AutofillIndicator
                show={autofillAppliedFields?.has('payee') ?? false}
                className="absolute -top-0.5 -right-0.5"
              />
            </div>
            <div className="min-w-0 flex-1">
              <PayeeCombobox
                budgetId={budgetId}
                value={payee}
                onChange={onPayeeChange}
                placeholder={t`Select payee`}
                triggerClassName="h-8 sm:h-10"
              />
            </div>
          </div>
        </div>
      )}

      {/* Label Selector */}
      {showLabel && (
        <div className="space-y-1.5 sm:space-y-2" data-testid="transaction-label-field">
          <div className="flex items-center gap-2">
            <Tags className="h-4 w-4 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <LabelCombobox
                budgetId={budgetId}
                value={selectedLabelId}
                onChange={onLabelChange}
                placeholder={t`No label`}
                triggerClassName="h-8 sm:h-10 rounded-full border-border/70 bg-muted/20 hover:bg-muted/40"
              />
            </div>
          </div>
        </div>
      )}

      {/* Category Selector - transfer categories are meaningful only when crossing the budget. */}
      {(!isTransfer || transferInvolvesOffBudget) && !isSplit && (
        <div className="space-y-1.5 sm:space-y-2" data-testid="transaction-category-field">
          <div className="flex items-center gap-2">
            <div className="relative">
              <Tag className="h-4 w-4 text-muted-foreground" />
              <AutofillIndicator
                show={autofillAppliedFields?.has('category') ?? false}
                className="absolute -top-0.5 -right-0.5"
              />
              <AutofillIndicator
                show={payeeCategoryApplied && !autofillAppliedFields?.has('category')}
                variant="payee-memory"
                label={payeeMemoryLabel}
                className="absolute -top-0.5 -right-0.5"
              />
            </div>
            <div className="min-w-0 flex-1">
              <SearchableCategorySelect
                budgetId={budgetId}
                selectedCategoryId={selectedCategoryId}
                onCategorySelect={handleCategorySelect}
                placeholder={categoriesLoading ? t`Loading categories...` : t`Select category`}
                triggerClassName="w-full h-8 sm:h-10 bg-background border-input hover:bg-accent hover:text-accent-foreground transition-colors"
                popoverContentClassName="w-[320px] max-w-[90vw]"
                includeTransfers={transferInvolvesOffBudget}
              />
            </div>
          </div>
          {transferInvolvesOffBudget && (
            <p className="text-xs text-muted-foreground ml-6">
              <Trans>
                Use 'Transfers' to deduct from Ready to Assign, or select a category to treat as
                spending
              </Trans>
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
            placeholder={isTransfer ? t`Add a note for this transfer...` : t`Add a description...`}
            className="h-8 sm:h-10 bg-background border-input transition-colors focus:border-primary/50 focus:ring-primary/20"
            data-testid="transaction-memo-input"
          />
        </div>
      </div>
    </div>
  );
});
