/**
 * Category-axis labels that always show the first and the last value: every
 * k-th label in between, k chosen from the room there is. On narrow charts
 * month labels shorten to "Jun", with the year where it changes ("Jan '26").
 */

/** Indexes of the labels to show (first and last always), at most `slots`. */
export function axisLabelIndexes(count: number, slots: number): Set<number> {
  const shown = new Set<number>();
  if (count <= 0) return shown;
  const room = Math.max(2, Math.floor(slots));
  if (count <= room) {
    for (let index = 0; index < count; index += 1) shown.add(index);
    return shown;
  }
  const step = Math.ceil((count - 1) / (room - 1));
  for (let index = 0; index < count; index += step) shown.add(index);
  // The last one replaces a neighbour that would crowd it.
  const last = count - 1;
  if (!shown.has(last)) {
    for (const index of shown) if (last - index < step && index !== 0) shown.delete(index);
    shown.add(last);
  }
  return shown;
}

/** "2026-06" → "Jun" (or "Jun '26" where the year shows), in the given locale. */
export function shortMonthLabel(value: unknown, withYear: boolean, locale: string): string | null {
  const match = typeof value === 'string' ? /^(\d{4})-(\d{2})$/.exec(value) : null;
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, 1);
  const month = date.toLocaleDateString(locale, { month: 'short' });
  return withYear ? `${month} '${match[1].slice(2)}` : month;
}
