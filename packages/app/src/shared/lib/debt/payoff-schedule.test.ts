import { describe, expect, it } from 'vitest';
import { monthsToPayoff } from '@budgero/core/browser';
import { buildPayoffSchedule, simulatePayoffSummary } from './payoff-schedule';

describe('payoff schedule with changing rates', () => {
  it('a constant-rate function matches the plain rate exactly', () => {
    const r = 0.06 / 12;
    expect(simulatePayoffSummary(10_000_000, () => r, 200_000)).toEqual(
      simulatePayoffSummary(10_000_000, r, 200_000)
    );
    const fixed = buildPayoffSchedule(10_000_000, r, 200_000, 10_000, 50_000);
    const fn = buildPayoffSchedule(10_000_000, () => r, 200_000, 10_000, 50_000);
    expect(fn.months).toBe(fixed.months);
    expect(fn.interestPaid).toBe(fixed.interestPaid);
  });

  it('charges each month at its own rate', () => {
    // 0% for 12 months, then 2%/month.
    const rate = (i: number) => (i < 12 ? 0 : 0.02);
    const plan = buildPayoffSchedule(1_000_000, rate, 50_000, 0, 0);
    expect(plan.rows[11].interest).toBe(0);
    expect(plan.rows[11].remaining).toBeCloseTo(400_000, 6);
    expect(plan.rows[12].interest).toBeCloseTo(8_000, 6);
    expect(simulatePayoffSummary(1_000_000, rate, 50_000).months).toBe(plan.months);
    expect(plan.interestPaid).toBeGreaterThan(0);
  });

  it('is unreachable when the payment cannot beat a later rate, with no rows', () => {
    const rate = (i: number) => (i < 3 ? 0 : 0.05);
    expect(simulatePayoffSummary(1_000_000, rate, 10_000).months).toBeNull();
    // 5,000 at 0% for 3 months, then 25%/yr, paying 50: never paid off.
    const rising = (i: number) => (i < 3 ? 0 : 0.25 / 12);
    expect(simulatePayoffSummary(5_000_000, rising, 50_000)).toEqual({ months: null });
    expect(buildPayoffSchedule(5_000_000, rising, 50_000, 0, 0)).toEqual({
      rows: [],
      months: null,
    });
  });

  it('lets a falling rate decide instead of month 0 alone', () => {
    // 5,000 at 24%/yr now (interest 100 > payment 90), 0% from month 2.
    const falling = (i: number) => (i < 2 ? 0.02 : 0);
    const summary = simulatePayoffSummary(5_000_000, falling, 90_000);
    expect(summary.months).toBe(58);
    // Same answer as the account page's projection (core).
    expect(monthsToPayoff(5_000_000, 90_000, falling)).toBe(58);
    const plan = buildPayoffSchedule(5_000_000, falling, 90_000, 0, 0);
    expect(plan.months).toBe(58);
    expect(plan.rows).toHaveLength(58);
    expect(plan.rows[57].remaining).toBeLessThan(1e-7);
    // A single fixed rate the payment can't beat is still rejected up front.
    expect(simulatePayoffSummary(5_000_000, 0.02, 90_000).months).toBeNull();
  });
});
