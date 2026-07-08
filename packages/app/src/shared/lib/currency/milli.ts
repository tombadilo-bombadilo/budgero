/**
 * Milliunit display/input helpers.
 *
 * Every stored, queried, or op-carried amount in the app is an integer
 * MilliUnits value (1/1000 currency unit; $12.34 = 12340) — see
 * @budgero/core's money module. Two rules keep the boundary sane:
 *
 *  - Anything shaped like Intl.NumberFormat always formats DECIMAL values.
 *    To display a stored amount, go through {@link formatMilli} (or
 *    `nf.format(toDecimal(m))`).
 *  - User input parses to decimal first, then crosses into the app as
 *    milliunits via `fromDecimal` exactly once.
 */

import { toDecimal, type MilliUnits } from '@budgero/core/browser';

export { asMilli, fromDecimal, sumMilli, toDecimal, ZERO_MILLI } from '@budgero/core/browser';
export type { MilliUnits } from '@budgero/core/browser';

/** Formats a stored milliunit amount with a decimal-speaking localizer. */
export function formatMilli(
  localizer: { format: (value: number) => string },
  amount: MilliUnits
): string {
  return localizer.format(toDecimal(amount));
}
