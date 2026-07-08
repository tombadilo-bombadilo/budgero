import { parseISO, isValid, isAfter, endOfDay } from 'date-fns';

/**
 * Normalize any date-like value to a Date object.
 * Handles Date objects, timestamps, ISO strings, and various string formats.
 *
 * @param value - The value to normalize (Date, number, string, or unknown)
 * @returns A valid Date object or null if parsing fails
 *
 * @example
 * normalizeDate(new Date()) // Date object
 * normalizeDate(1704067200000) // Date from timestamp
 * normalizeDate('2024-01-01') // Date from ISO string
 * normalizeDate('2024-01-01 12:00:00') // Date from datetime string
 */
function normalizeDate(value: unknown): Date | null {
  if (!value) return null;

  if (value instanceof Date) {
    return isValid(value) ? value : null;
  }

  if (typeof value === 'number') {
    const asDate = new Date(value);
    return isValid(asDate) ? asDate : null;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;

    // Try ISO format first (handles 'YYYY-MM-DD' and 'YYYY-MM-DDTHH:mm:ss')
    const parsed = parseISO(trimmed.includes(' ') ? trimmed.replace(' ', 'T') : trimmed);
    if (isValid(parsed)) return parsed;

    const numeric = Number(trimmed);
    if (!Number.isNaN(numeric)) {
      const fromNumeric = new Date(numeric);
      if (isValid(fromNumeric)) return fromNumeric;
    }

    const fromString = new Date(trimmed);
    return isValid(fromString) ? fromString : null;
  }

  return null;
}

/** Zero-padded year/month/day parts for a date's local or UTC calendar day. */
function buildDateParts(date: Date, utc: boolean): { year: number; month: string; day: string } {
  const year = utc ? date.getUTCFullYear() : date.getFullYear();
  const month = String((utc ? date.getUTCMonth() : date.getMonth()) + 1).padStart(2, '0');
  const day = String(utc ? date.getUTCDate() : date.getDate()).padStart(2, '0');
  return { year, month, day };
}

/**
 * Format a Date to ISO date string (YYYY-MM-DD).
 * Used for database storage and API communication.
 *
 * @param date - The date to format
 * @returns ISO date string in YYYY-MM-DD format
 *
 * @example
 * formatDateISO(new Date(2024, 0, 15)) // '2024-01-15'
 */
export function formatDateISO(date: Date): string {
  const { year, month, day } = buildDateParts(date, false);
  return `${year}-${month}-${day}`;
}

/**
 * Compute the projected payoff date as an ISO string (YYYY-MM-DD) by advancing
 * today's date forward by the given number of months.
 *
 * @param months - Number of months until payoff, or null if unreachable
 * @returns ISO date string, or null when months is null
 */
export function computePayoffDate(months: number | null): string | null {
  if (months === null) return null;
  const d = new Date();
  d.setMonth(d.getMonth() + (months || 0));
  return formatDateISO(d);
}

/**
 * Get the start of a month (first day at 00:00:00).
 *
 * @param date - Any date within the target month
 * @returns Date representing the first day of the month
 */
export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

/**
 * Get the end of a month (last day at 00:00:00.000).
 *
 * @param date - Any date within the target month
 * @returns Date representing the last day of the month
 */
export function endOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

/**
 * Get month key in YYYY-MM format.
 *
 * @param date - The date to extract month from
 * @returns Month string in YYYY-MM format
 *
 * @example
 * getMonthKey(new Date(2024, 5, 15)) // '2024-06'
 */
export function getMonthKey(date: Date): string {
  const { year, month } = buildDateParts(date, false);
  return `${year}-${month}`;
}

/**
 * Format a Date as a UTC ISO date string (YYYY-MM-DD).
 *
 * Use only when the value must be anchored to UTC (e.g. server-aligned
 * analytics windows or reward periods). For user-facing calendar dates prefer
 * {@link formatDateISO}, which uses the local timezone.
 */
export function formatDateUtcISO(date: Date): string {
  const { year, month, day } = buildDateParts(date, true);
  return `${year}-${month}-${day}`;
}

/**
 * Get a UTC month key in YYYY-MM format. UTC counterpart of {@link getMonthKey}.
 */
export function getUtcMonthKey(date: Date): string {
  const { year, month } = buildDateParts(date, true);
  return `${year}-${month}`;
}

/**
 * Get today's date as an ISO string (YYYY-MM-DD).
 * Uses local timezone, not UTC.
 *
 * @returns Today's date in YYYY-MM-DD format
 *
 * @example
 * getTodayISO() // '2024-01-15' (if today is Jan 15, 2024)
 */
export function getTodayISO(): string {
  return formatDateISO(new Date());
}

/**
 * True when `value` falls strictly after the end of *today* (local time).
 *
 * Recomputes "today" on every call via `new Date()`, so it stays correct in
 * long-lived sessions that cross midnight — unlike a cached
 * `endOfDay(new Date())` captured at module load or render time, which would
 * leave today's transactions wrongly flagged as future after midnight.
 */
export function isFutureDate(value: unknown): boolean {
  const date = normalizeDate(value);
  if (!date) return false;
  return isAfter(date, endOfDay(new Date()));
}

/**
 * Ensure a timezone-naive timestamp string is treated as UTC by appending
 * a trailing 'Z' when one is not already present.
 *
 * @param value - The timestamp string to normalize
 * @returns The value with a guaranteed trailing 'Z'
 */
export function normalizeUtcString(value: string): string {
  return value?.endsWith('Z') ? value : `${value}Z`;
}

/**
 * Format a timezone-naive UTC timestamp string for display using the user's
 * locale. Falls back to the original value if it cannot be parsed.
 *
 * @param value - The timestamp string to format
 * @returns Locale-formatted timestamp, or the original value if invalid
 */
export function formatUtcTimestamp(value: string): string {
  const normalized = normalizeUtcString(value);
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

/**
 * Extract a `YYYY-MM-DD` date key from a date-like value in a timezone-agnostic
 * way. Unlike `new Date(value)` + formatting (which can shift a bare
 * `YYYY-MM-DD` string across a calendar day depending on the reader's UTC
 * offset), this reads the calendar day directly off the string, or off a
 * `Date`'s local parts. Used to group transactions by day consistently
 * regardless of the user's timezone.
 *
 * @returns The `YYYY-MM-DD` key, or `'unknown'` when the value can't be parsed.
 */
function extractDateKey(value: unknown): string {
  if (!value) return 'unknown';

  if (typeof value === 'string') {
    const trimmed = value.trim();
    const match = trimmed.match(/^(\d{4}-\d{2}-\d{2})/);
    if (match) return match[1];

    const slashMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (slashMatch) {
      const [, month, day, year] = slashMatch;
      return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }
  }

  // If it's a Date object, use its local date parts (since dates represent a
  // local calendar day, not a UTC instant).
  if (value instanceof Date && isValid(value)) {
    const { year, month, day } = buildDateParts(value, false);
    return `${year}-${month}-${day}`;
  }

  return 'unknown';
}

/** Parse a `YYYY-MM-DD` date key into a Date at local noon (avoids DST edge cases). */
function parseDateKey(dateKey: string): Date | null {
  if (dateKey === 'unknown') return null;
  const match = dateKey.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const [, year, month, day] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day), 12, 0, 0);
  return isValid(date) ? date : null;
}

export interface DateKeyGroup<T> {
  key: string;
  date: Date | null;
  transactions: T[];
}

/**
 * Group items by their {@link extractDateKey} date, sorted descending (newest
 * first), with unparseable ("unknown") dates sorted last.
 *
 * @param items - The items to group
 * @param getDate - Reads the date-like value off an item
 */
export function groupTransactionsByDateKey<T>(
  items: T[],
  getDate: (item: T) => unknown
): DateKeyGroup<T>[] {
  const groups = items.reduce((acc, item) => {
    const dateKey = extractDateKey(getDate(item));
    const existing = acc.get(dateKey);
    if (existing) {
      existing.transactions.push(item);
    } else {
      acc.set(dateKey, { date: parseDateKey(dateKey), transactions: [item] });
    }
    return acc;
  }, new Map<string, { date: Date | null; transactions: T[] }>());

  // Sort by date key string (YYYY-MM-DD sorts correctly as strings)
  const sortedGroups = Array.from(groups.entries()).sort(([keyA], [keyB]) => {
    if (keyA === 'unknown' && keyB === 'unknown') return 0;
    if (keyA === 'unknown') return 1;
    if (keyB === 'unknown') return -1;
    return keyB.localeCompare(keyA); // Descending order (newest first)
  });

  return sortedGroups.map(([key, value]) => ({
    key,
    date: value.date,
    transactions: value.transactions,
  }));
}

/**
 * Format a date as a short display string (e.g. "Jan 15" / "Jan 15, 2023"),
 * optionally including the weekday name and optionally hiding the year when
 * it's the current year.
 */
export function formatShortDate(
  date: Date,
  options: { hideCurrentYear?: boolean; weekday?: 'long' | 'short' } = {}
): string {
  const { hideCurrentYear = false, weekday } = options;
  const showYear = !hideCurrentYear || date.getFullYear() !== new Date().getFullYear();
  return date.toLocaleDateString('en-US', {
    ...(weekday ? { weekday } : {}),
    month: 'short',
    day: 'numeric',
    year: showYear ? 'numeric' : undefined,
  });
}
