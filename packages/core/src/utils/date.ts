/**
 * Converts a Date to a YYYY-MM-DD string using local time (no timezone drift).
 */
export function getLocalDateString(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Converts a Date to a YYYY-MM-DD string using UTC getters.
 *
 * Use for dates that were parsed with a UTC anchor (e.g. `new Date(`${s}T00:00:00Z`)`)
 * so the parse→serialize round trip is symmetric. Serializing a UTC-anchored date
 * with {@link getLocalDateString} shifts it back one day for users west of UTC.
 */
/**
 * Parse a date string for LOCAL calendar reads (getMonth/getFullYear,
 * getLocalDateString, toLocaleDateString).
 *
 * Bare `YYYY-MM-DD` strings are anchored to local midnight — `new Date(str)`
 * would anchor them to UTC midnight, shifting the day/month back for users
 * west of UTC. Anything else (full ISO timestamps, other formats) falls
 * through to `new Date(str)`, which is correct for instants.
 *
 * @returns The parsed Date, or null when unparseable.
 */
export function parseDateOnlyLocal(value: string): Date | null {
  if (!value) return null;
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (dateOnly) {
    return new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]));
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function getUTCDateString(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
