/**
 * Interest rates that change over time on a liability account.
 *
 * Stored in the account's metadata JSON, next to the single legacy rate:
 *
 *   interest_rate_schedule: [
 *     { rate_annual: 4.5 },                                // initial rate, from the start
 *     { effective_date: '2027-03-01', rate_annual: 6.1 },  // a dated change
 *   ]
 *   interest_rate_annual: 4.5          // rate in effect on the day of the save
 *   interest_rate_annual_synced: 4.5   // the value written to interest_rate_annual
 *
 * `interest_rate_annual` stays the field older clients, imports and anything
 * else read and write. `interest_rate_annual_synced` records what this code
 * wrote there, so a later edit of the single rate by a client that does not
 * know the schedule is detected (the two differ) and treated as a rate change
 * effective today instead of being silently ignored.
 *
 * An account without a schedule keeps only `interest_rate_annual`, exactly as
 * before: it reads as a schedule with one initial entry.
 *
 * Pure functions, no DB or UI dependencies.
 */

import { getLocalDateString } from '../../utils/date.js';
import { clock } from '../../utils/clock.js';

export const INTEREST_RATE_SCHEDULE_KEY = 'interest_rate_schedule';
export const INTEREST_RATE_SYNCED_KEY = 'interest_rate_annual_synced';

/** Highest annual rate (percent) the editor accepts. */
export const MAX_INTEREST_RATE_ANNUAL = 100;

export interface InterestRateEntry {
  /** YYYY-MM-DD the rate applies from; absent on the initial rate. */
  effective_date?: string;
  /** Annual percentage rate, e.g. 5.25 for 5.25%. */
  rate_annual: number;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isValidRateDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return (
    d.getUTCFullYear() === Number(m[1]) &&
    d.getUTCMonth() === Number(m[2]) - 1 &&
    d.getUTCDate() === Number(m[3])
  );
}

function toRate(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? parseFloat(value) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/** The legacy single rate, or undefined when unset/unreadable. */
export function readLegacyRate(md: Record<string, unknown>): number | undefined {
  return toRate(md.interest_rate_annual);
}

/**
 * Sort and clean entries: invalid rates and dates are dropped, the first
 * undated entry is the initial rate (later undated ones are dropped), and a
 * repeated date keeps its last entry.
 */
export function normalizeRateSchedule(entries: readonly unknown[]): InterestRateEntry[] {
  let initial: InterestRateEntry | undefined;
  const byDate = new Map<string, InterestRateEntry>();
  for (const raw of entries) {
    if (!raw || typeof raw !== 'object') continue;
    const e = raw as Record<string, unknown>;
    const rate = toRate(e.rate_annual);
    if (rate === undefined) continue;
    const date = e.effective_date;
    if (date === undefined || date === null || date === '') {
      initial ??= { rate_annual: rate };
    } else if (isValidRateDate(date)) {
      byDate.set(date, { effective_date: date, rate_annual: rate });
    }
  }
  const dated = [...byDate.values()].sort((a, b) =>
    a.effective_date! < b.effective_date! ? -1 : 1
  );
  return initial ? [initial, ...dated] : dated;
}

/**
 * The rate schedule an account's metadata describes, normalized. A legacy
 * single rate is the initial entry. When the single rate was changed by a
 * client that doesn't know the schedule, that rate applies from `today`.
 */
export function readRateSchedule(
  md: Record<string, unknown>,
  today: string = getLocalDateString(clock.date())
): InterestRateEntry[] {
  const legacy = readLegacyRate(md);
  const raw = md[INTEREST_RATE_SCHEDULE_KEY];
  const schedule = Array.isArray(raw) ? normalizeRateSchedule(raw) : [];
  if (schedule.length === 0) {
    return legacy !== undefined ? [{ rate_annual: legacy }] : [];
  }
  const synced = toRate(md[INTEREST_RATE_SYNCED_KEY]);
  if (synced !== undefined && (legacy ?? 0) !== synced) {
    return normalizeRateSchedule([
      ...schedule,
      { effective_date: today, rate_annual: legacy ?? 0 },
    ]);
  }
  return schedule;
}

/**
 * The entry in effect on `date`: the last dated entry on or before it, else
 * the initial rate. Before the first dated entry with no initial rate, the
 * earliest entry is used, since nothing earlier is known.
 */
export function rateEntryOn(
  schedule: readonly InterestRateEntry[],
  date: string
): InterestRateEntry | undefined {
  let found: InterestRateEntry | undefined;
  for (const entry of schedule) {
    if (entry.effective_date === undefined || entry.effective_date <= date) found = entry;
    else break;
  }
  return found ?? schedule[0];
}

export function rateOn(schedule: readonly InterestRateEntry[], date: string): number | undefined {
  return rateEntryOn(schedule, date)?.rate_annual;
}

/** The first dated change after `today`, if one is scheduled. */
export function nextRateChange(
  schedule: readonly InterestRateEntry[],
  today: string = getLocalDateString(clock.date())
): InterestRateEntry | undefined {
  return schedule.find((e) => e.effective_date !== undefined && e.effective_date > today);
}

/** True when some period from `today` on accrues interest. */
export function hasInterestFrom(schedule: readonly InterestRateEntry[], today: string): boolean {
  if (schedule.length === 0) return false;
  if ((rateOn(schedule, today) ?? 0) > 0) return true;
  return schedule.some(
    (e) => e.effective_date !== undefined && e.effective_date > today && e.rate_annual > 0
  );
}

/** YYYY-MM-DD `months` after `start`, day clamped to the month's length. */
export function addMonthsToDate(start: string, months: number): string {
  const m = DATE_RE.exec(start);
  if (!m) return start;
  const total = Number(m[1]) * 12 + (Number(m[2]) - 1) + months;
  const year = Math.floor(total / 12);
  const month = total - year * 12;
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(Number(m[3]), daysInMonth);
  return `${String(year).padStart(4, '0')}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Monthly interest rate for a projection month. */
export type MonthlyRateFn = (monthIndex: number) => number;

/**
 * Monthly rate (fraction) for projection month `i`, the period starting `i`
 * months after `today`. A change applies from the first monthly period
 * starting on or after its effective date.
 */
export function monthlyRateFn(
  schedule: readonly InterestRateEntry[],
  today: string = getLocalDateString(clock.date())
): MonthlyRateFn {
  const cache = new Map<number, number>();
  return (i: number) => {
    let r = cache.get(i);
    if (r === undefined) {
      r = (rateOn(schedule, addMonthsToDate(today, i)) ?? 0) / 100 / 12;
      cache.set(i, r);
    }
    return r;
  };
}

/** True when the schedule has no dated change after `today` (one rate applies throughout). */
export function isConstantFrom(schedule: readonly InterestRateEntry[], today: string): boolean {
  const current = rateOn(schedule, today) ?? 0;
  return !schedule.some(
    (e) => e.effective_date !== undefined && e.effective_date > today && e.rate_annual !== current
  );
}

/**
 * Level monthly payment that clears `principal` in `months` payments when
 * month i accrues interest at `rate(i)` (payment at the end of each month).
 * Equal to the annuity formula when the rate is constant.
 */
export function levelPayment(principal: number, months: number, rate: MonthlyRateFn): number {
  const n = Math.max(1, Math.round(months));
  // principal = P * sum_k prod_{j<=k} 1/(1+r_j)
  let discount = 1;
  let sum = 0;
  for (let k = 0; k < n; k++) {
    discount /= 1 + rate(k);
    sum += discount;
  }
  return principal / sum;
}

/** Months until a fixed payment clears `principal`, or undefined if it never does. */
export function monthsToPayoff(
  principal: number,
  payment: number,
  rate: MonthlyRateFn,
  maxMonths = 360 * 5
): number | undefined {
  if (principal <= 0) return 0;
  if (payment <= 0) return undefined;
  let balance = principal;
  for (let i = 0; i < maxMonths; i++) {
    balance += balance * rate(i);
    balance -= payment;
    if (balance <= 1e-9) return i + 1;
  }
  return undefined;
}

export interface RateScheduleValidation {
  ok: boolean;
  /** Indices of entries with a missing or invalid date (dated rows only). */
  badDates: number[];
  /** Indices of entries whose date repeats an earlier one. */
  duplicateDates: number[];
  /** Indices of entries with a rate outside 0..MAX_INTEREST_RATE_ANNUAL. */
  badRates: number[];
}

/**
 * Validate editor rows before saving. Row 0 is the initial rate (no date);
 * every later row needs a valid, unique date.
 */
export function validateRateSchedule(
  rows: readonly { effective_date?: string; rate_annual: number }[]
): RateScheduleValidation {
  const badDates: number[] = [];
  const duplicateDates: number[] = [];
  const badRates: number[] = [];
  const seen = new Set<string>();
  rows.forEach((row, i) => {
    if (
      !Number.isFinite(row.rate_annual) ||
      row.rate_annual < 0 ||
      row.rate_annual > MAX_INTEREST_RATE_ANNUAL
    ) {
      badRates.push(i);
    }
    if (i === 0) return;
    if (!isValidRateDate(row.effective_date)) {
      badDates.push(i);
    } else if (seen.has(row.effective_date)) {
      duplicateDates.push(i);
    } else {
      seen.add(row.effective_date);
    }
  });
  return {
    ok: badDates.length === 0 && duplicateDates.length === 0 && badRates.length === 0,
    badDates,
    duplicateDates,
    badRates,
  };
}

/** True when two schedules hold the same rates on the same dates. */
export function rateSchedulesEqual(
  a: readonly InterestRateEntry[],
  b: readonly InterestRateEntry[]
): boolean {
  if (a.length !== b.length) return false;
  return a.every(
    (e, i) => e.effective_date === b[i].effective_date && e.rate_annual === b[i].rate_annual
  );
}

/**
 * Write a schedule into metadata (returns a copy). A schedule that is just an
 * initial rate is stored the legacy way (only `interest_rate_annual`), so
 * single-rate accounts look exactly as they always have. Otherwise the
 * schedule, the rate in effect `today` and its sync marker are stored. A zero
 * or missing current rate clears `interest_rate_annual`, as before.
 */
export function writeRateSchedule(
  md: Record<string, unknown>,
  entries: readonly InterestRateEntry[],
  today: string = getLocalDateString(clock.date())
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...md };
  const schedule = normalizeRateSchedule(entries);
  const current = rateOn(schedule, today) ?? 0;
  next.interest_rate_annual = current > 0 ? current : undefined;
  const hasChanges = schedule.some((e) => e.effective_date !== undefined);
  if (hasChanges) {
    next[INTEREST_RATE_SCHEDULE_KEY] = schedule;
    next[INTEREST_RATE_SYNCED_KEY] = current;
  } else {
    next[INTEREST_RATE_SCHEDULE_KEY] = undefined;
    next[INTEREST_RATE_SYNCED_KEY] = undefined;
  }
  return next;
}
