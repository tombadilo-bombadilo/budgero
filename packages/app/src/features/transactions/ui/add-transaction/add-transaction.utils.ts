/**
 * Add Transaction Form Utilities
 *
 * Amount conversion and validation helpers for the transaction form.
 */

import { format } from 'date-fns';

import type { TransactionType } from '@features/transactions/api/useTransactionForm';
import { toDecimal } from '@shared/lib/currency/milli';
import { roundMilli } from '@shared/lib/currency/round-amount';

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
      error: { title: 'Missing account', description: 'Please select an account.' },
    };
  }

  if (isTransfer && !selectedToAccount) {
    return {
      isValid: false,
      error: { title: 'Missing destination', description: 'Please select a destination account.' },
    };
  }

  if (!isTransfer && !isSplit && !selectedCategory) {
    return {
      isValid: false,
      error: { title: 'Missing category', description: 'Please select a category.' },
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
        title: 'Split total mismatch',
        description: 'Splits must add up to the transaction total.',
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
 * `amount`/`convertedAmount` are milliunits; the memo text shows decimals.
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

  let transferMemo = `Transfer from ${fromAccountName} to ${toAccountName}${memo ? `: ${memo}` : ''}`;

  if (needsConversion) {
    transferMemo += ` (${toDecimal(roundMilli(amount)).toFixed(2)} ${fromCurrency} → ${toDecimal(roundMilli(convertedAmount)).toFixed(2)} ${toCurrency})`;
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
  parentAmount: number | null,
  splitTotal: number,
  isTransfer: boolean
): number {
  const parentSigned = isTransfer ? 0 : (parentAmount ?? 0);
  return parentSigned - splitTotal;
}
