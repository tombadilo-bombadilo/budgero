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
