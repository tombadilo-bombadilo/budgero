export const EXCHANGE_RATE_PRECISION = 6;

export function formatExchangeRate(
  value: number,
  maxFractionDigits = EXCHANGE_RATE_PRECISION
): string {
  if (!Number.isFinite(value)) return '0.00';

  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: maxFractionDigits,
    useGrouping: false,
  }).format(value);
}
