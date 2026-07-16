export interface FormatSettings {
  locale: string;
  fractionDigits: number;
  useGrouping: boolean;
}

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
];

/** Returns the FormatSettings for a given stored key, or undefined if not found. */
export function getFormatOptionFromLabel(key: string): FormatSettings | undefined {
  return formatOptions.find((option) => option.key === key)?.settings;
}

const editPrecisionCache = new WeakMap<Intl.NumberFormat, Intl.NumberFormat>();

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
    const options = formatter.resolvedOptions();
    edit = new Intl.NumberFormat(options.locale, {
      ...options,
      maximumFractionDigits: Math.max(options.maximumFractionDigits ?? 0, 3),
    });
    editPrecisionCache.set(formatter, edit);
  }
  return edit;
}
