/**
 * Money arithmetic in integer milliunits (1/1000 of a currency unit).
 *
 * All monetary amounts in the database and domain layer are integer
 * milliunits (`MilliUnits`), never decimal floats. Integers up to 2^53-1 are
 * exact in IEEE 754 doubles, so addition/subtraction/comparison of amounts is
 * exact at native speed. Floats appear only transiently inside
 * multiplications (FX rates, interest), and every such result is rounded back
 * to an integer at exactly one place before it re-enters the domain.
 *
 * The `MilliUnits` brand makes the compiler reject accidental mixing of
 * stored amounts with decimal display values: a plain `number` cannot be
 * assigned where `MilliUnits` is expected without going through one of the
 * constructors below.
 */

import { ValidationError } from '../types/index.js';

declare const MILLI_UNITS_BRAND: unique symbol;

/** An exact monetary amount in integer milliunits (1/1000 currency unit). */
export type MilliUnits = number & { readonly [MILLI_UNITS_BRAND]: true };

/** Milliunits per whole currency unit. */
export const MILLIS_PER_UNIT = 1000;

/** Milliunits in one cent — the smallest amount the UI displays or a user can assign. */
export const MILLIS_PER_CENT = 10;

export const ZERO_MILLI = 0 as MilliUnits;

/**
 * Rounds a milliunit amount to the nearest whole cent. Use when a computed
 * amount (e.g. an even split like target/N) must be something the user can
 * actually see and assign — otherwise a sub-cent remainder shows as €0.00 yet
 * still fails a `>=` funded check, nagging for a fraction of a cent.
 */
export function roundToCents(amount: MilliUnits): MilliUnits {
  return asMilli(Math.round(amount / MILLIS_PER_CENT) * MILLIS_PER_CENT);
}

/**
 * Brands a raw number that is already an integer milliunit amount — the
 * re-entry point after arithmetic (`asMilli(a + b)`) and after reading rows
 * from the database. Throws if the value is not a safe integer, which is the
 * invariant the whole money layer rests on.
 */
export function asMilli(value: number): MilliUnits {
  if (!Number.isSafeInteger(value)) {
    throw new ValidationError(`Amount is not an integer milliunit value: ${value}`, 'amount');
  }
  return value as MilliUnits;
}

/** Converts a decimal currency amount (e.g. user input `12.34`) to milliunits. */
export function fromDecimal(amount: number): MilliUnits {
  if (!Number.isFinite(amount)) {
    throw new ValidationError(`Amount is not a finite number: ${amount}`, 'amount');
  }
  return asMilli(Math.round(amount * MILLIS_PER_UNIT));
}

/**
 * Converts milliunits back to a decimal number for display, charting, and
 * export. Display-boundary only: the result is a float and must never be
 * written back without going through `fromDecimal`.
 */
export function toDecimal(amount: MilliUnits): number {
  return amount / MILLIS_PER_UNIT;
}

/**
 * Parses a plain decimal string ("-1234.567") to milliunits without an
 * intermediate float, so amounts with many digits stay exact. Rounds
 * half-away-from-zero on the 4th fractional digit. Import parsers normalize
 * locale separators before calling this.
 */
export function fromDecimalString(input: string): MilliUnits {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(input.trim());
  if (!match) {
    throw new ValidationError(`Not a plain decimal amount: "${input}"`, 'amount');
  }
  const [, sign, whole, frac = ''] = match;
  const milli = frac.slice(0, 3).padEnd(3, '0');
  let value = Number(whole) * MILLIS_PER_UNIT + Number(milli);
  if (frac.length > 3 && Number(frac[3]) >= 5) value += 1;
  return asMilli(sign === '-' ? -value : value);
}

/**
 * Multiplies an amount by a decimal rate (FX conversion, interest,
 * percentage rules) and rounds the result back to integer milliunits. This is
 * the one sanctioned place where money passes through float multiplication.
 */
export function convertAtRate(amount: MilliUnits, rate: number): MilliUnits {
  if (!Number.isFinite(rate)) {
    throw new ValidationError(`Rate is not a finite number: ${rate}`, 'rate');
  }
  return asMilli(Math.round(amount * rate));
}

/** Exact integer sum of milliunit amounts. */
export function sumMilli(amounts: readonly MilliUnits[]): MilliUnits {
  let total = 0;
  for (const amount of amounts) total += amount;
  return asMilli(total);
}

/** `a + b` with the brand preserved. */
export function addMilli(a: MilliUnits, b: MilliUnits): MilliUnits {
  return asMilli(a + b);
}

/** `a - b` with the brand preserved. */
export function subMilli(a: MilliUnits, b: MilliUnits): MilliUnits {
  return asMilli(a - b);
}
