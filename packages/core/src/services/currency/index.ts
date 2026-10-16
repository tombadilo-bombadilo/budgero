import { DatabaseAdapter } from '../../database/index.js';
import { asMilli, type MilliUnits } from '../../money/index.js';
import {
  assertValidExchangeRate,
  convertScaled,
  getCurrencyScale,
} from '../../currencies/index.js';
import { CustomCurrencyRate } from './types.js';
import { TransactionQueries } from '../transactions/queries.js';
import { CurrencyQueries } from './queries.js';
import { UserMetaQueries } from '../user-meta/queries.js';
import {
  applyTransferRate,
  getTransferIdsForCurrencyPair,
  getTransferRateDetails,
} from '../transactions/transfer-rate.js';

import { createLogger } from '../../logger.js';
import { getRow, allRows, run } from '../../database/sql.js';
import { getLocalDateString } from '../../utils/date.js';
import {
  applyBudgetCurrencyChange,
  collectBudgetCurrencyLookups,
  ExchangeRateUnavailableError,
  RateBook,
  repairBudgetCurrencyConversions,
  resolveLookups,
  type BudgetCurrencyChangePlan,
  type OfficialRateQuote,
  type RateSource,
} from './budget-currency-change.js';

const debugLog = createLogger('services:currency');

export class CurrencyService {
  private static readonly EXCHANGE_RATES_MIN_INTERVAL_MS = 25; // ~40 RPS max, under server 50 RPS limit

  /** How many days back a cached rate may lag the requested date and still
   * count as official. Mirrors the server's provider walk-back window. */
  static readonly RATE_FALLBACK_WINDOW_DAYS = 7;

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

  private static addDays(date: string, days: number): string {
    const [y, m, d] = date.split('-').map(Number);
    return getLocalDateString(new Date(y, m - 1, d + days));
  }

  /**
   * Resolve an exchange rate for a specific currency pair and date from the
   * local cache. NOT a pure lookup: when only the reciprocal pair is stored it
   * persists the inverted rate before returning it (unlike its read-only twin
   * getLocalRate).
   * @private - Use getOrFetchRate instead to ensure rates are fetched when needed
   */
  private resolveAndCacheRate(
    fromCurrency: string,
    toCurrency: string,
    rateDate: string,
    budgetId: number
  ): number | null {
    if (fromCurrency === toCurrency) {
      return 1;
    }

    const rate = this.queries.getCurrencyRate(fromCurrency, toCurrency, rateDate, budgetId);
    // If we do not find the rate search for the reciprocal rate
    if (!rate) {
      const reciprocalRate = this.queries.getCurrencyRate(
        toCurrency,
        fromCurrency,
        rateDate,
        budgetId
      );
      if (reciprocalRate) {
        this.saveRate(fromCurrency, toCurrency, 1 / reciprocalRate.Rate, rateDate, budgetId);
        return 1 / reciprocalRate.Rate;
      }
    }
    return rate ? rate.Rate : null;
  }

  /**
   * Cached rate for the date, accepting the nearest earlier entry within the
   * fallback window (both directions). No network.
   */
  private findNearbyRate(
    fromCurrency: string,
    toCurrency: string,
    rateDate: string,
    budgetId: number
  ): number | null {
    if (fromCurrency === toCurrency) return 1;

    // Future transactions use today's official rates. Keep the freshness
    // window anchored to today too, rather than rejecting today's rate as
    // stale relative to a payment scheduled weeks or months from now.
    const today = getLocalDateString();
    const effectiveDate = rateDate > today ? today : rateDate;
    const exact = this.resolveAndCacheRate(fromCurrency, toCurrency, effectiveDate, budgetId);
    if (exact) return exact;

    const windowStart = CurrencyService.addDays(
      effectiveDate,
      -CurrencyService.RATE_FALLBACK_WINDOW_DAYS
    );
    const direct = this.queries.getLatestCurrencyRateOnOrBefore(
      fromCurrency,
      toCurrency,
      effectiveDate,
      budgetId
    );
    if (direct && direct.RateDate >= windowStart) return direct.Rate;

    const reciprocal = this.queries.getLatestCurrencyRateOnOrBefore(
      toCurrency,
      fromCurrency,
      effectiveDate,
      budgetId
    );
    if (reciprocal && reciprocal.RateDate >= windowStart) return 1 / reciprocal.Rate;

    return null;
  }

  /**
   * Save or update exchange rate
   */
  saveRate(
    fromCurrency: string,
    toCurrency: string,
    rate: number,
    rateDate: string,
    budgetId: number
  ): void {
    assertValidExchangeRate(rate);
    const now = new Date().toISOString();
    this.queries.upsertCurrencyRate(fromCurrency, toCurrency, rate, rateDate, now, budgetId);
  }

  /**
   * Closest cached rate at or before the date with NO freshness window —
   * offline-prompt prefill only, never used for automatic conversion.
   */
  getClosestCachedRate(
    fromCurrency: string,
    toCurrency: string,
    rateDate: string,
    budgetId: number
  ): number | null {
    if (fromCurrency === toCurrency) return 1;
    const direct = this.queries.getLatestCurrencyRateOnOrBefore(
      fromCurrency,
      toCurrency,
      rateDate,
      budgetId
    );
    if (direct) return direct.Rate;
    const reciprocal = this.queries.getLatestCurrencyRateOnOrBefore(
      toCurrency,
      fromCurrency,
      rateDate,
      budgetId
    );
    if (reciprocal) return 1 / reciprocal.Rate;
    return null;
  }

  /**
   * Get a locally cached official rate for the date (no network), accepting
   * the nearest earlier entry within the fallback window.
   */
  getLocalRate(
    fromCurrency: string,
    toCurrency: string,
    rateDate: string,
    budgetId: number
  ): number | null {
    return this.findNearbyRate(fromCurrency, toCurrency, rateDate, budgetId);
  }

  /** Save/get manual (user-supplied) rates for offline usage. */
  saveManualRate(fromCurrency: string, toCurrency: string, rate: number, budgetId: number): void {
    assertValidExchangeRate(rate);
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
   * 2. Official daily rate (cached within the fallback window, else fetched)
   * 3. Manual offline rate
   * 4. null (caller decides what to do — never a silent 1:1)
   */
  async resolveRate(
    fromCurrency: string,
    toCurrency: string,
    date: string,
    budgetId: number
  ): Promise<number | null> {
    if (fromCurrency === toCurrency) return 1;

    // 1. Custom date-range rate
    const custom = this.getCustomRate(fromCurrency, toCurrency, date, budgetId);
    if (custom) return custom;

    // 2. Official daily rate (cache within window, then network)
    const fetched = await this.getOrFetchRate(fromCurrency, toCurrency, date, budgetId);
    if (fetched) return fetched;

    // 3. Manual offline rate
    const manual = this.getManualRate(fromCurrency, toCurrency, budgetId);
    if (manual) return manual;

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
    rateDate: string,
    budgetId: number
  ): Promise<MilliUnits> {
    if (fromCurrency === toCurrency) {
      return amount;
    }

    const resolved = await this.resolveRate(fromCurrency, toCurrency, rateDate, budgetId);
    if (resolved) return asMilli(convertScaled(amount, resolved, fromCurrency, toCurrency));

    debugLog(`No exchange rate found for ${fromCurrency} to ${toCurrency} on ${rateDate}`, {
      level: 'warn',
    });
    return amount;
  }

  /**
   * Get exchange rate with automatic fetching if not available
   * This is useful for transfers between accounts with different currencies
   */
  async getOrFetchRate(
    fromCurrency: string,
    toCurrency: string,
    rateDate: string,
    budgetId: number
  ): Promise<number | null> {
    if (fromCurrency === toCurrency) {
      return 1;
    }

    // STEP 1: Cached rate for the date (or within the fallback window)
    const cached = this.findNearbyRate(fromCurrency, toCurrency, rateDate, budgetId);
    if (cached) {
      return cached;
    }

    debugLog(`No cached rate for ${fromCurrency} → ${toCurrency}, fetching from API...`);

    // STEP 2: Fetch from the API (the dataset serves any base directly)
    try {
      const today = getLocalDateString();
      const effectiveDate = rateDate > today ? today : rateDate;
      await this.fetchAndStoreRates([toCurrency], fromCurrency, effectiveDate, budgetId);
      const fetched = this.findNearbyRate(fromCurrency, toCurrency, rateDate, budgetId);
      if (fetched) {
        debugLog(`Successfully fetched rate: ${fromCurrency} → ${toCurrency} = ${fetched}`);
        return fetched;
      }
    } catch (error) {
      debugLog(`Failed to fetch rates for ${fromCurrency} → ${toCurrency}`, {
        level: 'error',
        error,
      });
    }

    return null;
  }

  /**
   * Fetch official quotes from the server proxy without storing them. The
   * server caches per (pair, date) and may clamp a future request or serve a
   * slightly earlier dataset date; the returned `date` is the one to store the
   * quotes under, so a current rate never gets stored as a future day's rate.
   */
  async fetchOfficialQuotes(
    currencies: string[],
    baseCurrency: string,
    rateDate: string,
    forceRefresh = false
  ): Promise<{ date: string; quotes: Record<string, number> }> {
    const currencyList = currencies.filter((c) => c !== baseCurrency).join(',');
    const refreshParam = forceRefresh ? '&refresh=true' : '';
    const url = `/api/v1/exchange-rates?base=${encodeURIComponent(baseCurrency)}&symbols=${encodeURIComponent(currencyList)}&date=${encodeURIComponent(rateDate)}${refreshParam}`;

    const response = await this.fetchExchangeRatesWithPacing(url);
    if (!response.ok) {
      if (response.status === 401) {
        throw new Error('unauthorized');
      }
      throw new Error(`Failed to fetch rates: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const quotes = (data.quotes as Record<string, number> | undefined) ?? {};
    const responseRateDate =
      typeof data.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(data.date) ? data.date : rateDate;
    return { date: responseRateDate, quotes };
  }

  /**
   * Fetch and store daily exchange rates from the server proxy.
   * @private - Use getOrFetchRate instead to ensure proper error handling
   */
  private async fetchAndStoreRates(
    currencies: string[],
    baseCurrency: string,
    rateDate: string,
    budgetId: number,
    forceRefresh = false
  ): Promise<void> {
    try {
      const { date: responseRateDate, quotes } = await this.fetchOfficialQuotes(
        currencies,
        baseCurrency,
        rateDate,
        forceRefresh
      );

      // Prune before saving so an explicitly requested historical rate is
      // available to the caller and reusable by the rest of the current pass.
      // Pruning after the save immediately deleted rates older than retention,
      // leaving conversions pending and causing the same request to loop.
      this.pruneRateCache(budgetId);

      for (const currency of currencies) {
        if (currency === baseCurrency) continue;
        const quoteKey = `${baseCurrency}${currency}`;
        const rate = quotes[quoteKey];
        if (typeof rate === 'number' && isFinite(rate) && rate > 0) {
          this.saveRate(baseCurrency, currency, rate, responseRateDate, budgetId);
          this.saveRate(currency, baseCurrency, 1 / rate, responseRateDate, budgetId);
        }
      }

      debugLog(`Fetched and stored daily exchange rates for ${responseRateDate}`, {
        baseCurrency,
        currencies: currencies.length,
        requestedRateDate: rateDate,
        rateDate: responseRateDate,
      });
    } catch (error) {
      debugLog('Failed to fetch exchange rates', { error, level: 'error' });
      throw error;
    }
  }

  /**
   * Drop cached daily rates older than the user's retention setting. Safe:
   * every transaction stores its own ExchangeRate, and pruned historical
   * rates refetch on demand when online.
   */
  pruneRateCache(budgetId: number): number {
    const retentionDays = new UserMetaQueries(this.db).getRateCacheRetentionDays();
    const cutoff = CurrencyService.addDays(getLocalDateString(), -retentionDays);
    const pruned = this.queries.pruneRatesOlderThan(cutoff, budgetId);
    if (pruned > 0) {
      debugLog(`Pruned ${pruned} cached rates older than ${cutoff}`, { budgetId });
    }
    return pruned;
  }

  /** One-cent threshold (milliunits) below which no revaluation is journaled. */
  private static readonly REVALUATION_EPSILON_MILLI = 10;

  /**
   * True up converted balances of foreign-currency accounts to
   * native × latest official rate, journaling each delta in
   * account_revaluations (one merged row per account per day). Transactions
   * keep their historical rates — this reconciles the stock, not the flows.
   * Returns the number of accounts revalued.
   */
  async revalueAccounts(budgetId: number): Promise<number> {
    const displayCurrency = this.getBudgetDisplayCurrency(budgetId);
    if (!displayCurrency) return 0;

    const today = getLocalDateString();
    const accounts = allRows<{
      ID: number;
      Currency: string;
      BalanceNative: number;
      BalanceConverted: number | null;
    }>(
      this.db,
      `SELECT ID, Currency, BalanceNative, BalanceConverted
       FROM accounts WHERE BudgetID = ? AND Currency != ?`,
      budgetId,
      displayCurrency
    );

    let revalued = 0;
    for (const account of accounts) {
      // NULL converted balance means the conversion pipeline hasn't run yet.
      if (account.BalanceConverted == null) continue;

      // A custom date-range rate pins the conversion — true up to it instead
      // of the market. Otherwise official rates only; manual offline rates
      // never drive revaluation.
      const rate =
        this.getCustomRate(account.Currency, displayCurrency, today, budgetId) ??
        (await this.getOrFetchRate(account.Currency, displayCurrency, today, budgetId));
      if (!rate) continue;

      const target = convertScaled(account.BalanceNative, rate, account.Currency, displayCurrency);
      const delta = target - account.BalanceConverted;
      if (Math.abs(delta) < CurrencyService.REVALUATION_EPSILON_MILLI) continue;

      const impliedOldRate =
        account.BalanceNative !== 0
          ? (account.BalanceConverted / account.BalanceNative) *
            (getCurrencyScale(account.Currency) / getCurrencyScale(displayCurrency))
          : null;

      // Merge same-day true-ups into one row; OldRate keeps the day's first value.
      run(
        this.db,
        `
        INSERT INTO account_revaluations
          (BudgetID, AccountID, Date, OldRate, NewRate, BalanceNative, DeltaConverted)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(AccountID, Date) DO UPDATE SET
          NewRate = excluded.NewRate,
          BalanceNative = excluded.BalanceNative,
          DeltaConverted = DeltaConverted + excluded.DeltaConverted,
          CreatedAt = datetime('now')
      `,
        budgetId,
        account.ID,
        today,
        impliedOldRate,
        rate,
        account.BalanceNative,
        delta
      );
      run(this.db, `UPDATE accounts SET BalanceConverted = ? WHERE ID = ?`, target, account.ID);
      revalued++;
    }

    if (revalued > 0) {
      debugLog(`Revalued ${revalued} accounts to today's rates`, { budgetId });
    }
    return revalued;
  }

  /** Daily revaluation rows for an account, oldest first (default last 90 days). */
  getRevaluationHistory(
    accountId: number,
    days = 90
  ): { Date: string; OldRate: number | null; NewRate: number; DeltaConverted: number }[] {
    const cutoff = CurrencyService.addDays(getLocalDateString(), -days);
    return allRows(
      this.db,
      `
      SELECT Date, OldRate, NewRate, DeltaConverted
      FROM account_revaluations
      WHERE AccountID = ? AND Date >= ?
      ORDER BY Date ASC
    `,
      accountId,
      cutoff
    );
  }

  /**
   * Total journaled revaluation delta feeding Ready to Assign (on-budget
   * accounts only) — the same term the RTA query adds.
   */
  getBudgetRevaluationTotal(budgetId: number): number {
    const row = getRow<{ Total: number }>(
      this.db,
      `
      SELECT IFNULL(SUM(r.DeltaConverted), 0) AS Total
      FROM account_revaluations r
      INNER JOIN accounts a ON r.AccountID = a.ID
      WHERE r.BudgetID = ? AND a.OnBudget = TRUE
    `,
      budgetId
    );
    return row?.Total ?? 0;
  }

  /** All revaluation rows for a budget, oldest first — for history reconstruction. */
  getBudgetRevaluations(
    budgetId: number
  ): { AccountID: number; Date: string; DeltaConverted: number }[] {
    return allRows(
      this.db,
      `
      SELECT AccountID, Date, DeltaConverted
      FROM account_revaluations
      WHERE BudgetID = ?
      ORDER BY Date ASC
    `,
      budgetId
    );
  }

  /**
   * Refetch today's official rates from the server.
   * The server-side refresh bypasses its cache. Existing local rates are kept
   * until the replacement succeeds, so a temporary provider outage cannot
   * erase the last usable rate.
   */
  async refreshOfficialRates(budgetId: number): Promise<void> {
    const displayCurrency = this.getBudgetDisplayCurrency(budgetId);
    if (!displayCurrency) return;

    const today = getLocalDateString();
    const currencies = this.queries
      .getAllCurrenciesUsed(budgetId)
      .filter((currency) => currency && currency !== displayCurrency);
    if (currencies.length > 0) {
      await this.fetchAndStoreRates(currencies, displayCurrency, today, budgetId, true);
    }
  }

  /** Refetch today's official rates and revalue foreign-currency accounts. */
  async restoreOfficialRates(budgetId: number): Promise<number> {
    await this.refreshOfficialRates(budgetId);

    return this.revalueAccounts(budgetId);
  }

  /** Aggregate revaluation impact for an account (all-time and last 30 days). */
  getRevaluationSummary(accountId: number): {
    total: number;
    last30Days: number;
    lastDate: string | null;
  } {
    const cutoff = CurrencyService.addDays(getLocalDateString(), -30);
    const row = getRow<{ Total: number; Last30: number; LastDate: string | null }>(
      this.db,
      `
      SELECT
        COALESCE(SUM(DeltaConverted), 0) AS Total,
        COALESCE(SUM(CASE WHEN Date >= ? THEN DeltaConverted ELSE 0 END), 0) AS Last30,
        MAX(Date) AS LastDate
      FROM account_revaluations
      WHERE AccountID = ?
    `,
      cutoff,
      accountId
    );
    return {
      total: row?.Total ?? 0,
      last30Days: row?.Last30 ?? 0,
      lastDate: row?.LastDate ?? null,
    };
  }

  /**
   * Re-resolve official rates for transactions whose conversion was marked
   * pending (offline/manual placeholder) and not pinned by the user. Called
   * when the app regains connectivity. Returns the number of updated rows.
   */
  async resyncPendingConversions(budgetId: number): Promise<number> {
    const pending = allRows<{
      ID: number;
      Date: string;
      AccountID: number;
      InflowNative: number | null;
      OutflowNative: number | null;
      Currency: string;
    }>(
      this.db,
      `
      SELECT t.ID, t.Date, t.AccountID, t.InflowNative, t.OutflowNative, a.Currency
      FROM transactions t
      JOIN accounts a ON t.AccountID = a.ID
      WHERE t.BudgetID = ?
        AND t.ConversionPending = 1
        AND t.ExchangeRateOverride = 0
      ORDER BY t.Date ASC, t.ID ASC
    `,
      budgetId
    );
    if (pending.length === 0) return 0;

    const displayCurrency = this.getBudgetDisplayCurrency(budgetId);
    if (!displayCurrency) return 0;

    let updated = 0;
    const affectedAccounts = new Set<number>();

    for (const tx of pending) {
      if (tx.Currency === displayCurrency) continue;
      // Official/custom only — a manual rate is what we're replacing.
      const custom = this.getCustomRate(tx.Currency, displayCurrency, tx.Date, budgetId);
      const official =
        custom ?? (await this.getOrFetchRate(tx.Currency, displayCurrency, tx.Date, budgetId));
      if (!official) continue;

      const inflowConverted = convertScaled(
        tx.InflowNative || 0,
        official,
        tx.Currency,
        displayCurrency
      );
      const outflowConverted = convertScaled(
        tx.OutflowNative || 0,
        official,
        tx.Currency,
        displayCurrency
      );
      run(
        this.db,
        `
        UPDATE transactions
        SET InflowConverted = ?, OutflowConverted = ?, ExchangeRate = ?, ConversionPending = 0
        WHERE ID = ?
      `,
        inflowConverted,
        outflowConverted,
        official,
        tx.ID
      );
      affectedAccounts.add(tx.AccountID);
      updated++;
    }

    for (const accountId of affectedAccounts) {
      this.transactionQueries.recalculateBalances(accountId);
    }
    // Split lines follow their parent's re-converted amount.
    this.transactionQueries.resyncSplitLinesForAccounts([...affectedAccounts]);

    if (updated > 0) {
      debugLog(`Resynced ${updated} pending conversions to official rates`, { budgetId });
    }
    return updated;
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
    budgetId: number,
    /** Also store the explicit reverse pair (to→from at 1/rate) as its own
     * visible row. Lookups derive the reverse either way; this makes it
     * editable and listed. */
    alsoReverse = false,
    /** Only passed by undo/redo, to recreate rows under their original IDs. */
    ids?: { id?: number; reverseId?: number | null }
  ): Promise<{ id: number; reverseId: number | null; recalculated: number }> {
    assertValidExchangeRate(rate);
    const id = this.queries.insertCustomCurrencyRate(
      fromCurrency,
      toCurrency,
      rate,
      startDate,
      endDate,
      budgetId,
      ids?.id
    );
    let reverseId: number | null = null;
    if (alsoReverse && isFinite(rate) && rate > 0) {
      reverseId = this.queries.insertCustomCurrencyRate(
        toCurrency,
        fromCurrency,
        1 / rate,
        startDate,
        endDate,
        budgetId,
        ids?.reverseId ?? undefined
      );
    }
    const recalculated = await this.recalculateTransactionsForDateRange(
      fromCurrency,
      toCurrency,
      startDate,
      endDate,
      budgetId
    );
    // Reciprocal lookup is automatic, so recalculating the reverse row would
    // visit the same transactions/transfers a second time.
    const reverseRecalculated = 0;
    await this.revalueAccounts(budgetId);
    return { id, reverseId, recalculated: recalculated + reverseRecalculated };
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
    await this.revalueAccounts(budgetId);
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
    await this.revalueAccounts(budgetId);
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

    const matchingTransferIds = new Set(
      getTransferIdsForCurrencyPair(this.db, fromCurrency, toCurrency, startDate, endDate, budgetId)
    );

    // A custom pair between two non-budget currencies applies to the direct
    // conversion performed by linked transfers. Ordinary transactions only
    // convert account→budget and therefore cannot consume this pair.
    if (fromCurrency !== displayCurrency && toCurrency !== displayCurrency) {
      return this.recalculateTransfersForDateRange(
        fromCurrency,
        toCurrency,
        startDate,
        endDate,
        budgetId
      );
    }

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
      // Matching transfers are recalculated atomically below so the custom
      // direct rate updates the received native amount as well as both budget
      // valuations. Do not independently rewrite one of their legs here.
      if (tx.TransferID && matchingTransferIds.has(tx.TransferID)) continue;

      const rate = await this.resolveRate(accountCurrency, displayCurrency, tx.Date, budgetId);
      if (!rate) continue;

      // money x rate -> round back to integer milliunits before storing
      const inflowConverted = convertScaled(
        tx.InflowNative || 0,
        rate,
        accountCurrency,
        displayCurrency
      );
      const outflowConverted = convertScaled(
        tx.OutflowNative || 0,
        rate,
        accountCurrency,
        displayCurrency
      );

      run(
        this.db,
        `
        UPDATE transactions
        SET InflowConverted = ?, OutflowConverted = ?, ExchangeRate = ?
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
    // Split lines follow their parent's re-converted amount.
    this.transactionQueries.resyncSplitLinesForAccounts([...affectedAccounts]);

    const transferCount = await this.recalculateTransfersForDateRange(
      fromCurrency,
      toCurrency,
      startDate,
      endDate,
      budgetId
    );

    return count + transferCount;
  }

  private async recalculateTransfersForDateRange(
    fromCurrency: string,
    toCurrency: string,
    startDate: string,
    endDate: string | null,
    budgetId: number
  ): Promise<number> {
    const transferIds = getTransferIdsForCurrencyPair(
      this.db,
      fromCurrency,
      toCurrency,
      startDate,
      endDate,
      budgetId
    );
    let recalculated = 0;

    for (const transferId of transferIds) {
      const details = getTransferRateDetails(this.db, transferId);
      // A manual override on either leg protects the linked transfer as one
      // accounting operation. Custom rates only replace fetched rates.
      if (!details || details.hasRateOverride) continue;

      const directRate = await this.resolveRate(
        details.source.currency,
        details.destination.currency,
        details.date,
        details.budgetId
      );
      if (!directRate) continue;

      await applyTransferRate(
        this.db,
        transferId,
        directRate,
        (sourceCurrency, destinationCurrency, date, resolvedBudgetId) =>
          this.resolveRate(sourceCurrency, destinationCurrency, date, resolvedBudgetId),
        {
          sourceOverride: false,
          destinationOverride: false,
          transferOverride: false,
          refreshBudgetRates: true,
        }
      );
      recalculated += 2;
    }

    return recalculated;
  }

  private rateSource(budgetId: number): RateSource {
    return {
      fetchQuotes: (symbols, base, date) => this.fetchOfficialQuotes(symbols, base, date),
      // Read-only (unlike findNearbyRate, never writes a reciprocal row).
      cachedRate: (from, to, date) => {
        const windowStart = CurrencyService.addDays(
          date,
          -CurrencyService.RATE_FALLBACK_WINDOW_DAYS
        );
        const direct = this.queries.getLatestCurrencyRateOnOrBefore(from, to, date, budgetId);
        if (direct && direct.RateDate >= windowStart) return direct.Rate;
        const reciprocal = this.queries.getLatestCurrencyRateOnOrBefore(to, from, date, budgetId);
        if (reciprocal && reciprocal.RateDate >= windowStart) return 1 / reciprocal.Rate;
        return null;
      },
    };
  }

  /**
   * Phase 1 of a budget currency change: find (and fetch) every rate the
   * conversion needs, writing nothing. Rates already carried by the op are
   * used first, so a replay converts with the originating device's numbers.
   * Throws ExchangeRateUnavailableError when any rate is missing.
   */
  async planBudgetCurrencyChange(
    budgetId: number,
    fromCurrency: string,
    toCurrency: string,
    carried?: { asOf?: string; rates?: OfficialRateQuote[] }
  ): Promise<{ plan: BudgetCurrencyChangePlan; book: RateBook }> {
    const asOf =
      carried?.asOf && /^\d{4}-\d{2}-\d{2}$/.test(carried.asOf)
        ? carried.asOf
        : getLocalDateString();
    const book = new RateBook(asOf);
    const rates: OfficialRateQuote[] = [];
    for (const quote of carried?.rates ?? []) {
      book.add(quote);
      rates.push(quote);
    }
    const lookups = collectBudgetCurrencyLookups(this.db, budgetId, fromCurrency, toCurrency, asOf);
    const foreignCurrencies = [
      ...new Set(this.queries.getAllCurrenciesUsed(budgetId).filter((c) => c !== toCurrency)),
    ];
    const { added, missing } = await resolveLookups(lookups, book, this.rateSource(budgetId), {
      // Today's rates for every account currency, as the old pass fetched up
      // front (only when the op did not bring its own rates).
      prefetchToday:
        carried?.rates === undefined && foreignCurrencies.length > 0
          ? { base: toCurrency, symbols: foreignCurrencies, asOf }
          : undefined,
    });
    if (missing.length > 0) throw new ExchangeRateUnavailableError(missing);
    rates.push(...added);
    return { plan: { fromCurrency, toCurrency, asOf, rates }, book };
  }

  /**
   * Phase 2: apply a planned change. Synchronous; the caller runs it inside
   * the same db.transaction as the DisplayCurrency update.
   */
  applyBudgetCurrencyChange(
    budgetId: number,
    plan: BudgetCurrencyChangePlan,
    book: RateBook,
    setDisplayCurrency: (currency: string) => void
  ): void {
    debugLog(`Applying budget currency change ${plan.fromCurrency} → ${plan.toCurrency}`, {
      budgetId,
      rates: plan.rates.length,
      level: 'info',
    });
    applyBudgetCurrencyChange(this.db, budgetId, plan, book, {
      setDisplayCurrency,
      clearConvertedAmounts: () => this.queries.clearAllConvertedAmounts(budgetId),
      replaceRateCache: (quotes) => {
        // Old-currency rates are useless now; keep the fetched ones as the
        // warm cache (subject to the usual retention).
        this.queries.deleteAllRatesForBudget(budgetId);
        for (const quote of quotes) {
          this.saveRate(quote.from, quote.to, quote.rate, quote.date, budgetId);
          this.saveRate(quote.to, quote.from, 1 / quote.rate, quote.date, budgetId);
        }
        this.pruneRateCache(budgetId);
      },
    });
  }

  /**
   * Replay of a currency change that this DB already shows as applied (see
   * repairBudgetCurrencyConversions). Best effort, never throws for missing
   * rates; returns the number of accounts recomputed.
   */
  async repairBudgetCurrencyChange(
    budgetId: number,
    toCurrency: string,
    carried?: { asOf?: string; rates?: OfficialRateQuote[] }
  ): Promise<number> {
    const asOf =
      carried?.asOf && /^\d{4}-\d{2}-\d{2}$/.test(carried.asOf)
        ? carried.asOf
        : getLocalDateString();
    const book = new RateBook(asOf);
    for (const quote of carried?.rates ?? []) book.add(quote);
    const lookups = collectBudgetCurrencyLookups(this.db, budgetId, toCurrency, toCurrency, asOf, {
      budgetAmounts: false,
    });
    if (lookups.length === 0) return 0;
    await resolveLookups(lookups, book, this.rateSource(budgetId));
    return this.db.transaction(() =>
      repairBudgetCurrencyConversions(this.db, budgetId, toCurrency, book)
    );
  }

  /**
   * Handle account currency change
   * Clears converted amounts for that account's transactions
   */
  async handleAccountCurrencyChange(
    accountId: number,
    budgetId: number,
    newCurrency: string,
    oldCurrency: string,
    mode: 'convert' | 'reinterpret' = 'convert'
  ): Promise<void> {
    debugLog(`Handling account currency change from ${oldCurrency} to ${newCurrency}`, {
      accountId,
      mode,
      level: 'info',
    });

    // 1. Establish native amounts in the new currency. Convert mode preserves
    // economic value; reinterpret mode preserves the entered numbers and only
    // changes which currency unit those numbers represent.
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
        SELECT ID as id, Date as date, InflowNative as inflow_original, OutflowNative as outflow_original, RunningBalanceNative as running_balance_original
        FROM transactions 
        WHERE AccountID = ?
        ORDER BY Date ASC, ID ASC
      `,
        accountId
      );

      let runningBalanceOriginal = 0;
      for (const tx of transactions) {
        // Some legacy rows may have NULL original amounts; fall back to converted values
        // which are currently in the OLD currency at this point in time.
        const baseInflow =
          (tx.inflow_original ?? null) !== null
            ? tx.inflow_original
            : (() => {
                const row = getRow<{ InflowConverted: number }>(
                  this.db,
                  'SELECT InflowConverted FROM transactions WHERE ID = ?',
                  tx.id
                );
                return row?.InflowConverted || 0;
              })();
        const baseOutflow =
          (tx.outflow_original ?? null) !== null
            ? tx.outflow_original
            : (() => {
                const row = getRow<{ OutflowConverted: number }>(
                  this.db,
                  'SELECT OutflowConverted FROM transactions WHERE ID = ?',
                  tx.id
                );
                return row?.OutflowConverted || 0;
              })();

        // A 1:1 conversion preserves the human-readable number while adapting
        // storage scales (for example fiat milliunits versus crypto sat-scale).
        let inflowNew = convertScaled(baseInflow, 1, oldCurrency, newCurrency);
        let outflowNew = convertScaled(baseOutflow, 1, oldCurrency, newCurrency);
        if (mode === 'convert') {
          // Get or fetch rate old -> new for the transaction date. Falling
          // back to 1 matches the established missing-rate behavior.
          const rate = await this.getOrFetchRate(oldCurrency, newCurrency, tx.date, budgetId);
          const effectiveRate = rate || 1;
          inflowNew = convertScaled(baseInflow, effectiveRate, oldCurrency, newCurrency);
          outflowNew = convertScaled(baseOutflow, effectiveRate, oldCurrency, newCurrency);
        }
        runningBalanceOriginal += inflowNew - outflowNew;

        run(
          this.db,
          `
          UPDATE transactions 
          SET InflowNative = ?, 
              OutflowNative = ?,
              RunningBalanceNative = ?
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
        SET BalanceNative = ?
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

    // 2. Clear converted amounts for this account's transactions (will be
    // recalculated with new currency). Revaluation history references the old
    // native unit — drop it.
    this.queries.clearAccountConvertedAmounts(accountId);
    run(this.db, `DELETE FROM account_revaluations WHERE AccountID = ?`, accountId);

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
      SELECT ID as id, Date as date, InflowNative as inflow_original, OutflowNative as outflow_original, RunningBalanceNative as running_balance_original
      FROM transactions 
      WHERE AccountID = ?
      ORDER BY Date ASC, ID ASC
    `,
      accountId
    );

    let runningBalanceConverted = 0;

    for (const tx of transactions) {
      const rate = await this.getOrFetchRate(accountCurrency, budgetCurrency, tx.date, budgetId);

      if (rate) {
        const inflowConverted = convertScaled(
          tx.inflow_original,
          rate,
          accountCurrency,
          budgetCurrency
        );
        const outflowConverted = convertScaled(
          tx.outflow_original,
          rate,
          accountCurrency,
          budgetCurrency
        );
        runningBalanceConverted += inflowConverted - outflowConverted;

        // Only update ExchangeRate for non-overridden transactions
        run(
          this.db,
          `
          UPDATE transactions
          SET InflowConverted = ?,
              OutflowConverted = ?,
              RunningBalanceConverted = ?,
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
    this.transactionQueries.resyncSplitLinesForAccounts([accountId]);
  }
}
