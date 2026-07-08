/**
 * Currency rounding helpers (integer-milliunit era).
 *
 * Stored amounts are exact integer milliunits, so sums and differences of
 * row values never drift. Rounding is still needed where money passes
 * through float math (rates, percentages, proportional splits): round the
 * result back to an integer milliunit before storing or comparing.
 */

import { asMilli, type MilliUnits } from '@budgero/core/browser';

/** Round a decimal value to the given number of fraction digits (rates, display math). */
export function roundToFractionDigits(value: number, fractionDigits: number): number {
  if (!Number.isFinite(value)) return value;
  const factor = 10 ** fractionDigits;
  return Math.round(value * factor) / factor;
}

/** Round a possibly-float milliunit computation back to an exact integer amount. */
export function roundMilli(value: number): MilliUnits {
  if (!Number.isFinite(value)) return asMilli(0);
  const rounded = Math.round(value);
  return asMilli(Object.is(rounded, -0) ? 0 : rounded);
}

/**
 * Whether `value` exceeds `limit`, in milliunits. Both sides are rounded to
 * integer milliunits first so float residuals from rate math never count as
 * an overage.
 */
export function exceedsAmount(value: number, limit: number): boolean {
  return roundMilli(value) - roundMilli(limit) > 0;
}
