import { useMemo, type ReactNode } from 'react';
import { DialogBackgroundBlurProvider } from '@shared/contexts/DialogBackgroundBlurContext';
import { HideZeroAmountsProvider } from '@shared/contexts/HideZeroAmountsContext';
import { InlineTransactionEntryProvider } from '@shared/contexts/InlineTransactionEntryContext';
import { RegisterDisplayProvider } from '@shared/contexts/RegisterDisplayContext';
import {
  useDialogBackgroundBlur,
  useHideZeroAmounts,
  useCompactTransactionRows,
  useInlineTransactionEntry,
  useSameDayTransactionOrder,
  useShowTransactionTime,
} from '@shared/hooks/useUserPreferences';

export function PersistedAppearanceProvider({ children }: { children: ReactNode }) {
  const { data: dialogBackgroundBlur = true } = useDialogBackgroundBlur();
  const { data: hideZeroAmounts = false } = useHideZeroAmounts();
  const { data: inlineTransactionEntry = false } = useInlineTransactionEntry();
  const { data: compactRows = false } = useCompactTransactionRows();
  const { data: sameDayOrder = 'newest' } = useSameDayTransactionOrder();
  const { data: showTime = false } = useShowTransactionTime();
  const registerDisplay = useMemo(
    () => ({ compactRows, sameDayOrder, showTime }),
    [compactRows, sameDayOrder, showTime]
  );

  return (
    <DialogBackgroundBlurProvider enabled={dialogBackgroundBlur}>
      <HideZeroAmountsProvider enabled={hideZeroAmounts}>
        <InlineTransactionEntryProvider enabled={inlineTransactionEntry}>
          <RegisterDisplayProvider value={registerDisplay}>{children}</RegisterDisplayProvider>
        </InlineTransactionEntryProvider>
      </HideZeroAmountsProvider>
    </DialogBackgroundBlurProvider>
  );
}
