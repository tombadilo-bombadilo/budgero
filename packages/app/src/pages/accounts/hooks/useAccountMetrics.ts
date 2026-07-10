import { useMemo } from 'react';
import { isValid, parseISO } from 'date-fns';
import type { DateRange } from 'react-day-picker';
import type { GetTransactionsByAccountRow } from '@budgero/core/browser';
import { extractDateKey, formatDateISO, getTodayISO } from '@shared/lib/date-utils';

/**
 * Normalizes various date inputs to a Date object or null.
 */
export const normalizeToDate = (value: unknown): Date | null => {
  if (!value) return null;
  if (value instanceof Date) {
    return isValid(value) ? value : null;
  }
  if (typeof value === 'number') {
    const fromNumber = new Date(value);
    return isValid(fromNumber) ? fromNumber : null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const isoParsed = parseISO(trimmed);
    if (isValid(isoParsed)) return isoParsed;
    const fallback = new Date(trimmed);
    return isValid(fallback) ? fallback : null;
  }
  return null;
};

export interface AccountMetricsInput {
  selectedAccount: {
    Balance?: number | null;
    BalanceConverted?: number | null;
  } | null;
  allTransactionsData: GetTransactionsByAccountRow[];
  dateRange: DateRange | undefined;
  transactionCurrencyDisplay: 'budget' | 'account';
}

export interface AccountMetricsResult {
  /** Balance in account currency as of today (excluding future transactions) */
  balanceAccountToday: number;
  /** Balance in budget currency as of today (excluding future transactions) */
  balanceConvertedToday: number;
  /** Balance to display based on currency preference */
  displayBalanceToday: number;
  /** Transactions filtered by the date range */
  transactionsData: GetTransactionsByAccountRow[];
}

/**
 * Custom hook for computing account metrics including:
 * - Future transaction impact
 * - Today's balance (excluding future transactions)
 * - Normalized date range
 * - Filtered transactions by date range
 */
export function useAccountMetrics({
  selectedAccount,
  allTransactionsData,
  dateRange,
  transactionCurrencyDisplay,
}: AccountMetricsInput): AccountMetricsResult {
  const futureTransactionImpact = useMemo(() => {
    if (!allTransactionsData.length) {
      return { original: 0, converted: 0 };
    }
    const cutoff = getTodayISO();
    return allTransactionsData.reduce(
      (acc, tx) => {
        if (!tx?.Date || tx.Date <= cutoff) {
          return acc;
        }
        const inflow = tx.Inflow ?? 0;
        const outflow = tx.Outflow ?? 0;
        const inflowOriginal = tx.InflowOriginal ?? inflow;
        const outflowOriginal = tx.OutflowOriginal ?? outflow;
        acc.original += inflowOriginal - outflowOriginal;
        acc.converted += inflow - outflow;
        return acc;
      },
      { original: 0, converted: 0 }
    );
  }, [allTransactionsData]);

  const balanceAccountToday = useMemo(() => {
    if (!selectedAccount) {
      return 0;
    }
    const base = selectedAccount.Balance ?? 0;
    return base - futureTransactionImpact.original;
  }, [selectedAccount, futureTransactionImpact.original]);

  const balanceConvertedToday = useMemo(() => {
    if (!selectedAccount) {
      return 0;
    }
    if (
      selectedAccount.BalanceConverted !== undefined &&
      selectedAccount.BalanceConverted !== null
    ) {
      const baseConverted = selectedAccount.BalanceConverted ?? 0;
      return baseConverted - futureTransactionImpact.converted;
    }
    return balanceAccountToday;
  }, [selectedAccount, balanceAccountToday, futureTransactionImpact.converted]);

  const displayBalanceToday =
    transactionCurrencyDisplay === 'budget' ? balanceConvertedToday : balanceAccountToday;

  const normalizedDateRange = useMemo(() => {
    if (!dateRange?.from && !dateRange?.to) {
      return undefined;
    }

    // YYYY-MM-DD keys; string comparison avoids UTC-anchored Date parsing,
    // which excludes range-edge days for users west of UTC.
    const from = dateRange?.from ? formatDateISO(dateRange.from) : undefined;
    const toSource = dateRange?.to ?? dateRange?.from ?? undefined;
    const to = toSource ? formatDateISO(toSource) : undefined;

    return from ? { from, to } : undefined;
  }, [dateRange]);

  // Filter transactions by date range (inclusive, handles single-day selections)
  const transactionsData = useMemo(() => {
    if (!normalizedDateRange?.from) return allTransactionsData;

    return allTransactionsData.filter((tx) => {
      const dayKey = extractDateKey(tx.Date);
      if (dayKey === 'unknown') {
        return false;
      }
      if (dayKey < normalizedDateRange.from) {
        return false;
      }
      if (normalizedDateRange.to && dayKey > normalizedDateRange.to) {
        return false;
      }
      return true;
    });
  }, [allTransactionsData, normalizedDateRange]);

  return {
    balanceAccountToday,
    balanceConvertedToday,
    displayBalanceToday,
    transactionsData,
  };
}
