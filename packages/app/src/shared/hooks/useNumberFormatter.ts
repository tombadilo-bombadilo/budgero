import { useMemo } from 'react';

/**
 * Returns a memoized plain number formatter for non-currency fields.
 *
 * Respects the locale's decimal/grouping settings derived from the provided
 * global localizer while allowing up to 6 fractional digits.
 */
export function usePlainNumberFormatter(globalLocalizer: Intl.NumberFormat): Intl.NumberFormat {
  return useMemo(() => {
    const resolvedOptions = globalLocalizer.resolvedOptions();
    return new Intl.NumberFormat(resolvedOptions.locale, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 6,
      useGrouping: resolvedOptions.useGrouping,
    });
  }, [globalLocalizer]);
}
