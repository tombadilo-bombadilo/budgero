export interface NumberSeparators {
  group: string;
  decimal: string;
}

export interface FormatSettings {
  locale: string;
  fractionDigits: number;
  useGrouping: boolean;
  /**
   * Separators no Intl locale offers as a pair (space thousands with a dot
   * decimal). The locale still decides symbol placement and minus sign.
   */
  separators?: NumberSeparators;
}

/** Narrow no-break space, the grouping Intl itself uses for French (1 096,56). */
export const NARROW_NO_BREAK_SPACE = '\u202F';

const SPACE_AND_DOT: NumberSeparators = { group: NARROW_NO_BREAK_SPACE, decimal: '.' };

export const formatOptions: { key: string; settings: FormatSettings }[] = [
  // English (US) with 2 decimals: "$1,096.56"
  { key: '$1,096.56', settings: { locale: 'en-US', fractionDigits: 2, useGrouping: true } },
  // German (de-DE) with 2 decimals: "1.096,56 $"
  { key: '1.096,56 $', settings: { locale: 'de-DE', fractionDigits: 2, useGrouping: true } },
  // French (fr-FR) with 2 decimals: "1 096,56 $US"
  { key: '1 096,56 $US', settings: { locale: 'fr-FR', fractionDigits: 2, useGrouping: true } },
  // English (US) with no decimals: "$1,097"
  { key: '$1,097', settings: { locale: 'en-US', fractionDigits: 0, useGrouping: true } },
  // German (de-DE) with no decimals: "1.097 $"
  { key: '1.097 $', settings: { locale: 'de-DE', fractionDigits: 0, useGrouping: true } },
  // French (fr-FR) with no decimals: "1 097 $US"
  { key: '1 097 $US', settings: { locale: 'fr-FR', fractionDigits: 0, useGrouping: true } },
  // Canadian English with 2 decimals: "1,096.56 USD"
  { key: '1,096.56 USD', settings: { locale: 'en-CA', fractionDigits: 2, useGrouping: true } },
  // English (GB) with no decimals: "US$ 1,097"
  { key: 'US$ 1,097', settings: { locale: 'en-GB', fractionDigits: 0, useGrouping: true } },
  // Space thousands, dot decimals: "1 096.56 $US" (fr-CH places the symbol
  // after the amount; its own ' grouping is replaced).
  {
    key: '1 096.56 $US',
    settings: { locale: 'fr-CH', fractionDigits: 2, useGrouping: true, separators: SPACE_AND_DOT },
  },
];

/** Returns the FormatSettings for a given stored key, or undefined if not found. */
export function getFormatOptionFromLabel(key: string): FormatSettings | undefined {
  return formatOptions.find((option) => option.key === key)?.settings;
}

/** Extra field on resolvedOptions() that carries a separator override along. */
interface ResolvedWithSeparators extends Intl.ResolvedNumberFormatOptions {
  separators?: NumberSeparators;
}

/** The separator override a localizer was built with, if any. */
export function separatorsOf(formatter: Intl.NumberFormat): NumberSeparators | undefined {
  return (formatter.resolvedOptions() as ResolvedWithSeparators).separators;
}

/**
 * Wraps a formatter so its group and decimal separators are replaced. The
 * override rides along in resolvedOptions(), so wrappers that delegate
 * resolvedOptions (privacy masking, crypto) and formatters derived with
 * numberFormatLike keep it.
 */
export function withSeparators(
  base: Intl.NumberFormat,
  separators: NumberSeparators | undefined
): Intl.NumberFormat {
  if (!separators) return base;
  const formatToParts = (value?: number | bigint) =>
    base
      .formatToParts(value)
      .map((part) =>
        part.type === 'group'
          ? { ...part, value: separators.group }
          : part.type === 'decimal'
            ? { ...part, value: separators.decimal }
            : part
      );
  return {
    format: (value: number | bigint) =>
      formatToParts(value)
        .map((part) => part.value)
        .join(''),
    formatToParts,
    resolvedOptions: (): ResolvedWithSeparators => ({ ...base.resolvedOptions(), separators }),
  } as Intl.NumberFormat;
}

/** A new formatter in the same locale and separator style as `like`. */
export function numberFormatLike(
  like: Intl.NumberFormat,
  options: Intl.NumberFormatOptions
): Intl.NumberFormat {
  return withSeparators(
    new Intl.NumberFormat(like.resolvedOptions().locale, options),
    separatorsOf(like)
  );
}

/** A formatter for a stored number-format option. */
export function numberFormatForSettings(
  settings: FormatSettings,
  options: Intl.NumberFormatOptions
): Intl.NumberFormat {
  return withSeparators(new Intl.NumberFormat(settings.locale, options), settings.separators);
}

const editPrecisionCache = new WeakMap<Intl.NumberFormat, Intl.NumberFormat>();

/** Currencies shown with their local sign instead of the ISO code (HUF → "Ft"). */
const LOCAL_SIGN_CURRENCIES = new Set(['HUF']);

/** `currencyDisplay` for an Intl currency formatter of this currency. */
export function currencyDisplayFor(
  currency: string | undefined
): Intl.NumberFormatOptions['currencyDisplay'] {
  return currency && LOCAL_SIGN_CURRENCIES.has(currency) ? 'narrowSymbol' : 'symbol';
}

/**
 * Full-precision variant of a display formatter for edit surfaces.
 *
 * Display precision and edit precision are different jobs: a zero-decimal
 * display preference must not hide real cents while the user is editing or
 * balancing amounts (split remainders, reconciliation). Keeps the locale and
 * currency styling, but raises maximumFractionDigits so any stored milliunit
 * amount (up to 3 decimals) renders exactly.
 */
export function withEditPrecision(formatter: Intl.NumberFormat): Intl.NumberFormat {
  let edit = editPrecisionCache.get(formatter);
  if (!edit) {
    const { separators, ...options } = formatter.resolvedOptions() as ResolvedWithSeparators;
    edit = withSeparators(
      new Intl.NumberFormat(options.locale, {
        ...(options as Intl.NumberFormatOptions),
        maximumFractionDigits: Math.max(options.maximumFractionDigits ?? 0, 3),
      }),
      separators
    );
    editPrecisionCache.set(formatter, edit);
  }
  return edit;
}
