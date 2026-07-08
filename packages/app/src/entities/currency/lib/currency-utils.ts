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
 * Get exchange rate between two currencies for a specific month
 * Will automatically fetch from API if not available
 */
export async function getExchangeRate(
  fromCurrency: string,
  toCurrency: string,
  month: string,
  budgetId: number,
  date?: string
): Promise<number | null> {
  if (fromCurrency === toCurrency) {
    return 1;
  }

  try {
    const services = getRuntime()?.services();
    if (!services) return null;
    const currencyService = services.currency;

    // Use full resolution when a transaction date is available (custom date-range overrides first).
    if (date) {
      const resolved = await currencyService.resolveRate(
        fromCurrency,
        toCurrency,
        date,
        month,
        budgetId
      );
      if (resolved) return resolved;
    }

    // Fallback to monthly fetch path.
    const rate = await currencyService.getOrFetchRate(fromCurrency, toCurrency, month, budgetId);
    return rate;
  } catch (error) {
    console.error('Failed to get exchange rate:', error);
    return null;
  }
}

export async function getLocalOrManualRate(
  fromCurrency: string,
  toCurrency: string,
  month: string,
  budgetId: number,
  date?: string
): Promise<number | null> {
  if (fromCurrency === toCurrency) return 1;
  try {
    const services = getRuntime()?.services();
    if (!services) return null;
    const currencyService = services.currency;

    if (date) {
      const custom = await currencyService.getCustomRate(fromCurrency, toCurrency, date, budgetId);
      if (custom) return custom;
    }

    const local = await currencyService.getLocalRate(fromCurrency, toCurrency, month, budgetId);
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
 * Format a currency amount with the appropriate symbol or code
 */
export function formatCurrency(amount: number, currencyCode: string): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currencyCode,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    // Fallback if currency code is not recognized
    return `${currencyCode} ${amount.toFixed(2)}`;
  }
}
