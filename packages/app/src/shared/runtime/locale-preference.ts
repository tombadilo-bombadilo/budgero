const LOCALE_KEY = 'budgero_locale_v1';
/** Synced state key (user scope) the language follows the user through; this file's key is its cache. */
export const LANGUAGE_PREFERENCE_KEY = 'language';

export const SUPPORTED_LOCALES = ['en', 'de', 'fr', 'es', 'nl'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: SupportedLocale = 'en';

export const LOCALE_LABELS: Record<SupportedLocale, string> = {
  en: 'English',
  de: 'Deutsch',
  fr: 'Français',
  es: 'Español',
  nl: 'Nederlands',
};

export const LOCALE_FLAGS: Record<SupportedLocale, string> = {
  en: '🇬🇧',
  de: '🇩🇪',
  fr: '🇫🇷',
  es: '🇪🇸',
  nl: '🇳🇱',
};

export function isSupportedLocale(value: unknown): value is SupportedLocale {
  return typeof value === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/** The language the user picked on this device (null: none, the browser's is used). */
export function getStoredLocale(): SupportedLocale | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const value = localStorage.getItem(LOCALE_KEY);
    return isSupportedLocale(value) ? value : null;
  } catch {
    return null;
  }
}

export function setStoredLocale(locale: SupportedLocale | null): void {
  try {
    if (typeof localStorage === 'undefined') return;
    if (!locale) {
      localStorage.removeItem(LOCALE_KEY);
    } else {
      localStorage.setItem(LOCALE_KEY, locale);
    }
  } catch {
    /* no-op: intentionally ignored */
  }
}

function detectBrowserLocale(): SupportedLocale | null {
  try {
    if (typeof navigator === 'undefined') return null;
    const candidates = navigator.languages?.length ? navigator.languages : [navigator.language];
    for (const candidate of candidates) {
      const base = candidate?.split('-')[0]?.toLowerCase();
      if (isSupportedLocale(base)) return base;
    }
    return null;
  } catch {
    return null;
  }
}

export function resolveInitialLocale(): SupportedLocale {
  return getStoredLocale() ?? detectBrowserLocale() ?? DEFAULT_LOCALE;
}
