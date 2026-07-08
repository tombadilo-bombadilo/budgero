/**
 * Centralized pricing configuration.
 *
 * Pricing is env-driven so copy can be updated without code changes across
 * landing pages, comparisons, and hero sections. Defaults match current
 * canonical pricing; override in .env to test alternate prices.
 *
 * Prices are stored as display strings (with $ sign) to keep formatting
 * consistent across all surfaces. The yearly-equivalent-monthly value is
 * computed automatically from the yearly price.
 */
const monthly = process.env.NEXT_PUBLIC_BUDGERO_PRICE_MONTHLY ?? '$7.99';
const yearly = process.env.NEXT_PUBLIC_BUDGERO_PRICE_YEARLY ?? '$60';

/** "$60" → 60, "$7.99" → 7.99. Returns 0 if the string can't be parsed. */
function parsePriceAmount(price: string): number {
  const n = parseFloat(price.replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function formatPrice(amount: number): string {
  const rounded = Math.round(amount * 100) / 100;
  // Show no decimals for whole numbers ($5), two decimals otherwise ($6.67)
  return rounded % 1 === 0 ? `$${rounded}` : `$${rounded.toFixed(2)}`;
}

export const pricing = {
  monthly,
  yearly,
  /** Monthly-equivalent of the yearly price, e.g. "$5" for $60/yr. */
  yearlyEquivMonthly: formatPrice(parsePriceAmount(yearly) / 12),
} as const;
