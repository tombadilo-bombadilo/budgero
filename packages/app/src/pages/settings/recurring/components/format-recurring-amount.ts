import { asMilli, formatMilli } from '@shared/lib/currency/milli';

export function formatRecurringAmount(
  template: { direction: string; amount: number },
  localizer: { format: (n: number) => string }
): string {
  // Template amounts are stored integer milliunits; the localizer speaks decimal.
  const formatted = formatMilli(localizer, asMilli(template.amount));
  return template.direction === 'outflow' ? `-${formatted}` : formatted;
}
