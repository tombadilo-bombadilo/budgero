import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setClock } from '../src/utils/clock.js';
import { computeLiabilityInfo } from '../src/services/accounts/account-calcs.js';
import {
  addMonthsToDate,
  levelPayment,
  monthlyRateFn,
  monthsToPayoff,
  nextRateChange,
  normalizeRateSchedule,
  rateOn,
  readRateSchedule,
  validateRateSchedule,
  writeRateSchedule,
} from '../src/services/accounts/interest-rate-schedule.js';

const TODAY = '2026-11-18';

beforeEach(() => setClock(new Date(2026, 10, 18, 12)));
afterEach(() => setClock(null));

/** Balance left after paying `payment` for `months` with month i at rate(i). */
function balanceAfter(
  principal: number,
  payment: number,
  months: number,
  rate: (i: number) => number
): number {
  let b = principal;
  for (let i = 0; i < months; i++) b = b * (1 + rate(i)) - payment;
  return b;
}

describe('readRateSchedule', () => {
  it('reads a legacy single rate as the initial rate', () => {
    expect(readRateSchedule({ interest_rate_annual: 6 }, TODAY)).toEqual([{ rate_annual: 6 }]);
    expect(readRateSchedule({ interest_rate_annual: '4.5' }, TODAY)).toEqual([
      { rate_annual: 4.5 },
    ]);
    expect(readRateSchedule({}, TODAY)).toEqual([]);
  });

  it('sorts entries, drops invalid ones and keeps the last of a repeated date', () => {
    const schedule = normalizeRateSchedule([
      { effective_date: '2027-06-01', rate_annual: 7 },
      { rate_annual: 5 },
      { effective_date: '2027-01-01', rate_annual: 6 },
      { effective_date: '2027-06-01', rate_annual: 7.5 },
      { effective_date: '2027-02-30', rate_annual: 9 },
      { effective_date: '2027-03-01', rate_annual: -1 },
      { rate_annual: 99 },
      null,
    ]);
    expect(schedule).toEqual([
      { rate_annual: 5 },
      { effective_date: '2027-01-01', rate_annual: 6 },
      { effective_date: '2027-06-01', rate_annual: 7.5 },
    ]);
  });

  it('applies a single rate changed by an older client from today, keeping future changes', () => {
    const md = {
      interest_rate_annual: 7,
      interest_rate_annual_synced: 5,
      interest_rate_schedule: [
        { rate_annual: 4 },
        { effective_date: '2026-01-01', rate_annual: 5 },
        { effective_date: '2027-06-01', rate_annual: 6 },
      ],
    };
    const schedule = readRateSchedule(md, TODAY);
    expect(schedule).toEqual([
      { rate_annual: 4 },
      { effective_date: '2026-01-01', rate_annual: 5 },
      { effective_date: TODAY, rate_annual: 7 },
      { effective_date: '2027-06-01', rate_annual: 6 },
    ]);
    // Unchanged single rate: the stored schedule is used as is.
    expect(readRateSchedule({ ...md, interest_rate_annual: 5 }, TODAY)).toHaveLength(3);
  });

  it('finds the rate in effect on a date and the next change', () => {
    const schedule = normalizeRateSchedule([
      { rate_annual: 3 },
      { effective_date: '2025-01-01', rate_annual: 4 },
      { effective_date: '2027-03-01', rate_annual: 6 },
    ]);
    expect(rateOn(schedule, '2024-12-31')).toBe(3);
    expect(rateOn(schedule, TODAY)).toBe(4);
    expect(rateOn(schedule, '2027-03-01')).toBe(6);
    expect(nextRateChange(schedule, TODAY)).toEqual({
      effective_date: '2027-03-01',
      rate_annual: 6,
    });
    expect(nextRateChange(schedule, '2027-03-01')).toBeUndefined();
  });
});

describe('writeRateSchedule', () => {
  it('stores an initial-only schedule the legacy way', () => {
    const md = {
      interest_rate_annual: 4,
      interest_rate_schedule: [
        { rate_annual: 4 },
        { effective_date: '2027-01-01', rate_annual: 5 },
      ],
      interest_rate_annual_synced: 4,
      term_years: 5,
    };
    const next = JSON.parse(JSON.stringify(writeRateSchedule(md, [{ rate_annual: 4.25 }], TODAY)));
    expect(next).toEqual({ interest_rate_annual: 4.25, term_years: 5 });
  });

  it('stores dated changes with the rate in effect today and its sync marker', () => {
    const next = writeRateSchedule(
      {},
      [
        { effective_date: '2027-05-01', rate_annual: 6 },
        { rate_annual: 0 },
        { effective_date: '2026-01-01', rate_annual: 4 },
      ],
      TODAY
    );
    expect(next).toEqual({
      interest_rate_annual: 4,
      interest_rate_annual_synced: 4,
      interest_rate_schedule: [
        { rate_annual: 0 },
        { effective_date: '2026-01-01', rate_annual: 4 },
        { effective_date: '2027-05-01', rate_annual: 6 },
      ],
    });
    expect(readRateSchedule(next, TODAY)).toEqual(next.interest_rate_schedule);
  });
});

describe('validateRateSchedule', () => {
  it('flags missing and repeated dates and out-of-range rates', () => {
    expect(validateRateSchedule([{ rate_annual: 5 }]).ok).toBe(true);
    const result = validateRateSchedule([
      { rate_annual: 5 },
      { effective_date: '2027-01-01', rate_annual: 6 },
      { effective_date: '2027-01-01', rate_annual: 7 },
      { effective_date: '', rate_annual: 7 },
      { effective_date: '2027-04-01', rate_annual: 150 },
    ]);
    expect(result).toEqual({
      ok: false,
      badDates: [3],
      duplicateDates: [2],
      badRates: [4],
    });
  });
});

describe('schedule math helpers', () => {
  it('clamps month arithmetic to the month length', () => {
    expect(addMonthsToDate('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonthsToDate('2026-11-18', 14)).toBe('2028-01-18');
  });

  it('levelPayment equals the annuity formula for a constant rate', () => {
    const r = 0.06 / 12;
    const annuity = (10_000_000 * r) / (1 - (1 + r) ** -120);
    expect(levelPayment(10_000_000, 120, () => r)).toBeCloseTo(annuity, 6);
  });

  it('monthsToPayoff walks a step-up', () => {
    const rate = monthlyRateFn(
      [{ rate_annual: 0 }, { effective_date: '2027-11-18', rate_annual: 24 }],
      TODAY
    );
    // 12 months at 0% clear 600k; the remaining 400k at 2%/month with 50k payments.
    expect(rate(11)).toBe(0);
    expect(rate(12)).toBeCloseTo(0.02, 12);
    const months = monthsToPayoff(1_000_000, 50_000, rate)!;
    expect(balanceAfter(1_000_000, 50_000, months - 1, rate)).toBeGreaterThan(0);
    expect(balanceAfter(1_000_000, 50_000, months, rate)).toBeLessThanOrEqual(1e-9);
    expect(monthsToPayoff(1_000_000, 10_000, rate)).toBeUndefined();
  });
});

describe('computeLiabilityInfo with a rate schedule', () => {
  const loanMd = { interest_rate_annual: 6, term_years: 10 };

  it('a legacy single rate gives the same results as before', () => {
    const legacy = computeLiabilityInfo({ Type: 'loan', Metadata: loanMd }, -10_000_000);
    expect(legacy?.minPayment).toBe(Math.round((10_000_000 * 0.005) / (1 - 1.005 ** -120)));
    expect(legacy?.apr).toBe(6);
    expect(legacy?.aprSchedule).toEqual([{ rate_annual: 6 }]);
    expect(legacy?.nextAprChange).toBeUndefined();

    // A schedule whose changes are all in the past and at today's rate is identical.
    const withHistory = computeLiabilityInfo(
      {
        Type: 'loan',
        Metadata: writeRateSchedule(
          { term_years: 10 },
          [{ rate_annual: 3 }, { effective_date: '2024-01-01', rate_annual: 6 }],
          TODAY
        ),
      },
      -10_000_000
    );
    expect({ ...withHistory, aprSchedule: undefined }).toEqual({
      ...legacy,
      aprSchedule: undefined,
    });
  });

  it('a rate change mid-term raises the level payment that clears the loan on time', () => {
    const md = writeRateSchedule(
      { term_years: 10 },
      [{ rate_annual: 6 }, { effective_date: '2031-11-18', rate_annual: 8 }],
      TODAY
    );
    const info = computeLiabilityInfo({ Type: 'loan', Metadata: md }, -10_000_000)!;
    expect(info.apr).toBe(6);
    expect(info.nextAprChange).toEqual({ effective_date: '2031-11-18', rate_annual: 8 });
    expect(info.payoffMonths).toBe(120);

    const at6 = (10_000_000 * 0.005) / (1 - 1.005 ** -120);
    const r8 = 0.08 / 12;
    const at8 = (10_000_000 * r8) / (1 - (1 + r8) ** -120);
    expect(info.minPayment!).toBeGreaterThan(at6);
    expect(info.minPayment!).toBeLessThan(at8);
    // 60 months at 6%, then 60 at 8%: the payment clears the balance.
    const rate = (i: number) => (i < 60 ? 0.005 : r8);
    expect(Math.abs(balanceAfter(10_000_000, info.minPayment!, 120, rate))).toBeLessThan(120);
    expect(info.estimatedTotalInterest).toBe(info.minPayment! * 120 - 10_000_000);
  });

  it('honours a future step-up after a 0% promo on a card with a set payment', () => {
    // Before schedules a 0% rate meant "no projection".
    const flat = computeLiabilityInfo(
      { Type: 'credit', Metadata: { min_payment_monthly: 50_000 } },
      -1_000_000
    );
    expect(flat?.payoffMonths).toBeUndefined();

    const md = writeRateSchedule(
      { min_payment_monthly: 50_000 },
      [{ rate_annual: 0 }, { effective_date: '2027-11-18', rate_annual: 24 }],
      TODAY
    );
    expect(md.interest_rate_annual).toBeUndefined();
    const info = computeLiabilityInfo({ Type: 'credit', Metadata: md }, -1_000_000)!;
    expect(info.apr).toBe(0);
    expect(info.minPayment).toBe(50_000);
    const rate = (i: number) => (i < 12 ? 0 : 0.02);
    const expected = monthsToPayoff(1_000_000, 50_000, rate);
    expect(info.payoffMonths).toBe(expected);
    expect(info.payoffMonths).toBeGreaterThan(20);
    expect(info.estimatedTotalInterest).toBeGreaterThan(0);
  });

  it('a past change only uses the current rate going forward', () => {
    const md = writeRateSchedule(
      { term_years: 10 },
      [{ rate_annual: 2 }, { effective_date: '2025-06-01', rate_annual: 6 }],
      TODAY
    );
    const info = computeLiabilityInfo({ Type: 'loan', Metadata: md }, -10_000_000);
    const legacy = computeLiabilityInfo({ Type: 'loan', Metadata: loanMd }, -10_000_000);
    expect(info?.minPayment).toBe(legacy?.minPayment);
    expect(info?.apr).toBe(6);
  });

  it('projects months from a fixed payment across a future change', () => {
    const md = writeRateSchedule(
      { min_payment_monthly: 200_000 },
      [{ rate_annual: 6 }, { effective_date: '2028-11-18', rate_annual: 9 }],
      TODAY
    );
    const info = computeLiabilityInfo({ Type: 'loan', Metadata: md }, -10_000_000)!;
    const legacy = computeLiabilityInfo(
      { Type: 'loan', Metadata: { interest_rate_annual: 6, min_payment_monthly: 200_000 } },
      -10_000_000
    )!;
    expect(info.payoffMonths!).toBeGreaterThan(legacy.payoffMonths!);
    const rate = (i: number) => (i < 24 ? 0.005 : 0.09 / 12);
    expect(info.payoffMonths).toBe(monthsToPayoff(10_000_000, 200_000, rate));
  });
});
