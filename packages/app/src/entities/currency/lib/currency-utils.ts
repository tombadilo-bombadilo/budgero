import { currencyDisplayFor } from '@shared/lib/number-format';
import { isCryptoCurrency, scaledToDecimal } from '@budgero/core/browser';
import { getRuntime } from '@shared/runtime/global';

/** Custom currency rate shape */
export interface CustomCurrencyRate {
  ID: number;
  FromCurrency: string;
  ToCurrency: string;
  Rate: number;
  StartDate: string;
  EndDate: string | null;
  BudgetID: number;
  CreatedAt: string;
  UpdatedAt: string;
}

/**
 * Get exchange rate between two currencies for a specific date.
 * Will automatically fetch from API if not available.
 */
export async function getExchangeRate(
  fromCurrency: string,
  toCurrency: string,
  rateDate: string,
  budgetId: number
): Promise<number | null> {
  if (fromCurrency === toCurrency) {
    return 1;
  }

  try {
    const services = getRuntime()?.services();
    if (!services) return null;
    return await services.currency.resolveRate(fromCurrency, toCurrency, rateDate, budgetId);
  } catch (error) {
    console.error('Failed to get exchange rate:', error);
    return null;
  }
}

export async function getLocalOrManualRate(
  fromCurrency: string,
  toCurrency: string,
  rateDate: string,
  budgetId: number
): Promise<number | null> {
  if (fromCurrency === toCurrency) return 1;
  try {
    const services = getRuntime()?.services();
    if (!services) return null;
    const currencyService = services.currency;

    const custom = await currencyService.getCustomRate(
      fromCurrency,
      toCurrency,
      rateDate,
      budgetId
    );
    if (custom) return custom;

    const local = await currencyService.getLocalRate(fromCurrency, toCurrency, rateDate, budgetId);
    if (local) return local;
    const manual = await currencyService.getManualRate(fromCurrency, toCurrency, budgetId);
    return manual;
  } catch {
    return null;
  }
}

export async function saveManualRate(
  fromCurrency: string,
  toCurrency: string,
  rate: number,
  budgetId: number
): Promise<void> {
  const services = getRuntime()?.services();
  if (!services) {
    throw new Error('Runtime services not available');
  }
  await services.currency.saveManualRate(fromCurrency, toCurrency, rate, budgetId);
}

/**
 * Format a native-scaled amount (fiat milli, crypto sat-scale) as a plain
 * decimal string, without the currency code.
 */
export function formatNativeAmount(amount: number, code: string): string {
  const decimal = scaledToDecimal(amount, code);
  if (isCryptoCurrency(code)) {
    return new Intl.NumberFormat(undefined, { maximumFractionDigits: 8 }).format(decimal);
  }
  return decimal.toFixed(2);
}

/**
 * Format a currency amount with the appropriate symbol or code
 */
export function formatCurrency(amount: number, currencyCode: string): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currencyCode,
      currencyDisplay: currencyDisplayFor(currencyCode),
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    // Fallback if currency code is not recognized
    return `${currencyCode} ${amount.toFixed(2)}`;
  }
}
