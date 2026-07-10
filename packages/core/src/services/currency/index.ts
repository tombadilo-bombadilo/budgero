import { DatabaseAdapter } from '../../database/index.js';
import { convertAtRate, type MilliUnits } from '../../money/index.js';
import { CustomCurrencyRate } from './types.js';
import { TransactionQueries } from '../transactions/queries.js';
import { CurrencyQueries } from './queries.js';

import { createLogger } from '../../logger.js';
import { getRow, allRows, run } from '../../database/sql.js';
import { getLocalDateString } from '../../utils/date.js';

const debugLog = createLogger('services:currency');

export class CurrencyService {
  private static readonly EXCHANGE_RATES_MIN_INTERVAL_MS = 25; // ~40 RPS max, under server 50 RPS limit

  private static exchangeRatesThrottle: Promise<void> = Promise.resolve();

  private static lastExchangeRatesRequestAt = 0;

  private transactionQueries: TransactionQueries;

  private queries: CurrencyQueries;

  constructor(private db: DatabaseAdapter) {
    this.transactionQueries = new TransactionQueries(db);
    this.queries = new CurrencyQueries(db);
  }

  /** Fetch a budget's display currency, or null when the budget doesn't exist. */
  private getBudgetDisplayCurrency(budgetId: number): string | null {
    const row = getRow<{ DisplayCurrency: string }>(
      this.db,
      'SELECT DisplayCurrency FROM budgets WHERE ID = ?',
      budgetId
    );
    return row?.DisplayCurrency ?? null;
  }

  private async waitForExchangeRateRequestSlot(): Promise<void> {
    let releaseCurrent!: () => void;
    const currentSlot = new Promise<void>((resolve) => {
      releaseCurrent = resolve;
    });

    const previousSlot = CurrencyService.exchangeRatesThrottle;
    CurrencyService.exchangeRatesThrottle = previousSlot.then(
      () => currentSlot,
      () => currentSlot
    );

    await previousSlot;

    const now = Date.now();
    const waitMs = Math.max(
      0,
      CurrencyService.lastExchangeRatesRequestAt +
        CurrencyService.EXCHANGE_RATES_MIN_INTERVAL_MS -
        now
    );
    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }

    CurrencyService.lastExchangeRatesRequestAt = Date.now();
    releaseCurrent();
  }

  private async fetchExchangeRatesWithPacing(url: string): Promise<Response> {
    await this.waitForExchangeRateRequestSlot();
    return fetch(url);
  }

  private isDesktopRuntime(): boolean {
    try {
      if (typeof globalThis !== 'undefined') {
        const maybeDesktop = (globalThis as { budgero?: { desktop?: boolean } })?.budgero?.desktop;
        if (maybeDesktop) return true;
      }
    } catch {
      // Ignore - globalThis may not be available in all environments
    }
    try {
      if (typeof process !== 'undefined' && process?.env?.BUDGERO_DESKTOP === '1') {
        return true;
      }
    } catch {
      // Ignore - process may not be available in browser environments
    }
    return false;
  }

  /**
   * Resolve an exchange rate for a specific currency pair and month from the
   * local cache. NOT a pure lookup: when only the reciprocal pair is stored it
   * persists the inverted rate before returning it (unlike its read-only twin
   * getLocalRate).
   * @private - Use getOrFetchRate instead to ensure rates are fetched when needed
   */
  private resolveAndCacheRate(
    fromCurrency: string,
    toCurrency: string,
    month: string,
    budgetId: number
  ): number | null {
    if (fromCurrency === toCurrency) {
      return 1;
    }

    const rate = this.queries.getCurrencyRate(fromCurrency, toCurrency, month, budgetId);
    // If we do not find the rate search for the reciprocal rate
    if (!rate) {
      const reciprocalRate = this.queries.getCurrencyRate(
        toCurrency,
        fromCurrency,
        month,
        budgetId
      );
      if (reciprocalRate) {
        this.saveRate(fromCurrency, toCurrency, 1 / reciprocalRate.Rate, month, budgetId);
        return 1 / reciprocalRate.Rate;
      }
    }
    return rate ? rate.Rate : null;
  }

  /**
   * Save or update exchange rate
   */
  saveRate(
    fromCurrency: string,
    toCurrency: string,
    rate: number,
    month: string,
    budgetId: number
  ): void {
    const now = new Date().toISOString();
    this.queries.upsertCurrencyRate(fromCurrency, toCurrency, rate, month, now, budgetId);
  }

  /** Get a locally cached official monthly rate (no network). */
  getLocalRate(
    fromCurrency: string,
    toCurrency: string,
    month: string,
    budgetId: number
  ): number | null {
    if (fromCurrency === toCurrency) return 1;
    const direct = this.queries.getCurrencyRate(fromCurrency, toCurrency, month, budgetId);
    if (direct) return direct.Rate;
    const reciprocal = this.queries.getCurrencyRate(toCurrency, fromCurrency, month, budgetId);
    if (reciprocal) return 1 / reciprocal.Rate;
    return null;
  }

  /** Save/get manual (user-supplied) rates for offline usage. */
  saveManualRate(fromCurrency: string, toCurrency: string, rate: number, budgetId: number): void {
    const now = new Date().toISOString();
    // Save both direct and reciprocal to simplify lookups
    this.queries.upsertManualCurrencyRate(fromCurrency, toCurrency, rate, now, budgetId);
    if (rate && isFinite(rate) && rate > 0) {
      this.queries.upsertManualCurrencyRate(toCurrency, fromCurrency, 1 / rate, now, budgetId);
    }
  }

  getManualRate(fromCurrency: string, toCurrency: string, budgetId: number): number | null {
    if (fromCurrency === toCurrency) return 1;
    const row = this.queries.getManualCurrencyRate(fromCurrency, toCurrency, budgetId);
    if (row) return row.Rate;
    const reciprocal = this.queries.getManualCurrencyRate(toCurrency, fromCurrency, budgetId);
    if (reciprocal) return 1 / reciprocal.Rate;
    return null;
  }

  /**
   * Get a custom date-range rate for a specific date
   */
  getCustomRate(
    fromCurrency: string,
    toCurrency: string,
    date: string,
    budgetId: number
  ): number | null {
    if (fromCurrency === toCurrency) return 1;
    const customRate = this.queries.getCustomCurrencyRate(fromCurrency, toCurrency, date, budgetId);
    if (!customRate) return null;
    // If the stored pair is the reciprocal direction, invert
    if (customRate.FromCurrency === toCurrency && customRate.ToCurrency === fromCurrency) {
      return 1 / customRate.Rate;
    }
    return customRate.Rate;
  }

  /**
   * Resolve the best available rate using the full priority chain:
   * 1. Custom date-range rate
   * 2. Auto-fetched monthly rate
   * 3. Manual offline rate
   * 4. Adjacent month fallback
   * 5. null (caller decides what to do)
   */
  async resolveRate(
    fromCurrency: string,
    toCurrency: string,
    date: string,
    month: string,
    budgetId: number
  ): Promise<number | null> {
    if (this.isDesktopRuntime()) return 1;
    if (fromCurrency === toCurrency) return 1;

    // 1. Custom date-range rate
    const custom = this.getCustomRate(fromCurrency, toCurrency, date, budgetId);
    if (custom) return custom;

    // 2. Auto-fetched monthly rate
    const fetched = await this.getOrFetchRate(fromCurrency, toCurrency, month, budgetId);
    if (fetched) return fetched;

    // 3. Manual offline rate
    const manual = this.getManualRate(fromCurrency, toCurrency, budgetId);
    if (manual) return manual;

    // 4. Adjacent month fallback
    const fallback = this.getFallbackRate(fromCurrency, toCurrency, month, budgetId);
    if (fallback) return fallback;

    return null;
  }

  /**
   * Convert a milliunit amount from one currency to another. The float
   * product is rounded back to integer milliunits here — the one sanctioned
   * money-times-rate boundary (see money/index.ts).
   */
  async convertAmount(
    amount: MilliUnits,
    fromCurrency: string,
    toCurrency: string,
    month: string,
    budgetId: number,
    date?: string
  ): Promise<MilliUnits> {
    if (this.isDesktopRuntime()) {
      return amount;
    }
    if (fromCurrency === toCurrency) {
      return amount;
    }

    // Use full resolution chain if date is provided
    if (date) {
      const resolved = await this.resolveRate(fromCurrency, toCurrency, date, month, budgetId);
      if (resolved) return convertAtRate(amount, resolved);
      debugLog(`No exchange rate found for ${fromCurrency} to ${toCurrency} on ${date}`, {
        level: 'warn',
      });
      return amount;
    }

    const rate = await this.getOrFetchRate(fromCurrency, toCurrency, month, budgetId);

    if (!rate) {
      // Try manual user-supplied rate first (offline path)
      const manual = this.getManualRate(fromCurrency, toCurrency, budgetId);
      if (manual) return convertAtRate(amount, manual);
      // Try local fallback (adjacent months) before giving up
      const fallback = this.getFallbackRate(fromCurrency, toCurrency, month, budgetId);
      if (fallback) return convertAtRate(amount, fallback);
      debugLog(`No exchange rate found for ${fromCurrency} to ${toCurrency} in ${month}`, {
        level: 'warn',
      });
      // Return original amount if no rate found
      return amount;
    }

    return convertAtRate(amount, rate);
  }

  /**
   * Get exchange rate with automatic fetching if not available
   * This is useful for transfers between accounts with different currencies
   */
  async getOrFetchRate(
    fromCurrency: string,
    toCurrency: string,
    month: string,
    budgetId: number
  ): Promise<number | null> {
    if (this.isDesktopRuntime()) {
      return 1;
    }
    if (fromCurrency === toCurrency) {
      return 1;
    }

    // STEP 1: Check if we have the direct rate already
    let rate = this.resolveAndCacheRate(fromCurrency, toCurrency, month, budgetId);
    if (rate) {
      debugLog(`Found existing rate: ${fromCurrency} → ${toCurrency} = ${rate}`);
      return rate;
    }

    debugLog(`No rate found for ${fromCurrency} → ${toCurrency}, fetching from API...`);

    // STEP 2: Fetch the rate directly from the API
    try {
      // Fetch the direct rate from fromCurrency to toCurrency
      await this.fetchAndStoreRates([toCurrency], fromCurrency, month, budgetId);

      rate = this.resolveAndCacheRate(fromCurrency, toCurrency, month, budgetId);
      if (rate) {
        debugLog(`Successfully fetched rate: ${fromCurrency} → ${toCurrency} = ${rate}`);
        return rate;
      }

      // If direct fetch didn't work, try fetching USD rates as a common base
      // (CurrencyLayer free tier only supports USD as base in some cases)
      if (fromCurrency !== 'USD' && toCurrency !== 'USD') {
        debugLog(`Direct fetch failed, trying via USD...`);

        await this.fetchAndStoreRates([fromCurrency, toCurrency], 'USD', month, budgetId);

        const fromToUSD = this.resolveAndCacheRate(fromCurrency, 'USD', month, budgetId);
        const toToUSD = this.resolveAndCacheRate(toCurrency, 'USD', month, budgetId);

        if (fromToUSD && toToUSD) {
          // Calculate cross rate: fromCurrency → USD → toCurrency
          rate = fromToUSD / toToUSD;
          this.saveRate(fromCurrency, toCurrency, rate, month, budgetId);
          debugLog(`Calculated via USD: ${fromCurrency} → ${toCurrency} = ${rate}`);
          return rate;
        }
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('rate limit')) {
        debugLog(
          `API rate limit hit when fetching ${fromCurrency} → ${toCurrency}. Please try again later.`,
          { level: 'warn' }
        );
      } else {
        debugLog(`Failed to fetch rates for ${fromCurrency} → ${toCurrency}`, {
          level: 'error',
          error,
        });
      }
    }

    return null;
  }

  /**
   * Fetch and store exchange rates from external API for a specific month
   * Using CurrencyLayer API which supports 168 currencies including RSD
   *
   * STRATEGY: We fetch rates ONCE per month and reuse them for all transactions
   * in that month. This is standard practice for personal finance apps and keeps
   * API usage minimal while maintaining reasonable accuracy.
   * @private - Use getOrFetchRate instead to ensure proper error handling
   */
  private async fetchAndStoreRates(
    currencies: string[],
    baseCurrency: string,
    month: string,
    budgetId: number
  ): Promise<void> {
    if (this.isDesktopRuntime()) {
      return;
    }
    try {
      const currencyList = currencies.filter((c) => c !== baseCurrency).join(',');
      const url = `/api/v1/exchange-rates?base=${encodeURIComponent(baseCurrency)}&symbols=${encodeURIComponent(currencyList)}&month=${encodeURIComponent(month)}`;

      const response = await this.fetchExchangeRatesWithPacing(url);
      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('unauthorized');
        }
        throw new Error(`Failed to fetch rates: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      const quotes = data.quotes as Record<string, number> | undefined;

      for (const currency of currencies) {
        if (currency === baseCurrency) continue;
        const quoteKey = `${baseCurrency}${currency}`;
        const rate = quotes ? quotes[quoteKey] : undefined;
        if (typeof rate === 'number' && isFinite(rate) && rate > 0) {
          this.saveRate(baseCurrency, currency, rate, month, budgetId);
          this.saveRate(currency, baseCurrency, 1 / rate, month, budgetId);
        }
      }

      debugLog(`Fetched and stored monthly exchange rates for ${month}`, {
        baseCurrency,
        currencies: currencies.length,
        month,
        ratesStored: currencies.length - 1,
      });
    } catch (error) {
      debugLog('Failed to fetch exchange rates', { error, level: 'error' });
      throw error;
    }
  }

  /**
   * Get fallback rate from recent months (within last 3 months)
   * This is used when the API is unavailable or rate-limited
   */
  private getFallbackRate(
    fromCurrency: string,
    toCurrency: string,
    targetMonth: string,
    budgetId: number
  ): number | null {
    if (this.isDesktopRuntime()) {
      return 1;
    }
    const [year, month] = targetMonth.split('-').map(Number);
    const targetDate = new Date(year, month - 1, 1);

    // Check the last 3 months first, then up to 3 months ahead (in case we're
    // looking at historical data). The offset order preserves the search order.
    for (const offset of [-1, -2, -3, 1, 2, 3]) {
      const checkDate = new Date(targetDate);
      checkDate.setMonth(checkDate.getMonth() + offset);
      // Local getters: checkDate is a local month anchor, so toISOString()
      // would shift it into the previous month for UTC-positive timezones.
      const checkMonth = getLocalDateString(checkDate).slice(0, 7);

      const rate = this.resolveAndCacheRate(fromCurrency, toCurrency, checkMonth, budgetId);
      if (rate) {
        debugLog(
          `Found fallback rate from ${checkMonth} for ${fromCurrency} → ${toCurrency}: ${rate}`
        );
        return rate;
      }
    }

    return null;
  }

  getCustomRatesForBudget(budgetId: number): CustomCurrencyRate[] {
    return this.queries.getCustomCurrencyRatesForBudget(budgetId);
  }

  async addCustomRate(
    fromCurrency: string,
    toCurrency: string,
    rate: number,
    startDate: string,
    endDate: string | null,
    budgetId: number
  ): Promise<{ id: number; recalculated: number }> {
    const id = this.queries.insertCustomCurrencyRate(
      fromCurrency,
      toCurrency,
      rate,
      startDate,
      endDate,
      budgetId
    );
    const recalculated = await this.recalculateTransactionsForDateRange(
      fromCurrency,
      toCurrency,
      startDate,
      endDate,
      budgetId
    );
    return { id, recalculated };
  }

  async updateCustomRate(
    id: number,
    rate: number,
    startDate: string,
    endDate: string | null,
    budgetId: number
  ): Promise<{ recalculated: number }> {
    // Read old range to know full recalc scope
    const old = this.queries.getCustomCurrencyRateById(id);
    this.queries.updateCustomCurrencyRate(id, rate, startDate, endDate);

    // Recalc the union of old and new date ranges
    const effectiveStart = old && old.StartDate < startDate ? old.StartDate : startDate;
    const effectiveEnd =
      endDate === null || (old && old.EndDate === null)
        ? null
        : old && old.EndDate && old.EndDate > (endDate || '')
          ? old.EndDate
          : endDate;

    const fromCurrency = old?.FromCurrency || '';
    const toCurrency = old?.ToCurrency || '';
    const recalculated = await this.recalculateTransactionsForDateRange(
      fromCurrency,
      toCurrency,
      effectiveStart,
      effectiveEnd,
      budgetId
    );
    return { recalculated };
  }

  async deleteCustomRate(id: number, budgetId: number): Promise<{ recalculated: number }> {
    // Read rate info before deletion
    const old = this.queries.getCustomCurrencyRateById(id);
    this.queries.deleteCustomCurrencyRate(id);

    if (!old) return { recalculated: 0 };

    const recalculated = await this.recalculateTransactionsForDateRange(
      old.FromCurrency,
      old.ToCurrency,
      old.StartDate,
      old.EndDate,
      budgetId
    );
    return { recalculated };
  }

  /**
   * Retroactively recalculate transactions in a date range for a currency pair.
   * Only affects transactions where ExchangeRateOverride = 0.
   * Returns count of recalculated transactions.
   */
  async recalculateTransactionsForDateRange(
    fromCurrency: string,
    toCurrency: string,
    startDate: string,
    endDate: string | null,
    budgetId: number
  ): Promise<number> {
    const displayCurrency = this.getBudgetDisplayCurrency(budgetId);
    if (!displayCurrency) return 0;

    // Determine which currency is the account currency and which is the budget currency
    // fromCurrency/toCurrency in the custom rate may be in either order
    const accountCurrency = fromCurrency === displayCurrency ? toCurrency : fromCurrency;

    const txs = this.queries.getTransactionsForRecalculation(
      accountCurrency,
      displayCurrency,
      startDate,
      endDate,
      budgetId
    );

    let count = 0;
    const affectedAccounts = new Set<number>();

    for (const tx of txs) {
      const month = tx.Date.substring(0, 7);
      const rate = await this.resolveRate(
        accountCurrency,
        displayCurrency,
        tx.Date,
        month,
        budgetId
      );
      if (!rate) continue;

      // money x rate -> round back to integer milliunits before storing
      const inflowConverted = Math.round((tx.InflowOriginal || 0) * rate);
      const outflowConverted = Math.round((tx.OutflowOriginal || 0) * rate);

      run(
        this.db,
        `
        UPDATE transactions
        SET Inflow = ?, Outflow = ?, ExchangeRate = ?
        WHERE ID = ?
      `,
        inflowConverted,
        outflowConverted,
        rate,
        tx.ID
      );

      affectedAccounts.add(tx.AccountID);
      count++;
    }

    for (const accountId of affectedAccounts) {
      this.transactionQueries.recalculateBalances(accountId);
    }

    return count;
  }

  /**
   * Handle budget currency change
   * Clears all converted amounts and rates, forcing recalculation with new currency
   */
  async handleBudgetCurrencyChange(
    budgetId: number,
    newCurrency: string,
    oldCurrency: string
  ): Promise<void> {
    if (this.isDesktopRuntime()) {
      debugLog(
        `Desktop runtime: skipping currency recalculation for budget change ${oldCurrency} → ${newCurrency}`,
        { budgetId, level: 'info' }
      );
      // Still clear cached rates to avoid displaying outdated conversions
      this.queries.deleteAllRatesForBudget(budgetId);
      this.queries.clearAllConvertedAmounts(budgetId);
      return;
    }
    debugLog(`Handling budget currency change from ${oldCurrency} to ${newCurrency}`, {
      budgetId,
      level: 'info',
    });

    // 1. Clear all existing exchange rates for this budget
    this.queries.deleteAllRatesForBudget(budgetId);

    // 2. Clear all converted amounts (will be recalculated below)
    this.queries.clearAllConvertedAmounts(budgetId);

    // 3. Get all currencies used in accounts
    const accountCurrencies = this.queries.getAllCurrenciesUsed(budgetId);
    const uniqueCurrencies = [...new Set(accountCurrencies)].filter((c) => c !== newCurrency);

    if (uniqueCurrencies.length > 0) {
      // 4. Fetch new rates for current month (other months will be fetched during recalculation)
      const currentMonth = getLocalDateString().slice(0, 7);
      try {
        await this.fetchAndStoreRates(uniqueCurrencies, newCurrency, currentMonth, budgetId);
        debugLog(`Fetched new rates for budget currency change`, {
          currencies: uniqueCurrencies,
          baseCurrency: newCurrency,
        });
      } catch (error) {
        debugLog(`Failed to fetch rates after budget currency change`, {
          error,
          level: 'error',
        });
        // Continue anyway - rates will be fetched during recalculation
      }
    }

    // 5. Recalculate all conversions with new currency
    await this.recalculateAllConversions(budgetId);

    // 6. Convert monthly assignments and goals targets into the new currency
    try {
      // Convert assignments table for this budget
      const assignments = allRows<{ category_id: number; amount: number; month: string }>(
        this.db,
        `
        SELECT a.CategoryID as category_id, a.Amount as amount, a.Month as month
        FROM assignments a
        JOIN categories c ON c.ID = a.CategoryID
        WHERE c.BudgetID = ?
      `,
        budgetId
      );

      for (const row of assignments) {
        const rate = await this.getOrFetchRate(oldCurrency, newCurrency, row.month, budgetId);
        if (!rate) continue;
        const newAmount = Math.round(row.amount * rate);
        run(
          this.db,
          `UPDATE assignments SET Amount = ? WHERE CategoryID = ? AND Month = ?`,
          newAmount,
          row.category_id,
          row.month
        );
      }

      // Convert goals targets for categories in this budget
      const goals = allRows<{ id: number; category_id: number; target: number }>(
        this.db,
        `
        SELECT g.ID as id, g.CategoryID as category_id, g.Target as target
        FROM goals g
        JOIN categories c ON c.ID = g.CategoryID
        WHERE c.BudgetID = ?
      `,
        budgetId
      );

      // Use current month for conversion of targets (most consistent baseline)
      const currentMonth = getLocalDateString().slice(0, 7);
      const rateForGoals = await this.getOrFetchRate(
        oldCurrency,
        newCurrency,
        currentMonth,
        budgetId
      );
      const goalsRate = rateForGoals || 1;

      for (const row of goals) {
        const newTarget = Math.round(row.target * goalsRate);
        run(this.db, `UPDATE goals SET Target = ? WHERE ID = ?`, newTarget, row.id);
      }
    } catch (error) {
      debugLog('Failed to convert assignments/goals during budget currency change', {
        error,
        level: 'error',
      });
    }
  }

  /**
   * Handle account currency change
   * Clears converted amounts for that account's transactions
   */
  async handleAccountCurrencyChange(
    accountId: number,
    budgetId: number,
    newCurrency: string,
    oldCurrency: string
  ): Promise<void> {
    if (this.isDesktopRuntime()) {
      debugLog(
        `Desktop runtime: leaving transaction amounts untouched for account currency change ${oldCurrency} → ${newCurrency}`,
        { accountId, budgetId, level: 'info' }
      );
      return;
    }
    debugLog(`Handling account currency change from ${oldCurrency} to ${newCurrency}`, {
      accountId,
      level: 'info',
    });

    // 1. Convert ORIGINAL amounts to the new currency so the numbers reflect the new unit
    // This updates inflow_original, outflow_original, running_balance_original and the account balance
    // using month-specific exchange rates.
    try {
      // Get all transactions ordered by date for stable running balances
      const transactions = allRows<{
        id: number;
        date: string;
        inflow_original: number;
        outflow_original: number;
        running_balance_original: number;
      }>(
        this.db,
        `
        SELECT ID as id, Date as date, InflowOriginal as inflow_original, OutflowOriginal as outflow_original, RunningBalanceOriginal as running_balance_original
        FROM transactions 
        WHERE AccountID = ?
        ORDER BY Date ASC, ID ASC
      `,
        accountId
      );

      let runningBalanceOriginal = 0;
      for (const tx of transactions) {
        const month = tx.date.substring(0, 7);
        // Get or fetch rate old -> new for the tx month
        const rate = await this.getOrFetchRate(oldCurrency, newCurrency, month, budgetId);
        const effectiveRate = rate || 1; // fallback to 1 to avoid NaN

        // Some legacy rows may have NULL original amounts; fall back to converted values
        // which are currently in the OLD currency at this point in time.
        const baseInflow =
          (tx.inflow_original ?? null) !== null
            ? tx.inflow_original
            : (() => {
                const row = getRow<{ Inflow: number }>(
                  this.db,
                  'SELECT Inflow FROM transactions WHERE ID = ?',
                  tx.id
                );
                return row?.Inflow || 0;
              })();
        const baseOutflow =
          (tx.outflow_original ?? null) !== null
            ? tx.outflow_original
            : (() => {
                const row = getRow<{ Outflow: number }>(
                  this.db,
                  'SELECT Outflow FROM transactions WHERE ID = ?',
                  tx.id
                );
                return row?.Outflow || 0;
              })();

        const inflowNew = Math.round(baseInflow * effectiveRate);
        const outflowNew = Math.round(baseOutflow * effectiveRate);
        runningBalanceOriginal += inflowNew - outflowNew;

        run(
          this.db,
          `
          UPDATE transactions 
          SET InflowOriginal = ?, 
              OutflowOriginal = ?,
              RunningBalanceOriginal = ?
          WHERE ID = ?
        `,
          inflowNew,
          outflowNew,
          runningBalanceOriginal,
          tx.id
        );
      }

      // Update account original balance to new running balance
      run(
        this.db,
        `
        UPDATE accounts 
        SET Balance = ?
        WHERE ID = ?
      `,
        runningBalanceOriginal,
        accountId
      );
    } catch (error) {
      debugLog('Failed to convert original amounts during account currency change', {
        error,
        level: 'error',
      });
    }

    // 2. Clear converted amounts for this account's transactions (will be recalculated with new currency)
    this.queries.clearAccountConvertedAmounts(accountId);

    // 2. Get budget currency
    const displayCurrency = this.getBudgetDisplayCurrency(budgetId);

    // 3. Recalculate conversions for this account
    if (displayCurrency) {
      await this.recalculateAccountTransactions(accountId, newCurrency, displayCurrency, budgetId);
    }
  }

  /**
   * Recalculate all conversions for a budget
   * This is called after currency changes to update all transactions
   */
  async recalculateAllConversions(budgetId: number): Promise<void> {
    debugLog(`Recalculating all conversions for budget ${budgetId}`, { level: 'info' });

    const displayCurrency = this.getBudgetDisplayCurrency(budgetId);
    if (!displayCurrency) return;

    const accounts = allRows<{ id: number; currency: string }>(
      this.db,
      'SELECT ID as id, Currency as currency FROM accounts WHERE BudgetID = ?',
      budgetId
    );

    for (const account of accounts) {
      if (account.currency !== displayCurrency) {
        await this.recalculateAccountTransactions(
          account.id,
          account.currency,
          displayCurrency,
          budgetId
        );
      }
    }

    debugLog(`Completed recalculating conversions for budget ${budgetId}`, { level: 'info' });
  }

  private async recalculateAccountTransactions(
    accountId: number,
    accountCurrency: string,
    budgetCurrency: string,
    budgetId: number
  ): Promise<void> {
    const transactions = allRows<{
      id: number;
      date: string;
      inflow_original: number;
      outflow_original: number;
      running_balance_original: number;
    }>(
      this.db,
      `
      SELECT ID as id, Date as date, InflowOriginal as inflow_original, OutflowOriginal as outflow_original, RunningBalanceOriginal as running_balance_original
      FROM transactions 
      WHERE AccountID = ?
      ORDER BY Date ASC, ID ASC
    `,
      accountId
    );

    let runningBalanceConverted = 0;

    for (const tx of transactions) {
      const month = tx.date.substring(0, 7);

      const rate = await this.getOrFetchRate(accountCurrency, budgetCurrency, month, budgetId);

      if (rate) {
        const inflowConverted = Math.round(tx.inflow_original * rate);
        const outflowConverted = Math.round(tx.outflow_original * rate);
        runningBalanceConverted += inflowConverted - outflowConverted;

        // Only update ExchangeRate for non-overridden transactions
        run(
          this.db,
          `
          UPDATE transactions
          SET Inflow = ?,
              Outflow = ?,
              RunningBalance = ?,
              ExchangeRate = CASE WHEN ExchangeRateOverride = 0 THEN ? ELSE ExchangeRate END
          WHERE ID = ?
        `,
          inflowConverted,
          outflowConverted,
          runningBalanceConverted,
          rate,
          tx.id
        );
      }
    }

    run(
      this.db,
      `
      UPDATE accounts 
      SET BalanceConverted = ?
      WHERE ID = ?
    `,
      runningBalanceConverted,
      accountId
    );
  }
}
