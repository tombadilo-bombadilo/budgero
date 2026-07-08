import { describe, it, expect } from 'vitest';
import {
  computeLiabilityInfo,
  convertLiabilityInfoToBudgetCurrency,
  calculateTransactionStats,
  type LiabilityInfo,
} from '../src/services/accounts/account-calcs.js';

describe('computeLiabilityInfo', () => {
  it('returns null for a null account', () => {
    expect(computeLiabilityInfo(null, -100)).toBeNull();
  });

  it('returns null for a non-liability asset account with positive balance', () => {
    const result = computeLiabilityInfo({ Type: 'checking', Metadata: {} }, 500);
    expect(result).toBeNull();
  });

  it('treats a negative balance as a liability even without explicit type', () => {
    const result = computeLiabilityInfo({ Type: 'checking', Metadata: {} }, -250);
    expect(result).not.toBeNull();
    expect(result?.outstanding).toBe(250);
  });

  it('derives a credit-card minimum payment and payoff months when none provided', () => {
    // Balance is integer milliunits: -1_000_000 = -$1000
    const result = computeLiabilityInfo(
      { Type: 'credit', Metadata: { interest_rate_annual: 20 } },
      -1_000_000
    );
    expect(result).not.toBeNull();
    expect(result?.outstanding).toBe(1_000_000);
    expect(result?.apr).toBe(20);
    // interest = 1M * (0.20/12) = 16667; percent = max(20000, 16667+10000) = 26667; floor 25000
    expect(result?.minPayment).toBeCloseTo(26666.7, 0);
    expect(result?.payoffMonths).toBe(60);
    expect(result?.estimatedTotalPaid).toBeCloseTo(1_600_000, -3);
    expect(result?.estimatedTotalInterest).toBeCloseTo(600_000, -3);
  });

  it('applies the $25 (25,000 milli) floor for small credit-card balances', () => {
    const result = computeLiabilityInfo(
      { Type: 'credit', Metadata: { interest_rate_annual: 20 } },
      -100_000 // -$100: 2% flat would be 2,000 milli, floor wins
    );
    expect(result?.minPayment).toBe(25_000);
  });

  it('amortizes a loan over its term to compute the minimum payment', () => {
    const result = computeLiabilityInfo(
      { Type: 'loan', Metadata: { interest_rate_annual: 6, term_years: 10 } },
      -10_000_000
    );
    expect(result).not.toBeNull();
    expect(result?.payoffMonths).toBe(120);
    // standard amortization for $10k @ 6%/yr over 120 months = $111.02
    expect(result?.minPayment).toBeCloseTo(111_020, -2);
  });

  it('parses metadata supplied as a JSON string', () => {
    const result = computeLiabilityInfo(
      {
        Type: 'credit',
        Metadata: JSON.stringify({ interest_rate_annual: 20, debt_total: 1_500_000 }),
      },
      -1_000_000
    );
    expect(result).not.toBeNull();
    expect(result?.originalDebt).toBe(1_500_000);
    expect(result?.paidSoFar).toBe(500_000);
  });
});

describe('convertLiabilityInfoToBudgetCurrency', () => {
  it('scales monetary fields by the conversion rate and leaves the rest', () => {
    const base: LiabilityInfo = {
      originalDebt: 1000,
      outstanding: 800,
      paidSoFar: 200,
      apr: 20,
      minPayment: 50,
      originalMinPayment: 40,
      isPaymentRecalculated: true,
      payoffMonths: 24,
      targetDate: undefined,
      estimatedPayoffDate: undefined,
      isLiability: true,
      liabilityType: 'credit',
      estimatedTotalPaid: 1200,
      estimatedTotalInterest: 400,
    };

    const converted = convertLiabilityInfoToBudgetCurrency(base, 1.1);
    expect(converted.outstanding).toBeCloseTo(880, 5);
    expect(converted.originalDebt).toBeCloseTo(1100, 5);
    expect(converted.paidSoFar).toBeCloseTo(220, 5);
    expect(converted.minPayment).toBeCloseTo(55, 5);
    expect(converted.estimatedTotalInterest).toBeCloseTo(440, 5);
    // Non-monetary fields untouched
    expect(converted.apr).toBe(20);
    expect(converted.payoffMonths).toBe(24);
    expect(converted.liabilityType).toBe('credit');
  });

  it('rounds converted amounts to integer milliunits (no fractional money)', () => {
    const base: LiabilityInfo = {
      originalDebt: 100_000,
      outstanding: 100_000,
      paidSoFar: 0,
      apr: 20,
      minPayment: 100_000,
      originalMinPayment: undefined,
      isPaymentRecalculated: false,
      payoffMonths: 12,
      targetDate: undefined,
      estimatedPayoffDate: undefined,
      isLiability: true,
      liabilityType: 'credit',
      estimatedTotalPaid: 100_000,
      estimatedTotalInterest: 0,
    };
    // A rate that produces fractional products (100000 * 1.157 = 115700, but
    // 100000 * 1.1571 = 115710 ... use a value that yields a non-integer)
    const converted = convertLiabilityInfoToBudgetCurrency(base, 1.157123);
    for (const field of [
      'outstanding',
      'originalDebt',
      'minPayment',
      'estimatedTotalPaid',
    ] as const) {
      const v = converted[field];
      expect(Number.isInteger(v as number), `${field} should be integer`).toBe(true);
    }
    expect(converted.outstanding).toBe(Math.round(100_000 * 1.157123));
  });
});

describe('calculateTransactionStats', () => {
  it('uses mobile page stats when provided', () => {
    const stats = calculateTransactionStats(
      [],
      { totalInflow: 11, totalOutflow: 22, transactionCount: 3, pageNumber: 1, totalPages: 2 },
      'budget'
    );
    expect(stats).toEqual({ totalInflow: 11, totalOutflow: 22, recentCount: 3 });
  });

  it('returns zeros for an empty dataset with no mobile stats', () => {
    expect(calculateTransactionStats([], null, 'budget')).toEqual({
      totalInflow: 0,
      totalOutflow: 0,
      recentCount: 0,
    });
  });

  it('sums budget-currency amounts', () => {
    const stats = calculateTransactionStats(
      [
        { Inflow: 100, Outflow: 0, InflowOriginal: 90, OutflowOriginal: 0 },
        { Inflow: 0, Outflow: 40, InflowOriginal: 0, OutflowOriginal: 35 },
      ],
      null,
      'budget'
    );
    expect(stats).toEqual({ totalInflow: 100, totalOutflow: 40, recentCount: 2 });
  });

  it('sums account-currency (original) amounts, falling back to converted', () => {
    const stats = calculateTransactionStats(
      [
        { Inflow: 100, Outflow: 0, InflowOriginal: 90, OutflowOriginal: 0 },
        { Inflow: 0, Outflow: 40 }, // no originals -> fall back to converted
      ],
      null,
      'account'
    );
    expect(stats).toEqual({ totalInflow: 90, totalOutflow: 40, recentCount: 2 });
  });
});
