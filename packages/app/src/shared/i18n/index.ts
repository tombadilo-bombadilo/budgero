import { i18n } from '@lingui/core';
import type { Locale as DateFnsLocale } from 'date-fns';
import {
  DEFAULT_LOCALE,
  resolveInitialLocale,
  setStoredLocale,
  type SupportedLocale,
} from '@/shared/runtime/locale-preference';

export {
  SUPPORTED_LOCALES,
  DEFAULT_LOCALE,
  LANGUAGE_PREFERENCE_KEY,
  LOCALE_LABELS,
  LOCALE_FLAGS,
  type SupportedLocale,
} from '@/shared/runtime/locale-preference';

let activeDateLocale: DateFnsLocale | undefined;

async function loadDateFnsLocale(locale: SupportedLocale): Promise<DateFnsLocale | undefined> {
  switch (locale) {
    case 'de':
      return (await import('date-fns/locale/de')).de;
    case 'fr':
      return (await import('date-fns/locale/fr')).fr;
    case 'es':
      return (await import('date-fns/locale/es')).es;
    case 'nl':
      return (await import('date-fns/locale/nl')).nl;
    default:
      return undefined;
  }
}

/** date-fns `Locale` for the active language; undefined means en-US default. */
export function getDateLocale(): DateFnsLocale | undefined {
  return activeDateLocale;
}

/** BCP 47 tag for the active language, for Intl.* constructors. */
export function getLocaleTag(): string {
  return i18n.locale || DEFAULT_LOCALE;
}

async function loadMessages(locale: SupportedLocale) {
  switch (locale) {
    case 'de':
      return (await import('@/locales/de/messages.mjs')).messages;
    case 'fr':
      return (await import('@/locales/fr/messages.mjs')).messages;
    case 'es':
      return (await import('@/locales/es/messages.mjs')).messages;
    case 'nl':
      return (await import('@/locales/nl/messages.mjs')).messages;
    default:
      return (await import('@/locales/en/messages.mjs')).messages;
  }
}

export async function activateLocale(locale: SupportedLocale, persist = true): Promise<void> {
  const messages = await loadMessages(locale);
  activeDateLocale = await loadDateFnsLocale(locale);
  i18n.load(locale, messages);
  i18n.activate(locale);
  if (persist) setStoredLocale(locale);
  if (typeof document !== 'undefined') document.documentElement.lang = locale;
}

export async function initI18n(): Promise<SupportedLocale> {
  const locale = resolveInitialLocale();
  try {
    await activateLocale(locale, false);
    return locale;
  } catch {
    await activateLocale(DEFAULT_LOCALE, false);
    return DEFAULT_LOCALE;
  }
}

export { i18n };
