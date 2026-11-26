import type { DatabaseAdapter } from '../../database/interface.js';
import { getLocalDateString } from '../../utils/date.js';
import { CurrencyQueries } from './queries.js';

/** Where a looked-up rate came from (see lookupStoredRate). */
export type StoredRateSource = 'custom' | 'official' | 'manual' | 'stale';

export interface StoredRate {
  rate: number;
  source: StoredRateSource;
}

/** Days an official rate may lag the requested date (CurrencyService.RATE_FALLBACK_WINDOW_DAYS). */
const OFFICIAL_WINDOW_DAYS = 7;

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return getLocalDateString(new Date(y, m - 1, d + days));
}

const usable = (rate: number | null | undefined): rate is number =>
  typeof rate === 'number' && Number.isFinite(rate) && rate > 0;

/**
 * The rate from `from` to `to` on `date` from what this device already has,
 * without network and without writing anything: the transaction hierarchy
 * (custom range rate, official rate within a week, manual rate), then the
 * newest official rate of any age ('stale'). Null when the budget has no
 * rate for the pair at all. Future dates use today's rates.
 */
export function lookupStoredRate(
  db: DatabaseAdapter,
  from: string,
  to: string,
  date: string,
  budgetId: number
): StoredRate | null {
  if (from === to) return { rate: 1, source: 'official' };
  const queries = new CurrencyQueries(db);
  const today = getLocalDateString();
  const day = date > today ? today : date;

  const custom = queries.getCustomCurrencyRate(from, to, day, budgetId);
  if (custom && usable(custom.Rate)) {
    const inverted = custom.FromCurrency === to && custom.ToCurrency === from;
    return { rate: inverted ? 1 / custom.Rate : custom.Rate, source: 'custom' };
  }

  const direct = queries.getLatestCurrencyRateOnOrBefore(from, to, day, budgetId);
  const reciprocal = queries.getLatestCurrencyRateOnOrBefore(to, from, day, budgetId);
  // The newer of the two directions (either one is the same official quote).
  const newest =
    direct && usable(direct.Rate) && (!reciprocal || direct.RateDate >= reciprocal.RateDate)
      ? { rate: direct.Rate, date: direct.RateDate }
      : reciprocal && usable(reciprocal.Rate)
        ? { rate: 1 / reciprocal.Rate, date: reciprocal.RateDate }
        : null;
  if (newest && newest.date >= addDays(day, -OFFICIAL_WINDOW_DAYS)) {
    return { rate: newest.rate, source: 'official' };
  }

  const manual = queries.getManualCurrencyRate(from, to, budgetId);
  if (manual && usable(manual.Rate)) return { rate: manual.Rate, source: 'manual' };
  const manualReciprocal = queries.getManualCurrencyRate(to, from, budgetId);
  if (manualReciprocal && usable(manualReciprocal.Rate)) {
    return { rate: 1 / manualReciprocal.Rate, source: 'manual' };
  }

  return newest ? { rate: newest.rate, source: 'stale' } : null;
}
