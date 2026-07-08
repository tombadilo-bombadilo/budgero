import { useCallback } from 'react';
import { toDecimal } from '@shared/lib/currency/milli';
import { roundMilli } from '@shared/lib/currency/round-amount';
import { useFormatMaskedAmount } from '@shared/lib/privacy/useMaskedLocalizer';

/**
 * Returns a masked `(milli) => string` formatter for stored integer-milliunit
 * amounts. Counterpart of `useFormatMaskedAmount` (which stays decimal-in) —
 * budget rows carry MilliUnits, so every display site in this feature goes
 * through this hook. Tolerates float milli inputs (goal pace math, animated
 * in-between frames) by rounding to the nearest milliunit first.
 */
export function useFormatMaskedMilli(localizer?: Intl.NumberFormat): (milli: number) => string {
  const formatDecimal = useFormatMaskedAmount(localizer);
  return useCallback(
    (milli: number) => formatDecimal(toDecimal(roundMilli(milli))),
    [formatDecimal]
  );
}
