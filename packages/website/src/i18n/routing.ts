import { defineRouting } from 'next-intl/routing';

export const locales = ['en', 'de', 'fr', 'es', 'nl'] as const;
export type Locale = (typeof locales)[number];

export const localeNames: Record<Locale, string> = {
  en: 'English',
  de: 'Deutsch',
  fr: 'Français',
  es: 'Español',
  nl: 'Nederlands',
};

export const localeFlags: Record<Locale, string> = {
  en: '🇬🇧',
  de: '🇩🇪',
  fr: '🇫🇷',
  es: '🇪🇸',
  nl: '🇳🇱',
};

export const routing = defineRouting({
  locales,
  defaultLocale: 'en',
  // English keeps its existing unprefixed URLs; only new locales get a prefix.
  // Moving the indexed English pages would throw away the site's search history.
  localePrefix: 'as-needed',
  // URLs identify their language. Negotiating unprefixed English URLs from a
  // cookie would loop when an English-only article redirects to its canonical.
  localeDetection: false,
  // Without detection the NEXT_LOCALE cookie is never read; don't set it
  // (the site sets no cookies at all, privacy policy §8).
  localeCookie: false,
  // Explicit metadata/sitemaps know which translations really exist. Automatic
  // Link headers would invent translations of independent native articles.
  alternateLinks: false,
});
