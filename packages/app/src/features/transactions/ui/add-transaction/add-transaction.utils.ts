import { t } from '@lingui/core/macro';
/**
 * Add Transaction Form Utilities
 *
 * Amount conversion and validation helpers for the transaction form.
 */

import { format } from 'date-fns';
import { scaledToDecimal } from '@budgero/core/browser';

import { formatNativeAmount } from '@entities/currency/lib/currency-utils';
import type { TransactionType } from '@features/transactions/api/useTransactionForm';

export interface TransferRateOverrides {
  sourceRateOverride: number | null;
  destinationRateOverride: number | null;
}

export function shouldShowPayeeField(
  isTransfer: boolean,
  transferInvolvesOffBudget: boolean
): boolean {
  return !isTransfer || transferInvolvesOffBudget;
}

/** Puts the picked category on the on-budget leg; every other leg gets Transfers. */
function placeTransferCategory<T>(
  sourceOnBudget: boolean,
  destinationOnBudget: boolean,
  selected: T,
  transfers: T
): { source: T; destination: T } {
  if (sourceOnBudget && destinationOnBudget) {
    return { source: transfers, destination: transfers };
  }
  if (destinationOnBudget) {
    return { source: transfers, destination: selected };
  }
  return { source: selected, destination: transfers };
}

export function resolveTransferCategories(params: {
  sourceOnBudget: boolean;
  destinationOnBudget: boolean;
  selectedCategory?: string | null;
}): { sourceCategory: string; destinationCategory: string } {
  const { source, destination } = placeTransferCategory(
    params.sourceOnBudget,
    params.destinationOnBudget,
    params.selectedCategory || 'Transfers',
    'Transfers'
  );
  return { sourceCategory: source, destinationCategory: destination };
}

/** ID form of resolveTransferCategories; 0 means uncategorized. */
export function resolveTransferCategoryIds(params: {
  sourceOnBudget: boolean;
  destinationOnBudget: boolean;
  selectedCategoryId: number | null;
  transfersCategoryId: number | null;
}): { sourceCategoryId: number; destinationCategoryId: number } {
  const transfers = params.transfersCategoryId ?? 0;
  const { source, destination } = placeTransferCategory(
    params.sourceOnBudget,
    params.destinationOnBudget,
    params.selectedCategoryId ?? transfers,
    transfers
  );
  return { sourceCategoryId: source, destinationCategoryId: destination };
}

/** Direct source-to-destination rate implied by the two exact native amounts. */
export function calculateImpliedTransferRate(params: {
  sourceAmount: number;
  receivedAmount: number;
  sourceCurrency: string;
  destinationCurrency: string;
}): number | null {
  const { sourceAmount, receivedAmount, sourceCurrency, destinationCurrency } = params;
  const source = scaledToDecimal(sourceAmount, sourceCurrency);
  const received = scaledToDecimal(receivedAmount, destinationCurrency);
  return source > 0 && received > 0 ? received / source : null;
}

/**
 * Pin one transfer leg so the exact source and received amounts represent the
 * same value in the budget currency. Rates stored on transactions always run
 * from the account currency to the budget currency.
 */
export function calculateTransferRateOverrides(params: {
  sourceAmount: number;
  receivedAmount: number;
  sourceCurrency: string;
  destinationCurrency: string;
  budgetCurrency: string;
  sourceToBudgetRate?: number | null;
}): TransferRateOverrides {
  const {
    sourceAmount,
    receivedAmount,
    sourceCurrency,
    destinationCurrency,
    budgetCurrency,
    sourceToBudgetRate,
  } = params;
  const empty = { sourceRateOverride: null, destinationRateOverride: null };
  if (sourceAmount <= 0 || receivedAmount <= 0 || sourceCurrency === destinationCurrency) {
    return empty;
  }

  const impliedRate = calculateImpliedTransferRate({
    sourceAmount,
    receivedAmount,
    sourceCurrency,
    destinationCurrency,
  });
  if (!impliedRate) return empty;

  if (destinationCurrency === budgetCurrency) {
    return { sourceRateOverride: impliedRate, destinationRateOverride: null };
  }

  const sourceToBudget =
    sourceCurrency === budgetCurrency
      ? 1
      : sourceToBudgetRate && sourceToBudgetRate > 0
        ? sourceToBudgetRate
        : null;
  if (sourceToBudget === null) return empty;

  return {
    sourceRateOverride: null,
    destinationRateOverride: sourceToBudget / impliedRate,
  };
}

/**
 * Converts amount to inflow/outflow based on transaction type.
 * Milliunits in, milliunits out.
 */
export function convertAmountToFlow(
  amount: number | null,
  transactionType: TransactionType
): { inflow: number; outflow: number } {
  const amt = amount ?? 0;

  switch (transactionType) {
    case 'inflow':
      return { inflow: amt, outflow: 0 };
    case 'outflow':
      return { inflow: 0, outflow: amt };
    case 'transfer':
      return { inflow: 0, outflow: amt };
    default:
      return { inflow: 0, outflow: 0 };
  }
}

/**
 * Validates that required fields are present for a transaction
 */
export interface TransactionValidation {
  isValid: boolean;
  error?: { title: string; description: string };
}

export function validateTransaction(params: {
  selectedFromAccount: string;
  selectedToAccount: string;
  selectedCategory: string;
  isTransfer: boolean;
  isSplit: boolean;
}): TransactionValidation {
  const { selectedFromAccount, selectedToAccount, selectedCategory, isTransfer, isSplit } = params;

  if (!selectedFromAccount) {
    return {
      isValid: false,
      error: { title: t`Missing account`, description: t`Please select an account.` },
    };
  }

  if (isTransfer && !selectedToAccount) {
    return {
      isValid: false,
      error: {
        title: t`Missing destination`,
        description: t`Please select a destination account.`,
      },
    };
  }

  if (!isTransfer && !isSplit && !selectedCategory) {
    return {
      isValid: false,
      error: { title: t`Missing category`, description: t`Please select a category.` },
    };
  }

  return { isValid: true };
}

/**
 * Validates that split lines add up to the parent amount.
 * `remaining` is in milliunits; mismatches under half a currency unit are
 * tolerated (same threshold as the pre-milliunit implementation).
 */
export function validateSplitTotal(remaining: number): TransactionValidation {
  if (Math.round(remaining / 1_000) !== 0) {
    return {
      isValid: false,
      error: {
        title: t`Split total mismatch`,
        description: t`Splits must add up to the transaction total.`,
      },
    };
  }
  return { isValid: true };
}

/**
 * Generates a unique transfer ID linking the two legs of a transfer.
 */
export function generateTransferId(): string {
  return crypto.randomUUID();
}

/**
 * Formats a transfer memo with currency conversion info if needed.
 * `amount`/`convertedAmount` are in each currency's native scale (fiat milli,
 * crypto sat-scale); the memo text shows decimals.
 */
export function formatTransferMemo(params: {
  fromAccountName: string;
  toAccountName: string;
  memo: string;
  amount: number;
  convertedAmount: number;
  fromCurrency: string;
  toCurrency: string;
  needsConversion: boolean;
}): string {
  const {
    fromAccountName,
    toAccountName,
    memo,
    amount,
    convertedAmount,
    fromCurrency,
    toCurrency,
    needsConversion,
  } = params;

  let transferMemo = `${fromAccountName} → ${toAccountName}${memo ? `: ${memo}` : ''}`;

  if (needsConversion) {
    transferMemo += ` (${formatNativeAmount(amount, fromCurrency)} ${fromCurrency} → ${formatNativeAmount(convertedAmount, toCurrency)} ${toCurrency})`;
  }

  return transferMemo;
}

/**
 * Gets the current month string for currency conversion
 */
export function getCurrentMonth(date: Date | null): string {
  return date ? format(date, 'yyyy-MM') : format(new Date(), 'yyyy-MM');
}

/**
 * Gets the current date string for currency conversion lookups
 */
export function getCurrentDate(date: Date | null): string {
  return date ? format(date, 'yyyy-MM-dd') : format(new Date(), 'yyyy-MM-dd');
}

/**
 * Calculates the remaining amount for splits (milliunits in, milliunits out)
 */
export function calculateSplitRemaining(
  parentNet: number,
  splitNet: number,
  isTransfer: boolean
): number {
  return (isTransfer ? 0 : parentNet) - splitNet;
}
