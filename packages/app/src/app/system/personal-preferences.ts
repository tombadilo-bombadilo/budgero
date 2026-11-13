import { activateLocale, i18n, LANGUAGE_PREFERENCE_KEY } from '@shared/i18n';
import type { SyncedPreference } from '@shared/lib/synced-state';
import {
  getStoredLocale,
  isSupportedLocale,
  type SupportedLocale,
} from '@shared/runtime/locale-preference';
import {
  BUDGET_TARGET_COLUMN_KEY,
  BUDGET_TARGET_COLUMN_PREFERENCE,
  useUiStore,
} from '@shared/store/useUiStore';

/** Explicit = the user picked it in settings (stored); otherwise the browser's language. */
export const languagePreference: SyncedPreference<SupportedLocale> = {
  key: LANGUAGE_PREFERENCE_KEY,
  readLocal: () => {
    const stored = getStoredLocale();
    return {
      value: stored ?? (isSupportedLocale(i18n.locale) ? i18n.locale : 'en'),
      explicit: stored !== null,
    };
  },
  isValid: isSupportedLocale,
  apply: (locale) => activateLocale(locale),
};

/** Explicit = the cache key is present ('1' or '0'); absent is the default (hidden). */
export const budgetTargetColumnPreference: SyncedPreference<boolean> = {
  key: BUDGET_TARGET_COLUMN_PREFERENCE,
  readLocal: () => {
    let explicit = false;
    try {
      explicit = localStorage.getItem(BUDGET_TARGET_COLUMN_KEY) !== null;
    } catch {
      /* storage blocked: treat as default */
    }
    return { value: useUiStore.getState().showBudgetTargetColumn, explicit };
  },
  isValid: (value): value is boolean => typeof value === 'boolean',
  apply: (show) => useUiStore.getState().setShowBudgetTargetColumn(show),
};
