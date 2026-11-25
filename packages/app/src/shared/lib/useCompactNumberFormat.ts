import { useMemo } from 'react';
import { numberFormatLike } from '@shared/lib/number-format';

/**
 * Memoized compact `Intl.NumberFormat` (1.2K, 3.4M, …) used for chart axis
 * ticks. Pass a localizer to follow its locale and separators; defaults to the
 * browser locale.
 */
export function useCompactNumberFormat(like?: Intl.NumberFormat): Intl.NumberFormat {
  return useMemo(() => {
    const options: Intl.NumberFormatOptions = { notation: 'compact', maximumFractionDigits: 1 };
    return like ? numberFormatLike(like, options) : new Intl.NumberFormat(undefined, options);
  }, [like]);
}
