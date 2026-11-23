import { Trans, useLingui } from '@lingui/react/macro';
/**
 * Currency Conversion Notice Component
 *
 * Displays currency conversion information for cross-currency transfers, and
 * for transactions in a foreign-currency account (converted to the budget
 * currency). Either way the converted amount can be typed to pin the rate.
 */

import { Info, Loader2 } from 'lucide-react';
import { formatNativeAmount } from '@entities/currency/lib/currency-utils';
import { formatExchangeRate } from '@entities/currency/lib/exchange-rate-format';
import { usePlainNumberFormatter } from '@shared/hooks/useNumberFormatter';
import { asMilli } from '@shared/lib/currency/milli';
import { Button } from '@shared/ui/button';
import { CalculatorCell } from '@shared/ui/calculator-cell';

interface CurrencyConversionNoticeProps {
  /** Native scale of `fromCurrency` (fiat milli, crypto sat-scale). */
  amount: number;
  /** Native scale of `toCurrency` (fiat milli, crypto sat-scale). */
  convertedAmount: number | null;
  isLoadingRate: boolean;
  fromCurrency: string;
  toCurrency: string;
  canUseCurrencyApi: boolean;
  exchangeRate?: number | null;
  /** Exact amount deposited into the destination account, if overridden. */
  receivedAmount: number | null;
  onReceivedAmountChange: (amount: number | null) => void;
  onEditingChange: (editing: boolean) => void;
  localizer: Intl.NumberFormat;
  /** 'budget': a regular transaction converted to the budget currency. */
  mode?: 'transfer' | 'budget';
}

export function CurrencyConversionNotice({
  amount,
  convertedAmount,
  isLoadingRate,
  fromCurrency,
  toCurrency,
  canUseCurrencyApi,
  exchangeRate,
  receivedAmount,
  onReceivedAmountChange,
  onEditingChange,
  localizer,
  mode = 'transfer',
}: CurrencyConversionNoticeProps) {
  const isBudget = mode === 'budget';
  const { t } = useLingui();

  const numberFormatter = usePlainNumberFormatter(localizer);
  const suggestedAmount = convertedAmount ?? 0;
  const displayedReceivedAmount = receivedAmount ?? suggestedAmount;

  return (
    <div className="rounded-lg border border-sky-200 dark:border-sky-900/60 bg-sky-50 dark:bg-sky-950/30 p-2 sm:p-3 space-y-1">
      <div className="flex items-start gap-2">
        <Info className="h-4 w-4 sm:h-5 sm:w-5 text-sky-600 dark:text-sky-400 mt-0.5 flex-shrink-0" />
        <div className="text-xs sm:text-sm flex-1">
          <p className="font-medium text-sky-900 dark:text-sky-200">
            <Trans>Currency Conversion</Trans>
          </p>
          {isLoadingRate ? (
            <div className="mt-2 flex items-center gap-2 text-sky-700 dark:text-sky-300">
              <Loader2 className="h-3 w-3 sm:h-4 sm:w-4 animate-spin" />
              <span>
                <Trans>Fetching exchange rate...</Trans>
              </span>
            </div>
          ) : convertedAmount !== null ? (
            <div className="mt-2 rounded bg-sky-100 dark:bg-sky-900/40 p-2">
              <p className="font-medium text-sky-900 dark:text-sky-100">
                {formatNativeAmount(amount, fromCurrency)} {fromCurrency} →{' '}
                {formatNativeAmount(convertedAmount, toCurrency)} {toCurrency}
              </p>
              {exchangeRate != null && (
                <p className="text-xs text-sky-700 dark:text-sky-300 mt-1">
                  <Trans>
                    Rate: 1 {fromCurrency} = {formatExchangeRate(exchangeRate)} {toCurrency}
                  </Trans>
                </p>
              )}
            </div>
          ) : amount > 0 ? (
            <p className="mt-1 text-sky-700 dark:text-sky-300">
              <Trans>Exchange rate not available</Trans>
            </p>
          ) : (
            <p className="mt-1 text-sky-700 dark:text-sky-300">
              <Trans>Enter an amount to see conversion</Trans>
            </p>
          )}
          <div className="mt-2 space-y-1.5 border-t border-sky-200 pt-2 dark:border-sky-900/60">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-sky-900 dark:text-sky-200">
                {isBudget ? (
                  <Trans>Amount in budget ({toCurrency})</Trans>
                ) : (
                  <Trans>Received amount ({toCurrency})</Trans>
                )}
              </span>
              {receivedAmount !== null && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-[0.6875rem] text-sky-700 hover:text-sky-900 dark:text-sky-300"
                  onClick={() => onReceivedAmountChange(null)}
                >
                  <Trans>Use suggested</Trans>
                </Button>
              )}
            </div>
            <CalculatorCell
              value={asMilli(displayedReceivedAmount)}
              currencyCode={toCurrency}
              zeroAsEmpty
              commitUnchanged
              onCommit={(value) => onReceivedAmountChange(value > 0 ? value : null)}
              formatter={numberFormatter.format}
              localizer={numberFormatter}
              placeholder={t`Optional final amount`}
              inputAlign="right"
              inputClassName="h-8 bg-background text-right"
              displayClassName="rounded-md border border-sky-200 bg-background px-2 py-1.5 text-right dark:border-sky-900/60"
              onEditingChange={onEditingChange}
              data-testid={isBudget ? 'budget-converted-amount' : 'transfer-received-amount'}
            />
            <p className="text-[0.6875rem] text-sky-700 dark:text-sky-300">
              {isBudget
                ? receivedAmount === null
                  ? t`Optional — type what you actually got, e.g. after a rounded cash swap.`
                  : t`The implied exchange rate will be saved with this transaction.`
                : receivedAmount === null
                  ? t`Optional — edit this if the bank deposited a different amount.`
                  : t`The implied exchange rate will be saved with this transfer.`}
            </p>
          </div>
          {!canUseCurrencyApi && (
            <p className="mt-1 text-xs text-sky-600 dark:text-sky-300">
              <Trans>
                ℹ️ Offline or unauthorized – conversions will use cached or manual rates.
              </Trans>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
