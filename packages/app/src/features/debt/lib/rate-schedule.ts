import { isConstantFrom, monthlyRateFn, type InterestRateEntry } from '@budgero/core/browser';
import { getLocaleTag } from '@shared/i18n';
import { formatShortDate, getTodayISO, parseDateKey } from '@shared/lib/date-utils';
import type { MonthlyRate } from '@shared/lib/debt/payoff-schedule';

/** An annual rate for display, e.g. 5.25 → "5.25" (up to 3 decimals, locale separators). */
export function formatRatePercent(rate: number): string {
  return new Intl.NumberFormat(getLocaleTag(), { maximumFractionDigits: 3 }).format(rate);
}

/** "Mar 1, 2027" for a YYYY-MM-DD key (the raw key if unparsable). */
export function formatRateDate(dateKey: string): string {
  const d = parseDateKey(dateKey);
  return d ? formatShortDate(d) : dateKey;
}

/**
 * Monthly rate for a payoff projection starting today: the schedule's
 * month-by-month rates when it changes in the future, else the single `apr`.
 */
export function projectionMonthlyRate(
  apr: number | undefined,
  schedule: readonly InterestRateEntry[] | undefined,
  today: string = getTodayISO()
): MonthlyRate {
  if (schedule && schedule.length > 0 && !isConstantFrom(schedule, today)) {
    return monthlyRateFn(schedule, today);
  }
  return apr ? apr / 100 / 12 : 0;
}
