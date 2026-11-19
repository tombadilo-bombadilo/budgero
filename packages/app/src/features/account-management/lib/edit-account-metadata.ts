import {
  INTEREST_RATE_SCHEDULE_KEY,
  isConstantFrom,
  levelPayment,
  monthlyRateFn,
  normalizeRateSchedule,
  rateOn,
  rateSchedulesEqual,
  readRateSchedule,
  writeRateSchedule,
  type Account,
  type InterestRateEntry,
} from '@budgero/core/browser';
import { getTodayISO } from '@shared/lib/date-utils';
import { fromDecimal, toDecimal, type MilliUnits } from '@shared/lib/currency/milli';

/** Account.Metadata arrives as a JSON string from SQLite, or as an object. */
export function parseAccountMetadata(
  metadata: Account['Metadata'] | null | undefined
): Record<string, unknown> {
  if (!metadata) return {};
  if (typeof metadata === 'string') {
    try {
      const parsed: unknown = JSON.parse(metadata || '{}');
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
  return { ...metadata };
}

/**
 * The liability fields the edit form exposes; money is in DECIMAL form.
 * `rates[0]` is the initial rate (no date); later rows are dated changes.
 */
export interface LiabilityFormFields {
  debtTotal: number;
  rates: InterestRateEntry[];
  startDate: string;
  targetDate: string;
}

/**
 * Editor rows for an account's rates: always an initial row first (0 when no
 * rate is set), then each dated change. A schedule without an initial entry
 * takes its earliest rate as the initial one, which is how it reads anyway.
 */
export function rateRowsFromMetadata(
  md: Record<string, unknown>,
  today: string = getTodayISO()
): InterestRateEntry[] {
  const schedule = readRateSchedule(md, today);
  if (schedule.length === 0) return [{ rate_annual: 0 }];
  if (schedule[0].effective_date === undefined) return schedule;
  return [{ rate_annual: schedule[0].rate_annual }, ...schedule];
}

export function liabilityFormFromMetadata(
  md: Record<string, unknown>,
  today: string = getTodayISO()
): LiabilityFormFields {
  return {
    debtTotal: typeof md.debt_total === 'number' ? toDecimal(md.debt_total as MilliUnits) : 0,
    rates: rateRowsFromMetadata(md, today),
    startDate: typeof md.start_date === 'string' ? md.start_date : '',
    targetDate: typeof md.target_date === 'string' ? md.target_date : '',
  };
}

/** True when the edited rate rows differ from the ones the form started with. */
export function ratesChanged(initial: LiabilityFormFields, form: LiabilityFormFields): boolean {
  return !rateSchedulesEqual(
    normalizeRateSchedule(initial.rates),
    normalizeRateSchedule(form.rates)
  );
}

/** The rate in effect today for the edited rows (0 when none). */
export function currentFormRate(
  rates: readonly InterestRateEntry[],
  today: string = getTodayISO()
): number {
  return rateOn(normalizeRateSchedule(rates), today) ?? 0;
}

/**
 * Level monthly payment (milliunit float) that clears `outstanding` over
 * `months`, using each rate from its effective date. The plain annuity
 * formula when one rate applies throughout, as before.
 */
export function suggestedMonthlyPayment(
  outstanding: number,
  rates: readonly InterestRateEntry[],
  months: number,
  today: string = getTodayISO()
): number {
  const schedule = normalizeRateSchedule(rates);
  if (isConstantFrom(schedule, today)) {
    const mRate = (rateOn(schedule, today) ?? 0) / 100 / 12;
    return mRate > 0 ? (outstanding * mRate) / (1 - (1 + mRate) ** -months) : outstanding / months;
  }
  return levelPayment(outstanding, months, monthlyRateFn(schedule, today));
}

/**
 * The minimum payment an edit stores: the calculated one when its inputs
 * changed (or nothing is stored yet) and it can be calculated, else the stored
 * one. Credit cards have no target date, so their entered minimum survives.
 */
export function resolveMinPayment(
  md: Record<string, unknown>,
  initial: LiabilityFormFields,
  form: LiabilityFormFields,
  computed: MilliUnits | null
): MilliUnits | undefined {
  const stored =
    typeof md.min_payment_monthly === 'number' ? (md.min_payment_monthly as MilliUnits) : undefined;
  const inputsChanged = ratesChanged(initial, form) || form.targetDate !== initial.targetDate;
  if (computed !== null && (inputsChanged || stored === undefined)) return computed;
  return stored;
}

/**
 * Merge an edit into the stored metadata: only fields the user changed are
 * overwritten, so keys the form doesn't show (term_years, paid_so_far, links,
 * importer ids) survive. A cleared field is dropped.
 */
export function mergeLiabilityMetadata(
  md: Record<string, unknown>,
  accType: string,
  initial: LiabilityFormFields,
  form: LiabilityFormFields,
  computedMinPayment: MilliUnits | null,
  today: string = getTodayISO()
): Record<string, unknown> {
  const next: Record<string, unknown> = {
    ...md,
    liability: true,
    liability_type: accType.toLowerCase(),
    payment_frequency: md.payment_frequency ?? 'monthly',
  };
  if (form.debtTotal !== initial.debtTotal) {
    next.debt_total = form.debtTotal > 0 ? fromDecimal(form.debtTotal) : undefined;
  }
  // Rates: rewritten when edited, and on any save of an account that has a
  // schedule, so interest_rate_annual (what older clients read) catches up
  // with a change whose date has passed, and a rate an older client changed
  // is folded into the schedule.
  if (ratesChanged(initial, form) || Array.isArray(md[INTEREST_RATE_SCHEDULE_KEY])) {
    Object.assign(next, writeRateSchedule(next, form.rates, today));
  }
  if (form.startDate !== initial.startDate) {
    next.start_date = form.startDate || undefined;
  }
  if (form.targetDate !== initial.targetDate) {
    next.target_date = form.targetDate || undefined;
  }
  next.min_payment_monthly = resolveMinPayment(md, initial, form, computedMinPayment);
  return next;
}
