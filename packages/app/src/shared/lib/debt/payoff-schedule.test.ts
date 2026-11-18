import { describe, expect, it } from 'vitest';
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

  it('is unreachable when the payment cannot beat a later rate', () => {
    const rate = (i: number) => (i < 3 ? 0 : 0.05);
    expect(simulatePayoffSummary(1_000_000, rate, 10_000).months).toBeNull();
  });
});
