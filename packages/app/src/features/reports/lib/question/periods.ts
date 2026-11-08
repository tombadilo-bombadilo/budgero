/**
 * Date ranges of relative / between date filters, and "the same period
 * before it" for number-with-trend comparisons. Mirrors the SQL in
 * compile.ts (weeks start on Monday, like DuckDB's DATE_TRUNC('week')).
 */
import {
  isValidIsoDate,
  trendDateFilter,
  type QuestionFilter,
  type QuestionSpec,
  type RelativeUnit,
} from './spec';

export interface DateRange {
  /** Inclusive ISO dates. */
  from: string;
  to: string;
}

function parse(iso: string): Date {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

/** ISO date of a UTC-midnight date (all arithmetic here is in UTC days). */
function format(date: Date): string {
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${date.getUTCFullYear()}-${month}-${day}`;
}

function addDays(iso: string, days: number): string {
  const date = parse(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return format(date);
}

/** Adds calendar months, clamping the day to the target month's length. */
function addMonths(iso: string, months: number): string {
  const date = parse(iso);
  const day = date.getUTCDate();
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0));
  target.setUTCDate(Math.min(day, last.getUTCDate()));
  return format(target);
}

function shift(iso: string, unit: RelativeUnit, amount: number): string {
  switch (unit) {
    case 'day':
      return addDays(iso, amount);
    case 'week':
      return addDays(iso, amount * 7);
    case 'month':
      return addMonths(iso, amount);
    case 'quarter':
      return addMonths(iso, amount * 3);
    case 'year':
      return addMonths(iso, amount * 12);
  }
}

function startOf(iso: string, unit: RelativeUnit): string {
  const date = parse(iso);
  switch (unit) {
    case 'day':
      return iso;
    case 'week': {
      const weekday = (date.getUTCDay() + 6) % 7; // Monday = 0
      return addDays(iso, -weekday);
    }
    case 'month':
      return format(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)));
    case 'quarter': {
      const month = Math.floor(date.getUTCMonth() / 3) * 3;
      return format(new Date(Date.UTC(date.getUTCFullYear(), month, 1)));
    }
    case 'year':
      return format(new Date(Date.UTC(date.getUTCFullYear(), 0, 1)));
  }
}

function daysBetween(from: string, to: string): number {
  return Math.round((parse(to).getTime() - parse(from).getTime()) / 86_400_000);
}

/** Local "today" as an ISO date. */
export function todayIso(now: Date = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

export interface TrendPeriods {
  current: DateRange;
  previous: DateRange;
}

/**
 * The range a date filter covers (up to today for periods that include the
 * current one) and the same span right before it. A partial current period
 * compares with the same number of elapsed days/months before it, so "this
 * month so far" is set against "last month up to the same day".
 */
export function trendPeriods(filter: QuestionFilter, today: string): TrendPeriods | null {
  if (!isValidIsoDate(today)) return null;
  if (filter.op === 'between') {
    const [from, to] = filter.values as string[];
    if (!isValidIsoDate(from) || !isValidIsoDate(to)) return null;
    const length = daysBetween(from, to) + 1;
    return {
      current: { from, to },
      previous: { from: addDays(from, -length), to: addDays(from, -1) },
    };
  }
  if (filter.op !== 'previous' && filter.op !== 'current') return null;
  const unit = filter.unit ?? 'month';
  const amount = filter.op === 'current' ? 1 : Math.max(1, filter.amount ?? 1);
  const includeCurrent = filter.op === 'current' || filter.includeCurrent !== false;
  const start = startOf(today, unit);
  if (includeCurrent) {
    const from = shift(start, unit, -(amount - 1));
    return {
      current: { from, to: today },
      previous: { from: shift(from, unit, -amount), to: shift(today, unit, -amount) },
    };
  }
  const from = shift(start, unit, -amount);
  const to = addDays(start, -1);
  return {
    current: { from, to },
    previous: { from: shift(from, unit, -amount), to: addDays(from, -1) },
  };
}

/**
 * The question re-scoped to the period before its date filter (for a number
 * with trend that has no date grouping), or null when it has no such filter.
 */
export function previousPeriodQuestion(spec: QuestionSpec, today: string): QuestionSpec | null {
  const filter = trendDateFilter(spec);
  if (!filter) return null;
  const periods = trendPeriods(filter, today);
  if (!periods) return null;
  const { from, to } = periods.previous;
  return {
    ...spec,
    filters: spec.filters.map((entry) =>
      entry === filter ? { field: filter.field, op: 'between', values: [from, to] } : entry
    ),
  };
}
