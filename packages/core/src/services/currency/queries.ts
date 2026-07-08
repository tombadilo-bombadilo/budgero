import { DatabaseAdapter } from '../../database/index.js';
import { CurrencyRate, CustomCurrencyRate } from './types.js';
import { getRow, allRows, run } from '../../database/sql.js';

/**
 * CurrencyQueries - All SQL queries for currency rates
 */
export class CurrencyQueries {
  constructor(private db: DatabaseAdapter) {}

  getCurrencyRate(
    fromCurrency: string,
    toCurrency: string,
    month: string,
    budgetId: number
  ): CurrencyRate | null {
    return getRow(
      this.db,
      `
      SELECT * FROM currency_rates
      WHERE FromCurrency = ?
        AND ToCurrency = ?
        AND Month = ?
        AND BudgetID = ?
      LIMIT 1
    `,
      fromCurrency,
      toCurrency,
      month,
      budgetId
    ) as CurrencyRate | null;
  }

  upsertCurrencyRate(
    fromCurrency: string,
    toCurrency: string,
    rate: number,
    month: string,
    lastUpdated: string,
    budgetId: number
  ): void {
    run(
      this.db,
      `
      INSERT INTO currency_rates (FromCurrency, ToCurrency, Rate, Month, LastUpdated, BudgetID)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(FromCurrency, ToCurrency, Month, BudgetID)
      DO UPDATE SET
        Rate = excluded.Rate,
        LastUpdated = excluded.LastUpdated
    `,
      fromCurrency,
      toCurrency,
      rate,
      month,
      lastUpdated,
      budgetId
    );
  }

  getAllCurrenciesUsed(budgetId: number): string[] {
    const results = allRows<{ Currency: string }>(
      this.db,
      `
      SELECT DISTINCT Currency
      FROM accounts
      WHERE BudgetID = ?
      UNION
      SELECT DISTINCT DisplayCurrency as Currency
      FROM budgets
      WHERE ID = ?
    `,
      budgetId,
      budgetId
    );

    return results.map((r) => r.Currency);
  }

  // Manual (offline/user-supplied) rates table helpers
  getManualCurrencyRate(
    fromCurrency: string,
    toCurrency: string,
    budgetId: number
  ): CurrencyRate | null {
    return getRow(
      this.db,
      `
      SELECT
        ID,
        FromCurrency,
        ToCurrency,
        Rate,
        CreatedAt as LastUpdated,
        BudgetID
      FROM manual_currency_rates
      WHERE FromCurrency = ?
        AND ToCurrency = ?
        AND BudgetID = ?
      LIMIT 1
    `,
      fromCurrency,
      toCurrency,
      budgetId
    ) as CurrencyRate | null;
  }

  upsertManualCurrencyRate(
    fromCurrency: string,
    toCurrency: string,
    rate: number,
    createdAt: string,
    budgetId: number
  ): void {
    run(
      this.db,
      `
      INSERT INTO manual_currency_rates (FromCurrency, ToCurrency, Rate, CreatedAt, BudgetID)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(FromCurrency, ToCurrency, BudgetID)
      DO UPDATE SET
        Rate = excluded.Rate,
        CreatedAt = excluded.CreatedAt
    `,
      fromCurrency,
      toCurrency,
      rate,
      createdAt,
      budgetId
    );
  }

  clearAllConvertedAmounts(budgetId: number): void {
    // Clear converted amounts from all transactions
    run(
      this.db,
      `
      UPDATE transactions
      SET Inflow = InflowOriginal,
          Outflow = OutflowOriginal,
          RunningBalance = RunningBalanceOriginal
      WHERE BudgetID = ?
    `,
      budgetId
    );

    run(
      this.db,
      `
      UPDATE accounts
      SET BalanceConverted = NULL
      WHERE BudgetID = ?
    `,
      budgetId
    );
  }

  clearAccountConvertedAmounts(accountId: number): void {
    // Clear converted amounts from all transactions for this account
    run(
      this.db,
      `
      UPDATE transactions
      SET Inflow = InflowOriginal,
          Outflow = OutflowOriginal,
          RunningBalance = RunningBalanceOriginal
      WHERE AccountID = ?
    `,
      accountId
    );

    run(
      this.db,
      `
      UPDATE accounts
      SET BalanceConverted = NULL
      WHERE ID = ?
    `,
      accountId
    );
  }

  deleteAllRatesForBudget(budgetId: number): void {
    run(
      this.db,
      `
      DELETE FROM currency_rates
      WHERE BudgetID = ?
    `,
      budgetId
    );
  }

  getCustomCurrencyRate(
    fromCurrency: string,
    toCurrency: string,
    date: string,
    budgetId: number
  ): CustomCurrencyRate | null {
    // Check the direct pair first, then the reciprocal direction
    for (const [from, to] of [
      [fromCurrency, toCurrency],
      [toCurrency, fromCurrency],
    ]) {
      const result = getRow(
        this.db,
        `
      SELECT * FROM custom_currency_rates
      WHERE FromCurrency = ?
        AND ToCurrency = ?
        AND BudgetID = ?
        AND StartDate <= ?
        AND (EndDate IS NULL OR EndDate >= ?)
      ORDER BY StartDate DESC
      LIMIT 1
    `,
        from,
        to,
        budgetId,
        date,
        date
      ) as CustomCurrencyRate | null;
      if (result) return result;
    }

    return null;
  }

  getCustomCurrencyRatesForBudget(budgetId: number): CustomCurrencyRate[] {
    return allRows<CustomCurrencyRate>(
      this.db,
      `
      SELECT * FROM custom_currency_rates
      WHERE BudgetID = ?
      ORDER BY FromCurrency, ToCurrency, StartDate DESC
    `,
      budgetId
    );
  }

  insertCustomCurrencyRate(
    fromCurrency: string,
    toCurrency: string,
    rate: number,
    startDate: string,
    endDate: string | null,
    budgetId: number
  ): number {
    const result = run(
      this.db,
      `
      INSERT INTO custom_currency_rates (FromCurrency, ToCurrency, Rate, StartDate, EndDate, BudgetID)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
      fromCurrency,
      toCurrency,
      rate,
      startDate,
      endDate,
      budgetId
    );
    return Number(result.lastInsertRowid);
  }

  updateCustomCurrencyRate(
    id: number,
    rate: number,
    startDate: string,
    endDate: string | null
  ): void {
    run(
      this.db,
      `
      UPDATE custom_currency_rates
      SET Rate = ?, StartDate = ?, EndDate = ?, UpdatedAt = datetime('now')
      WHERE ID = ?
    `,
      rate,
      startDate,
      endDate,
      id
    );
  }

  deleteCustomCurrencyRate(id: number): void {
    run(this.db, `DELETE FROM custom_currency_rates WHERE ID = ?`, id);
  }

  getCustomCurrencyRateById(id: number): CustomCurrencyRate | null {
    return getRow(
      this.db,
      `SELECT * FROM custom_currency_rates WHERE ID = ?`,
      id
    ) as CustomCurrencyRate | null;
  }

  getTransactionsForRecalculation(
    accountCurrency: string,
    budgetCurrency: string,
    startDate: string,
    endDate: string | null,
    budgetId: number
  ): {
    ID: number;
    Date: string;
    AccountID: number;
    InflowOriginal: number;
    OutflowOriginal: number;
    Inflow: number;
    Outflow: number;
  }[] {
    const endDateClause = endDate ? `AND t.Date <= ?` : '';
    const params: (string | number)[] = [accountCurrency, budgetId, startDate];
    if (endDate) params.push(endDate);
    return allRows<{
      ID: number;
      Date: string;
      AccountID: number;
      InflowOriginal: number;
      OutflowOriginal: number;
      Inflow: number;
      Outflow: number;
    }>(
      this.db,
      `
      SELECT t.ID, t.Date, t.AccountID, t.InflowOriginal, t.OutflowOriginal, t.Inflow, t.Outflow
      FROM transactions t
      JOIN accounts a ON t.AccountID = a.ID
      WHERE a.Currency = ?
        AND t.BudgetID = ?
        AND t.ExchangeRateOverride = 0
        AND t.Date >= ?
        ${endDateClause}
      ORDER BY t.Date ASC, t.ID ASC
    `,
      ...params
    );
  }
}
