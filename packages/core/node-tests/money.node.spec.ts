import { describe, expect, it } from 'vitest';
import {
  addMilli,
  asMilli,
  convertAtRate,
  fromDecimal,
  fromDecimalString,
  subMilli,
  sumMilli,
  roundToCents,
  toDecimal,
  type MilliUnits,
} from '../src/money/index.js';
import { ValidationError } from '../src/types/index.js';

const m = (n: number) => asMilli(n);

describe('asMilli', () => {
  it('brands safe integers', () => {
    expect(asMilli(0)).toBe(0);
    expect(asMilli(-15230)).toBe(-15230);
    expect(asMilli(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('rejects fractional, unsafe, and non-finite values', () => {
    expect(() => asMilli(12.34)).toThrow(ValidationError);
    expect(() => asMilli(Number.MAX_SAFE_INTEGER + 1)).toThrow(ValidationError);
    expect(() => asMilli(NaN)).toThrow(ValidationError);
    expect(() => asMilli(Infinity)).toThrow(ValidationError);
  });
});

describe('fromDecimal / toDecimal', () => {
  it('round-trips typical amounts exactly', () => {
    expect(fromDecimal(12.34)).toBe(12340);
    expect(fromDecimal(-0.01)).toBe(-10);
    expect(fromDecimal(0)).toBe(0);
    expect(toDecimal(m(12340))).toBe(12.34);
    expect(toDecimal(m(-10))).toBe(-0.01);
  });

  it('survives classic float artifacts', () => {
    // 0.1 + 0.2 === 0.30000000000000004
    expect(fromDecimal(0.1 + 0.2)).toBe(300);
    // 1.005 is stored as 1.00499999...; the artifact is below milliunit
    // resolution, so scaling to 1005 must not be affected by it
    expect(fromDecimal(1.005)).toBe(1005);
    expect(fromDecimal(4.015)).toBe(4015);
  });

  it('rejects non-finite input', () => {
    expect(() => fromDecimal(NaN)).toThrow(ValidationError);
    expect(() => fromDecimal(Infinity)).toThrow(ValidationError);
  });
});

describe('fromDecimalString', () => {
  it('parses without an intermediate float', () => {
    expect(fromDecimalString('12.34')).toBe(12340);
    expect(fromDecimalString('-1234.567')).toBe(-1234567);
    expect(fromDecimalString('0')).toBe(0);
    expect(fromDecimalString(' 15 ')).toBe(15000);
    expect(fromDecimalString('9.9')).toBe(9900);
  });

  it('rounds half-away-from-zero on the 4th fractional digit', () => {
    expect(fromDecimalString('1.00049')).toBe(1000);
    expect(fromDecimalString('1.00050')).toBe(1001);
    expect(fromDecimalString('-1.00050')).toBe(-1001);
  });

  it('rejects anything that is not a plain decimal', () => {
    for (const bad of ['', '1,234.5', '12.', '.5', '1e3', 'abc', '--1']) {
      expect(() => fromDecimalString(bad)).toThrow(ValidationError);
    }
  });
});

describe('convertAtRate', () => {
  it('rounds the float product back to integer milliunits', () => {
    expect(convertAtRate(m(10000), 1.1737)).toBe(11737);
    expect(convertAtRate(m(12340), 0.9231)).toBe(11391); // 11391.054 rounds down
    expect(convertAtRate(m(-12340), 0.9231)).toBe(-11391);
    expect(convertAtRate(m(12340), 1)).toBe(12340);
  });

  it('rejects non-finite rates', () => {
    expect(() => convertAtRate(m(1000), NaN)).toThrow(ValidationError);
    expect(() => convertAtRate(m(1000), Infinity)).toThrow(ValidationError);
  });
});

describe('integer arithmetic helpers', () => {
  it('sums exactly where float dollars would drift', () => {
    // 0.10 + 0.20 in dollars drifts; 100 + 200 milliunits does not
    const amounts = Array.from({ length: 1000 }, () => m(100));
    expect(sumMilli(amounts)).toBe(100_000);
    expect(addMilli(m(100), m(200))).toBe(300);
    expect(subMilli(m(300), m(200))).toBe(100);
  });

  it('propagates the safe-integer invariant', () => {
    expect(() => addMilli(m(Number.MAX_SAFE_INTEGER), m(1))).toThrow(ValidationError);
  });

  it('rounds milliunits to the nearest whole cent', () => {
    expect(roundToCents(m(357143))).toBe(357140); // €357.143 → €357.14
    expect(roundToCents(m(357144))).toBe(357140);
    expect(roundToCents(m(357145))).toBe(357150); // half-cent rounds up (Math.round)
    expect(roundToCents(m(0))).toBe(0);
    expect(roundToCents(m(-357143))).toBe(-357140);
    expect(roundToCents(m(357140))).toBe(357140); // already cent-aligned
  });
});

// Type-level checks: these must compile — MilliUnits is assignable to number,
// but a plain number is not assignable to MilliUnits.
const _display: number = m(100);
// @ts-expect-error plain numbers must not pass as MilliUnits
const _amount: MilliUnits = 100;
void _display;
void _amount;
