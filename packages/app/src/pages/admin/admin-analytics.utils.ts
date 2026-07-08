import { formatDateUtcISO } from '@shared/lib/date-utils';

/** Format a Date as YYYY-MM-DD (UTC) for input[type=date] values. */
export function toDateInputValue(d: Date): string {
  return formatDateUtcISO(d);
}

/** Convert a YYYY-MM-DD input value to an RFC3339 UTC midnight timestamp. */
export function dateInputToISO(d: string): string {
  return new Date(`${d}T00:00:00Z`).toISOString();
}
