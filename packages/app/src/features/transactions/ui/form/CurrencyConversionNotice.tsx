/**
 * Currency Conversion Notice Component
 *
 * Displays currency conversion information for cross-currency transfers.
 */

import { Info, Loader2 } from 'lucide-react';
import { formatExchangeRate } from '@entities/currency/lib/exchange-rate-format';
import { toDecimal } from '@shared/lib/currency/milli';
import { roundMilli } from '@shared/lib/currency/round-amount';

interface CurrencyConversionNoticeProps {
  /** Milliunits. */
  amount: number;
  /** Milliunits. */
  convertedAmount: number | null;
  isLoadingRate: boolean;
  fromCurrency: string;
  toCurrency: string;
  canUseCurrencyApi: boolean;
  exchangeRate?: number | null;
}

export function CurrencyConversionNotice({
  amount,
  convertedAmount,
  isLoadingRate,
  fromCurrency,
  toCurrency,
  canUseCurrencyApi,
  exchangeRate,
}: CurrencyConversionNoticeProps) {
  return (
    <div className="rounded-lg border border-sky-200 dark:border-sky-900/60 bg-sky-50 dark:bg-sky-950/30 p-2 sm:p-3 space-y-1">
      <div className="flex items-start gap-2">
        <Info className="h-4 w-4 sm:h-5 sm:w-5 text-sky-600 dark:text-sky-400 mt-0.5 flex-shrink-0" />
        <div className="text-xs sm:text-sm flex-1">
          <p className="font-medium text-sky-900 dark:text-sky-200">Currency Conversion</p>
          {isLoadingRate ? (
            <div className="mt-2 flex items-center gap-2 text-sky-700 dark:text-sky-300">
              <Loader2 className="h-3 w-3 sm:h-4 sm:w-4 animate-spin" />
              <span>Fetching exchange rate...</span>
            </div>
          ) : convertedAmount !== null ? (
            <div className="mt-2 rounded bg-sky-100 dark:bg-sky-900/40 p-2">
              <p className="font-medium text-sky-900 dark:text-sky-100">
                {toDecimal(roundMilli(amount)).toFixed(2)} {fromCurrency} →{' '}
                {toDecimal(roundMilli(convertedAmount)).toFixed(2)} {toCurrency}
              </p>
              {exchangeRate != null && (
                <p className="text-xs text-sky-700 dark:text-sky-300 mt-1">
                  Rate: 1 {fromCurrency} = {formatExchangeRate(exchangeRate)} {toCurrency}
                </p>
              )}
            </div>
          ) : amount > 0 ? (
            <p className="mt-1 text-sky-700 dark:text-sky-300">Exchange rate not available</p>
          ) : (
            <p className="mt-1 text-sky-700 dark:text-sky-300">Enter an amount to see conversion</p>
          )}
          {!canUseCurrencyApi && (
            <p className="mt-1 text-xs text-sky-600 dark:text-sky-300">
              ℹ️ Offline or unauthorized – conversions will use cached or manual rates.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
