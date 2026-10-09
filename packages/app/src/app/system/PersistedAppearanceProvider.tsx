import type { ReactNode } from 'react';
import { DialogBackgroundBlurProvider } from '@shared/contexts/DialogBackgroundBlurContext';
import { HideZeroAmountsProvider } from '@shared/contexts/HideZeroAmountsContext';
import { InlineTransactionEntryProvider } from '@shared/contexts/InlineTransactionEntryContext';
import {
  useDialogBackgroundBlur,
  useHideZeroAmounts,
  useInlineTransactionEntry,
} from '@shared/hooks/useUserPreferences';

export function PersistedAppearanceProvider({ children }: { children: ReactNode }) {
  const { data: dialogBackgroundBlur = true } = useDialogBackgroundBlur();
  const { data: hideZeroAmounts = false } = useHideZeroAmounts();
  const { data: inlineTransactionEntry = false } = useInlineTransactionEntry();

  return (
    <DialogBackgroundBlurProvider enabled={dialogBackgroundBlur}>
      <HideZeroAmountsProvider enabled={hideZeroAmounts}>
        <InlineTransactionEntryProvider enabled={inlineTransactionEntry}>
          {children}
        </InlineTransactionEntryProvider>
      </HideZeroAmountsProvider>
    </DialogBackgroundBlurProvider>
  );
}
