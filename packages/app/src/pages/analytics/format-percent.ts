import { getLocaleTag } from '@shared/i18n';

const formatters = new Map<string, Intl.NumberFormat>();

/**
 * A percentage in the app language ("12.5%", "12,5 %"). `percent` is in
 * percent points (12.5, not 0.125); `decimals` is the exact number shown.
 */
export function formatPercent(percent: number, decimals = 0): string {
  const locale = getLocaleTag();
  const key = `${locale}:${decimals}`;
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, {
      style: 'percent',
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
    formatters.set(key, formatter);
  }
  return formatter.format(percent / 100);
}
