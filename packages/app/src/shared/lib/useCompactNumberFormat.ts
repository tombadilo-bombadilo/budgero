import { useMemo } from 'react';

/**
 * Memoized compact `Intl.NumberFormat` (1.2K, 3.4M, …) used for chart axis
 * ticks. Pass a locale to follow the user's localizer; defaults to the
 * browser locale.
 */
export function useCompactNumberFormat(locale?: string): Intl.NumberFormat {
  return useMemo(
    () =>
      new Intl.NumberFormat(locale, {
        notation: 'compact',
        maximumFractionDigits: 1,
      }),
    [locale]
  );
}
