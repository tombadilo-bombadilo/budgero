/**
 * Account business calculations: liability/debt amortization and transaction stats.
 * Pure functions — no DB or UI dependencies.
 */

import { getLocalDateString, parseDateOnlyLocal } from '../../utils/date.js';
import { isCreditAccountType, isLiabilityAccountType } from './types.js';

export interface LiabilityInfo {
  originalDebt: number | undefined;
  outstanding: number;
  paidSoFar: number | undefined;
  apr: number | undefined;
  minPayment: number | undefined;
  originalMinPayment: number | undefined;
  isPaymentRecalculated: boolean;
  payoffMonths: number | undefined;
  targetDate: string | undefined;
  estimatedPayoffDate: string | undefined;
  isLiability: true;
  liabilityType: string;
  estimatedTotalPaid: number | undefined;
  estimatedTotalInterest: number | undefined;
}

export interface AccountWithMetadata {
  Type?: string | null;
  Metadata?: unknown;
}

/**
 * Computes liability information from account metadata for debt/credit accounts.
 */
export function computeLiabilityInfo(
  selectedAccount: AccountWithMetadata | null,
  balanceAccountToday: number
): LiabilityInfo | null {
  if (!selectedAccount) return null;

  // Robustly parse metadata (can be string JSON or object)
  const rawMd: unknown = (selectedAccount as AccountWithMetadata).Metadata;
  let md: Record<string, unknown> = {};
  if (typeof rawMd === 'string') {
    try {
      md = JSON.parse(rawMd);
    } catch {
      md = {};
    }
  } else if (rawMd && typeof rawMd === 'object') {
    md = rawMd as Record<string, unknown>;
  }

  // Case-insensitive liability type detection
  const outstandingRaw = balanceAccountToday;
  const isLiability =
    Boolean(md?.liability) || isLiabilityAccountType(selectedAccount.Type) || outstandingRaw < 0;
  if (!isLiability) return null;

  const outstanding = Math.abs(outstandingRaw);
  const originalDebt = typeof md?.debt_total === 'number' ? md.debt_total : undefined;
  const paidSoFar =
    originalDebt !== undefined ? Math.max(0, originalDebt - outstanding) : undefined;
  const apr =
    typeof md?.interest_rate_annual === 'number'
      ? md.interest_rate_annual
      : typeof md?.interest_rate_annual === 'string'
        ? parseFloat(md?.interest_rate_annual)
        : undefined;
  const monthlyRate = apr ? apr / 100 / 12 : undefined;

  const originalMinPayment =
    typeof md?.min_payment_monthly === 'number' ? md.min_payment_monthly : undefined;
  const termYears =
    typeof md?.term_years === 'number'
      ? md.term_years
      : typeof md?.term_years === 'string'
        ? parseFloat(md.term_years)
        : undefined;
  const loanStartDate = md?.start_date as string | undefined;
  const targetDate = md?.target_date as string | undefined;

  let originalLoanTerm: number | undefined;
  if (loanStartDate && targetDate) {
    const startDate = parseDateOnlyLocal(loanStartDate);
    const endDate = parseDateOnlyLocal(targetDate);
    if (startDate && endDate) {
      originalLoanTerm =
        (endDate.getFullYear() - startDate.getFullYear()) * 12 +
        (endDate.getMonth() - startDate.getMonth());
    }
  }

  // Calculate adjusted minimum payment based on current balance
  let minPayment = originalMinPayment;
  let payoffMonths: number | undefined;

  // Derive a sensible fallback minimum payment when not provided, especially for credit cards
  const liabilityTypeLower = (
    (md?.liability_type as string | undefined) ||
    selectedAccount.Type ||
    ''
  )
    .toString()
    .toLowerCase();

  if (monthlyRate !== undefined && outstanding > 0) {
    if (minPayment === undefined) {
      if (isCreditAccountType(liabilityTypeLower)) {
        // Typical credit card min payment approximation: interest + 1% principal
        // (or 2% flat), with a $25 floor (25_000 milliunits)
        const interestPortion = outstanding * monthlyRate;
        const percentPortion = Math.max(outstanding * 0.02, interestPortion + outstanding * 0.01);
        minPayment = Math.max(25_000, percentPortion);
      }
    }
  }

  // Priority 1: If we have a term in years, compute payment to amortize over remaining term
  if (monthlyRate !== undefined && outstanding > 0 && termYears && termYears > 0) {
    const totalMonths = Math.max(1, Math.round(termYears * 12));
    let remainingMonths = totalMonths;
    const startDate = loanStartDate ? parseDateOnlyLocal(loanStartDate) : null;
    if (startDate) {
      const elapsed = Math.max(
        0,
        (new Date().getFullYear() - startDate.getFullYear()) * 12 +
          (new Date().getMonth() - startDate.getMonth())
      );
      remainingMonths = Math.max(1, totalMonths - elapsed);
    }
    if (monthlyRate > 0) {
      const factor = (1 + monthlyRate) ** remainingMonths;
      minPayment = (outstanding * monthlyRate * factor) / (factor - 1);
    } else {
      minPayment = outstanding / remainingMonths;
    }
    payoffMonths = remainingMonths;
  }

  // Priority 2: If we have both loan start and target date (original plan), keep remaining term and recompute
  if (
    monthlyRate !== undefined &&
    outstanding > 0 &&
    payoffMonths === undefined &&
    minPayment !== undefined
  ) {
    // If we have the original loan term, maintain it and recalculate payment
    const planStartDate = loanStartDate ? parseDateOnlyLocal(loanStartDate) : null;
    if (originalLoanTerm !== undefined && planStartDate) {
      const monthsElapsed = Math.max(
        0,
        (new Date().getFullYear() - planStartDate.getFullYear()) * 12 +
          (new Date().getMonth() - planStartDate.getMonth())
      );
      const remainingMonths = Math.max(1, originalLoanTerm - monthsElapsed);

      // Calculate new minimum payment using loan formula: P = L[c(1 + c)^n]/[(1 + c)^n - 1]
      // where P = payment, L = loan amount (outstanding), c = monthly rate, n = months
      if (monthlyRate > 0) {
        const factor = (1 + monthlyRate) ** remainingMonths;
        minPayment = (outstanding * monthlyRate * factor) / (factor - 1);
        payoffMonths = remainingMonths;
      } else {
        // If no interest, simple division
        minPayment = outstanding / remainingMonths;
        payoffMonths = remainingMonths;
      }
    } else {
      // Priority 3: Fallback - use the (derived or original) payment to calculate months remaining
      const interestPortion = outstanding * monthlyRate;
      if (minPayment > interestPortion) {
        // n = -ln(1 - r*P/B)/ln(1+r)
        const n =
          -Math.log(1 - (monthlyRate * outstanding) / minPayment) / Math.log(1 + monthlyRate);
        if (isFinite(n) && n > 0) {
          payoffMonths = Math.ceil(n);
        }
      }
    }
  }

  // minPayment is derived from interest/amortization math (fractional); round
  // back to an integer milliunit amount before it's reported or compounded.
  if (minPayment !== undefined) minPayment = Math.round(minPayment);

  // Estimated totals if amortization available
  let estimatedTotalPaid: number | undefined;
  let estimatedTotalInterest: number | undefined;
  if (payoffMonths && monthlyRate !== undefined && minPayment !== undefined) {
    // Using amortization sum of payments: total = minPayment * payoffMonths
    estimatedTotalPaid = minPayment * payoffMonths;
    // From-now interest approximation: interest = total future payments - current outstanding principal
    // We intentionally use 'outstanding' (remaining) rather than original debt because
    // past interest has already been incurred and we are only estimating interest going forward.
    estimatedTotalInterest = Math.max(0, estimatedTotalPaid - outstanding);
  }

  const estimatedPayoffDate = (() => {
    if (!payoffMonths) return undefined;
    const d = new Date();
    d.setMonth(d.getMonth() + payoffMonths);
    return getLocalDateString(d);
  })();

  return {
    originalDebt,
    outstanding,
    paidSoFar,
    apr,
    minPayment,
    originalMinPayment,
    isPaymentRecalculated: minPayment !== originalMinPayment && originalMinPayment !== undefined,
    payoffMonths,
    targetDate,
    estimatedPayoffDate,
    isLiability: true,
    liabilityType:
      (md?.liability_type as string | undefined) || (selectedAccount.Type || '').toLowerCase(),
    estimatedTotalPaid,
    estimatedTotalInterest,
  };
}

/**
 * Converts liability info values to budget currency using a conversion rate.
 */
export function convertLiabilityInfoToBudgetCurrency(
  liabilityInfo: LiabilityInfo,
  conversionRate: number
): LiabilityInfo {
  // Each field is an integer-milliunit money amount; converting by a rate
  // yields a fractional value, so round every result back to an integer.
  const conv = (v: number | undefined): number | undefined =>
    v === undefined ? undefined : Math.round(v * conversionRate);
  return {
    ...liabilityInfo,
    outstanding: Math.round(liabilityInfo.outstanding * conversionRate),
    originalDebt: conv(liabilityInfo.originalDebt),
    paidSoFar: conv(liabilityInfo.paidSoFar),
    minPayment: conv(liabilityInfo.minPayment),
    originalMinPayment: conv(liabilityInfo.originalMinPayment),
    estimatedTotalPaid: conv(liabilityInfo.estimatedTotalPaid),
    estimatedTotalInterest: conv(liabilityInfo.estimatedTotalInterest),
  };
}

export interface TransactionStats {
  totalInflow: number;
  totalOutflow: number;
  recentCount: number;
}

export interface MobilePageStats {
  totalInflow: number;
  totalOutflow: number;
  transactionCount: number;
  pageNumber: number;
  totalPages: number;
}

/**
 * Calculates transaction statistics (inflow/outflow totals).
 */
export function calculateTransactionStats(
  transactionsData: {
    Inflow?: number;
    Outflow?: number;
    InflowOriginal?: number;
    OutflowOriginal?: number;
  }[],
  mobilePageStats: MobilePageStats | null,
  transactionCurrencyDisplay: 'budget' | 'account'
): TransactionStats {
  // On mobile, use the current page stats if available
  if (mobilePageStats) {
    return {
      totalInflow: mobilePageStats.totalInflow,
      totalOutflow: mobilePageStats.totalOutflow,
      recentCount: mobilePageStats.transactionCount,
    };
  }

  // Fallback: show stats for all transactions (desktop or initial load)
  if (!transactionsData.length) return { totalInflow: 0, totalOutflow: 0, recentCount: 0 };

  // Use the correct amounts based on currency display preference
  const totalInflow = transactionsData.reduce((sum, tx) => {
    const amount =
      transactionCurrencyDisplay === 'budget' ? tx.Inflow : (tx.InflowOriginal ?? tx.Inflow);
    return sum + (amount || 0);
  }, 0);

  const totalOutflow = transactionsData.reduce((sum, tx) => {
    const amount =
      transactionCurrencyDisplay === 'budget' ? tx.Outflow : (tx.OutflowOriginal ?? tx.Outflow);
    return sum + (amount || 0);
  }, 0);

  return {
    totalInflow,
    totalOutflow,
    recentCount: transactionsData.length,
  };
}
