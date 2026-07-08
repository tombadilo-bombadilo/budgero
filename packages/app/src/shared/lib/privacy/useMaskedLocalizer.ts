import { useMemo } from 'react';
import { useUiStore } from '@shared/store/useUiStore';
import { createMaskedNumberFormatter, formatMaskedAmount } from './mask-numbers';

/**
 * Returns a localizer whose `format` masks digits while privacy mode is on.
 * Reactive: toggling privacy re-renders consumers with a fresh formatter.
 */
export function useMaskedLocalizer(localizer: Intl.NumberFormat): Intl.NumberFormat {
  const privacyMaskNumbers = useUiStore((state) => state.privacyMaskNumbers);
  return useMemo(
    () => createMaskedNumberFormatter(localizer, privacyMaskNumbers),
    [localizer, privacyMaskNumbers]
  );
}

/**
 * Returns a memoized `(value) => string` formatter that masks digits while
 * privacy mode is on. Pass a localizer, or omit it to use the store's
 * `globalLocalizer`. Reactive to both the localizer and the privacy toggle.
 */
export function useFormatMaskedAmount(localizer?: Intl.NumberFormat): (value: number) => string {
  const privacyMaskNumbers = useUiStore((state) => state.privacyMaskNumbers);
  const globalLocalizer = useUiStore((state) => state.globalLocalizer);
  const resolved = localizer ?? globalLocalizer;
  return useMemo(
    () => (value: number) => formatMaskedAmount(resolved, value, privacyMaskNumbers),
    [resolved, privacyMaskNumbers]
  );
}
