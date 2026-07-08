/**
 * Currency service type definitions
 * These types use PascalCase for API consistency
 */

/**
 * CurrencyRate type - represents an exchange rate between two currencies
 */
export interface CurrencyRate {
  ID: number;
  FromCurrency: string;
  ToCurrency: string;
  Rate: number;
  Month: string;
  LastUpdated: string;
  BudgetID: number;
}

/**
 * CustomCurrencyRate type - user-defined exchange rate with date range
 */
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
