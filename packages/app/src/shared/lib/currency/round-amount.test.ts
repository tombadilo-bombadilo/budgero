import { describe, expect, it } from 'vitest';
import { exceedsAmount, roundMilli, roundToFractionDigits } from './round-amount';

describe('roundToFractionDigits', () => {
  it('rounds to cents', () => {
    expect(roundToFractionDigits(1.014, 2)).toBe(1.01);
    expect(roundToFractionDigits(1.016, 2)).toBe(1.02);
    expect(roundToFractionDigits(0.1 + 0.35, 2)).toBe(0.45);
  });

  it('collapses tiny float residuals to zero', () => {
    expect(roundToFractionDigits(0.45 - (0.1 + 0.35), 2)).toBe(0);
  });

  it('passes non-finite values through', () => {
    expect(roundToFractionDigits(Number.NaN, 2)).toBeNaN();
  });
});

describe('roundMilli', () => {
  it('rounds float residuals from rate math back to integer milliunits', () => {
    expect(roundMilli(449.99999999999994)).toBe(450);
    expect(roundMilli(450.00000000000006)).toBe(450);
  });

  it('normalizes negative zero and non-finite values to zero', () => {
    expect(Object.is(roundMilli(-0.0000001), 0)).toBe(true);
    expect(roundMilli(Number.NaN)).toBe(0);
    expect(roundMilli(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('exceedsAmount', () => {
  it('does not flag a float residual as an overage', () => {
    // Real-world case: 450 milli ($0.45) ready to assign, assigning 450 milli.
    // Rate math can leave a binary-float residual on the limit, so the raw
    // difference is a tiny positive number that must not trip the popup.
    const readyToAssign = (0.1 + 0.35) * 1000; // 449.99999999999994 milli
    expect(exceedsAmount(450, readyToAssign)).toBe(false);
  });

  it('flags a genuine overage', () => {
    expect(exceedsAmount(460, 450)).toBe(true);
    expect(exceedsAmount(10_000, 450)).toBe(true);
  });

  it('does not flag amounts at or below the limit', () => {
    expect(exceedsAmount(450, 450)).toBe(false);
    expect(exceedsAmount(400, 450)).toBe(false);
  });
});
