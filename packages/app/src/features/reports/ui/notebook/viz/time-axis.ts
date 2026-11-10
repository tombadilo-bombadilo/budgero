/**
 * Category-axis labels for time series: every label when they fit, else an
 * even thinning (every k-th, starting with the first). On narrow charts
 * month labels shorten to "Jun", with the year on the first label and on
 * each January ("Jan '27").
 */

/** Rough width of an axis label at 11px (covers the wide mono font). */
export function estimateLabelWidth(label: string): number {
  return label.length * 7 + 12;
}

/** Indexes of the labels to show: all when they fit in `available` px, else every k-th. */
export function axisLabelIndexes(labels: readonly string[], available: number): Set<number> {
  const count = labels.length;
  const shown = new Set<number>();
  if (count === 0) return shown;
  // Each label gets one band of the axis; the first may spill a little to the left.
  const widths = labels.map(estimateLabelWidth);
  const widest = Math.max(...widths.slice(1), widths[0] / 1.8);
  const fit = Math.max(1, Math.floor(available / widest));
  const step = count <= fit ? 1 : Math.ceil(count / fit);
  for (let index = 0; index < count; index += step) shown.add(index);
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
