const DIGIT_PATTERN = /\d/g;
const MASKED_NUMBER_SEPARATOR_PATTERN = /([*])[,.\s\u00A0\u202F'’]+(?=[*])/g;

type NumericFormatter = {
  format: (value: number) => string;
  resolvedOptions?: () => Intl.ResolvedNumberFormatOptions;
};

function normalizeRoundedZero(formatter: NumericFormatter, value: number): number {
  if (!Number.isFinite(value)) return value;

  const options = formatter.resolvedOptions?.();
  const fractionDigits = options?.maximumFractionDigits ?? options?.minimumFractionDigits ?? 2;
  const roundingThreshold = 0.5 / 10 ** fractionDigits;

  return Math.abs(value) < roundingThreshold || Object.is(value, -0) ? 0 : value;
}

export function maskNumericDigits(input: string): string {
  const digitMasked = input.replace(DIGIT_PATTERN, '*');
  // Remove number separators only when they sit between masked digits.
  // Example: "RSD *,***.**" -> "RSD ******"
  return digitMasked.replace(MASKED_NUMBER_SEPARATOR_PATTERN, '$1');
}

export function maskFormattedIfEnabled(input: string, enabled: boolean): string {
  if (!enabled) return input;
  return maskNumericDigits(input);
}

export function formatMaskedAmount(
  formatter: NumericFormatter,
  value: number,
  enabled: boolean
): string {
  const formatted = formatter.format(normalizeRoundedZero(formatter, value));
  return maskFormattedIfEnabled(formatted, enabled);
}

/**
 * Formats a stored integer-milliunit amount (dividing by 1000 first) with
 * optional privacy masking. Use this for row/op amounts; plain
 * {@link formatMaskedAmount} stays decimal-in for already-decimal values.
 */
export function formatMaskedMilli(
  formatter: NumericFormatter,
  milli: number,
  enabled: boolean
): string {
  return formatMaskedAmount(formatter, milli / 1000, enabled);
}

/**
 * Wraps an Intl.NumberFormat so `format` masks digits when enabled, for
 * components that take a localizer rather than a format function.
 */
export function createMaskedNumberFormatter(
  localizer: Intl.NumberFormat,
  enabled: boolean
): Intl.NumberFormat {
  return {
    format: (value: number) => formatMaskedAmount(localizer, value, enabled),
    resolvedOptions: () => localizer.resolvedOptions(),
    // Delegate formatToParts to the real localizer so consumers (e.g. the
    // calculator cell) can derive decimal/group separators. Separators are
    // not sensitive, so this doesn't leak masked amounts.
    formatToParts: (value?: number) => localizer.formatToParts(value),
  } as Intl.NumberFormat;
}
