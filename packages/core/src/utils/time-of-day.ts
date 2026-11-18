import { ValidationError } from '../types';

/**
 * A transaction's optional time of day: 'HH:MM' (24-hour), local wall-clock
 * time with no time zone. Stored as given, never converted.
 */
const TIME_PATTERN = /^(\d{1,2}):([0-5]\d)(?::[0-5]\d(?:\.\d+)?)?$/;

/**
 * 'HH:MM' for a valid time ('9:05' and 'HH:MM:SS' are accepted; seconds are
 * dropped), null for an empty value, undefined for anything else.
 */
export function parseTimeOfDay(value: unknown): string | null | undefined {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const match = TIME_PATTERN.exec(trimmed);
  if (!match || Number(match[1]) > 23) return undefined;
  return `${match[1].padStart(2, '0')}:${match[2]}`;
}

/** Like parseTimeOfDay, but an invalid value throws. */
export function normalizeTimeOfDay(value: unknown): string | null {
  const parsed = parseTimeOfDay(value);
  if (parsed === undefined) {
    throw new ValidationError(`Invalid time "${String(value)}": use HH:MM (24-hour).`);
  }
  return parsed;
}

/**
 * The time of a bank or file timestamp worth keeping: null for a date-only
 * value or a placeholder time (00:00:00, which many banks send for "no time",
 * and 12:00:00, which some send for a date at noon). Takes the time part as
 * written in the source, without converting time zones.
 */
export function capturedTimeOfDay(
  hours: number | string,
  minutes: number | string,
  seconds: number | string = 0
): string | null {
  const h = Number(hours);
  const m = Number(minutes);
  const s = Number(seconds);
  if (![h, m, s].every(Number.isFinite)) return null;
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  if (m === 0 && Math.floor(s) === 0 && (h === 0 || h === 12)) return null;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * The time part of an ISO-8601 date-time ('2026-03-04T14:30:00+01:00',
 * '2026-03-04 14:30'), as written (the offset is ignored: the source's local
 * time is the time the user saw). Null for date-only strings and placeholders.
 */
export function timeFromIsoDateTime(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = /^\d{4}-\d{2}-\d{2}[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(value.trim());
  return match ? capturedTimeOfDay(match[1], match[2], match[3] ?? 0) : null;
}
