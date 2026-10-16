/**
 * Budget display-currency change, split into two phases so it can never leave
 * a half-converted budget behind:
 *
 *  1. plan (async, no writes): work out every exchange rate the conversion
 *     needs and fetch the missing ones. Fails with ExchangeRateUnavailableError
 *     before anything is touched when one can't be found.
 *  2. apply (sync, one DB transaction): switch the currency, replace the rate
 *     cache, reconvert transactions, balances, assignments and goal targets.
 *
 * The plan's rates travel in the op args, so every device replaying the op
 * converts with the same numbers (and without network) instead of fetching its
 * own, possibly different, rates.
 */
import type { DatabaseAdapter } from '../../database/index.js';
import { allRows, getRow, run } from '../../database/sql.js';
import { convertScaled } from '../../currencies/index.js';
import { BudgetError } from '../../types/index.js';
import { getLocalDateString } from '../../utils/date.js';

/** One official rate as served by the rates endpoint (stored both ways). */
export interface OfficialRateQuote {
  from: string;
  to: string;
  date: string;
  rate: number;
}

export interface BudgetCurrencyChangePlan {
  fromCurrency: string;
  toCurrency: string;
  /** "Today" of the device that planned the change (future dates clamp to it). */
  asOf: string;
  rates: OfficialRateQuote[];
}

export interface RateLookup {
  from: string;
  to: string;
  date: string;
}

export class ExchangeRateUnavailableError extends BudgetError {
  constructor(public readonly missing: RateLookup[]) {
    const pairs = [...new Set(missing.map((m) => `${m.from}→${m.to}`))].join(', ');
    const dates = missing.map((m) => m.date).sort();
    const range = dates.length > 1 ? `${dates[0]} to ${dates[dates.length - 1]}` : (dates[0] ?? '');
    super(
      `Exchange rates are unavailable for ${pairs} (${missing.length} date${missing.length === 1 ? '' : 's'}, ${range}). Nothing was changed; check your connection and try again.`,
      'EXCHANGE_RATE_UNAVAILABLE'
    );
    this.name = 'ExchangeRateUnavailableError';
  }
}

export const RATE_FALLBACK_WINDOW_DAYS = 7;

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return getLocalDateString(new Date(y, m - 1, d + days));
}

/**
 * In-memory rate cache with the same lookup rules as CurrencyService's
 * findNearbyRate: exact date (direct, then reciprocal), else the nearest earlier
 * rate within the fallback window; future dates use `asOf`.
 */
export class RateBook {
  private readonly pairs = new Map<string, Map<string, number>>();

  constructor(private readonly asOf: string) {}

  add(quote: OfficialRateQuote): void {
    this.set(quote.from, quote.to, quote.date, quote.rate);
    this.set(quote.to, quote.from, quote.date, 1 / quote.rate);
  }

  effectiveDate(date: string): string {
    return date > this.asOf ? this.asOf : date;
  }

  lookup(from: string, to: string, date: string): number | null {
    if (from === to) return 1;
    const effective = this.effectiveDate(date);
    const exact = this.pairs.get(`${from}>${to}`)?.get(effective);
    if (exact) return exact;
    const exactReciprocal = this.pairs.get(`${to}>${from}`)?.get(effective);
    if (exactReciprocal) return 1 / exactReciprocal;
    const windowStart = addDays(effective, -RATE_FALLBACK_WINDOW_DAYS);
    const direct = this.latest(`${from}>${to}`, effective, windowStart);
    if (direct) return direct;
    const reciprocal = this.latest(`${to}>${from}`, effective, windowStart);
    if (reciprocal) return 1 / reciprocal;
    return null;
  }

  private set(from: string, to: string, date: string, rate: number): void {
    const key = `${from}>${to}`;
    let dates = this.pairs.get(key);
    if (!dates) {
      dates = new Map();
      this.pairs.set(key, dates);
    }
    dates.set(date, rate);
  }

  private latest(key: string, onOrBefore: string, notBefore: string): number | null {
    const dates = this.pairs.get(key);
    if (!dates) return null;
    let bestDate: string | null = null;
    for (const date of dates.keys()) {
      if (date <= onOrBefore && date >= notBefore && (bestDate === null || date > bestDate)) {
        bestDate = date;
      }
    }
    return bestDate === null ? null : (dates.get(bestDate) ?? null);
  }
}

function isValidRate(rate: unknown): rate is number {
  return typeof rate === 'number' && Number.isFinite(rate) && rate > 0;
}

/** Sanitize rates carried in op args (they come off the wire). */
export function parseCarriedRates(raw: unknown): OfficialRateQuote[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: OfficialRateQuote[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const { from, to, date, rate } = entry as Record<string, unknown>;
    if (
      typeof from === 'string' &&
      typeof to === 'string' &&
      typeof date === 'string' &&
      /^\d{4}-\d{2}-\d{2}$/.test(date) &&
      isValidRate(rate)
    ) {
      out.push({ from, to, date, rate });
    }
  }
  return out;
}

/** Account currency of every foreign-currency account, with its transaction dates. */
function foreignAccountDates(
  db: DatabaseAdapter,
  budgetId: number,
  toCurrency: string,
  accountIds?: Set<number>
): { accountId: number; currency: string; dates: string[] }[] {
  const accounts = allRows<{ ID: number; Currency: string }>(
    db,
    'SELECT ID, Currency FROM accounts WHERE BudgetID = ?',
    budgetId
  ).filter((a) => a.Currency !== toCurrency && (!accountIds || accountIds.has(a.ID)));
  return accounts.map((account) => ({
    accountId: account.ID,
    currency: account.Currency,
    dates: allRows<{ Date: string }>(
      db,
      'SELECT DISTINCT Date FROM transactions WHERE AccountID = ? ORDER BY Date ASC',
      account.ID
    ).map((r) => r.Date),
  }));
}

function assignmentMonths(db: DatabaseAdapter, budgetId: number): string[] {
  return allRows<{ Month: string }>(
    db,
    `SELECT DISTINCT a.Month AS Month
     FROM assignments a JOIN categories c ON c.ID = a.CategoryID
     WHERE c.BudgetID = ? ORDER BY a.Month ASC`,
    budgetId
  ).map((r) => r.Month);
}

function hasGoals(db: DatabaseAdapter, budgetId: number): boolean {
  return !!getRow(
    db,
    `SELECT 1 AS x FROM goals g JOIN categories c ON c.ID = g.CategoryID WHERE c.BudgetID = ? LIMIT 1`,
    budgetId
  );
}

/** Every rate a full conversion from `fromCurrency` to `toCurrency` needs. */
export function collectBudgetCurrencyLookups(
  db: DatabaseAdapter,
  budgetId: number,
  fromCurrency: string,
  toCurrency: string,
  asOf: string,
  scope: { accountIds?: Set<number>; budgetAmounts: boolean } = { budgetAmounts: true }
): RateLookup[] {
  const lookups: RateLookup[] = [];
  for (const account of foreignAccountDates(db, budgetId, toCurrency, scope.accountIds)) {
    for (const date of account.dates) {
      lookups.push({ from: account.currency, to: toCurrency, date });
    }
  }
  if (scope.budgetAmounts && fromCurrency !== toCurrency) {
    for (const month of assignmentMonths(db, budgetId)) {
      lookups.push({ from: fromCurrency, to: toCurrency, date: `${month}-15` });
    }
    if (hasGoals(db, budgetId)) lookups.push({ from: fromCurrency, to: toCurrency, date: asOf });
  }
  return lookups;
}

export interface RateSource {
  /** Network fetch of official quotes (base → each symbol) for a date. */
  fetchQuotes(
    symbols: string[],
    base: string,
    date: string
  ): Promise<{ date: string; quotes: Record<string, number> }>;
  /** Read-only lookup in the budget's existing rate cache (fallback when offline). */
  cachedRate(from: string, to: string, date: string): number | null;
}

/**
 * Resolve every lookup into `book`, fetching what is missing (dates ascending
 * per pair, so one fetch also serves the following week like the old pass did).
 * Returns the quotes that were added and the lookups still unresolved.
 */
export async function resolveLookups(
  lookups: RateLookup[],
  book: RateBook,
  source: RateSource,
  options: { prefetchToday?: { base: string; symbols: string[]; asOf: string } } = {}
): Promise<{ added: OfficialRateQuote[]; missing: RateLookup[] }> {
  const added: OfficialRateQuote[] = [];
  const addQuote = (quote: OfficialRateQuote) => {
    book.add(quote);
    added.push(quote);
  };
  let networkDown = false;
  const fetchInto = async (symbols: string[], base: string, date: string) => {
    if (networkDown || symbols.length === 0) return;
    try {
      const response = await source.fetchQuotes(symbols, base, date);
      for (const symbol of symbols) {
        const rate = response.quotes[`${base}${symbol}`];
        if (isValidRate(rate)) addQuote({ from: base, to: symbol, date: response.date, rate });
      }
    } catch {
      // Offline or the provider failed: fall back to cached rates below.
      networkDown = true;
    }
  };

  if (options.prefetchToday) {
    const { base, symbols, asOf } = options.prefetchToday;
    await fetchInto(
      symbols.filter((s) => s !== base),
      base,
      asOf
    );
  }

  const sorted = [...lookups].sort(
    (a, b) =>
      a.from.localeCompare(b.from) || a.to.localeCompare(b.to) || a.date.localeCompare(b.date)
  );
  const missing: RateLookup[] = [];
  for (const lookup of sorted) {
    if (book.lookup(lookup.from, lookup.to, lookup.date)) continue;
    await fetchInto([lookup.to], lookup.from, book.effectiveDate(lookup.date));
    if (book.lookup(lookup.from, lookup.to, lookup.date)) continue;
    const effective = book.effectiveDate(lookup.date);
    const cached = source.cachedRate(lookup.from, lookup.to, effective);
    if (cached) {
      addQuote({ from: lookup.from, to: lookup.to, date: effective, rate: cached });
      continue;
    }
    missing.push(lookup);
  }
  return { added, missing };
}

/**
 * Recompute one foreign-currency account's converted amounts, running
 * balances and converted balance from its native amounts. Every rate must be
 * in `book` (the caller checked).
 */
function reconvertAccount(
  db: DatabaseAdapter,
  accountId: number,
  accountCurrency: string,
  budgetCurrency: string,
  book: RateBook
): void {
  const transactions = allRows<{
    ID: number;
    Date: string;
    InflowNative: number;
    OutflowNative: number;
  }>(
    db,
    `SELECT ID, Date, InflowNative, OutflowNative FROM transactions
     WHERE AccountID = ? ORDER BY Date ASC, ID ASC`,
    accountId
  );
  let runningBalanceConverted = 0;
  for (const tx of transactions) {
    const rate = book.lookup(accountCurrency, budgetCurrency, tx.Date);
    if (!rate)
      throw new ExchangeRateUnavailableError([
        { from: accountCurrency, to: budgetCurrency, date: tx.Date },
      ]);
    const inflowConverted = convertScaled(tx.InflowNative, rate, accountCurrency, budgetCurrency);
    const outflowConverted = convertScaled(tx.OutflowNative, rate, accountCurrency, budgetCurrency);
    runningBalanceConverted += inflowConverted - outflowConverted;
    run(
      db,
      `UPDATE transactions
       SET InflowConverted = ?,
           OutflowConverted = ?,
           RunningBalanceConverted = ?,
           ExchangeRate = CASE WHEN ExchangeRateOverride = 0 THEN ? ELSE ExchangeRate END
       WHERE ID = ?`,
      inflowConverted,
      outflowConverted,
      runningBalanceConverted,
      rate,
      tx.ID
    );
  }
  run(
    db,
    'UPDATE accounts SET BalanceConverted = ? WHERE ID = ?',
    runningBalanceConverted,
    accountId
  );
}

export interface ApplyBudgetCurrencyChangeDeps {
  /** Replace the budget's official rate cache with these quotes (both ways). */
  replaceRateCache(quotes: OfficialRateQuote[]): void;
  clearConvertedAmounts(): void;
  setDisplayCurrency(currency: string): void;
}

/**
 * Apply a full currency change. Synchronous and meant to run inside ONE
 * db.transaction: any missing rate throws and rolls everything back.
 */
export function applyBudgetCurrencyChange(
  db: DatabaseAdapter,
  budgetId: number,
  plan: BudgetCurrencyChangePlan,
  book: RateBook,
  deps: ApplyBudgetCurrencyChangeDeps
): void {
  const { fromCurrency, toCurrency, asOf } = plan;
  const missing = collectBudgetCurrencyLookups(db, budgetId, fromCurrency, toCurrency, asOf).filter(
    (l) => !book.lookup(l.from, l.to, l.date)
  );
  if (missing.length > 0) throw new ExchangeRateUnavailableError(missing);

  deps.setDisplayCurrency(toCurrency);
  deps.replaceRateCache(plan.rates);

  // Converted amounts restart from native; old revaluation deltas are in the
  // old currency, drop them.
  deps.clearConvertedAmounts();
  run(db, `DELETE FROM account_revaluations WHERE BudgetID = ?`, budgetId);

  for (const account of foreignAccountDates(db, budgetId, toCurrency)) {
    reconvertAccount(db, account.accountId, account.currency, toCurrency, book);
  }

  // Assignments are monthly buckets; anchor the conversion mid-month.
  const assignments = allRows<{ CategoryID: number; Amount: number; Month: string }>(
    db,
    `SELECT a.CategoryID, a.Amount, a.Month
     FROM assignments a JOIN categories c ON c.ID = a.CategoryID
     WHERE c.BudgetID = ?`,
    budgetId
  );
  for (const row of assignments) {
    const rate = book.lookup(fromCurrency, toCurrency, `${row.Month}-15`) as number;
    run(
      db,
      `UPDATE assignments SET Amount = ? WHERE CategoryID = ? AND Month = ?`,
      convertScaled(row.Amount, rate, fromCurrency, toCurrency),
      row.CategoryID,
      row.Month
    );
  }

  // Goal targets use the planning day's rate (one consistent baseline).
  const goals = allRows<{ ID: number; Target: number }>(
    db,
    `SELECT g.ID, g.Target FROM goals g JOIN categories c ON c.ID = g.CategoryID
     WHERE c.BudgetID = ?`,
    budgetId
  );
  if (goals.length > 0) {
    const rate = book.lookup(fromCurrency, toCurrency, asOf) as number;
    for (const goal of goals) {
      run(
        db,
        `UPDATE goals SET Target = ? WHERE ID = ?`,
        convertScaled(goal.Target, rate, fromCurrency, toCurrency),
        goal.ID
      );
    }
  }
}

/**
 * Replay of a change whose currency switch is already in this DB (a snapshot
 * taken while the change ran on an older client). Transaction conversions are
 * a pure function of native amounts and rates, so recomputing them is safe and
 * repairs any rows the interrupted run left unconverted. Assignments and goal
 * targets are converted in place and are left alone: converting them again
 * would apply the rate twice. Accounts whose rates can't be found are skipped.
 */
export function repairBudgetCurrencyConversions(
  db: DatabaseAdapter,
  budgetId: number,
  toCurrency: string,
  book: RateBook
): number {
  let repaired = 0;
  for (const account of foreignAccountDates(db, budgetId, toCurrency)) {
    if (account.dates.some((date) => !book.lookup(account.currency, toCurrency, date))) continue;
    reconvertAccount(db, account.accountId, account.currency, toCurrency, book);
    repaired++;
  }
  return repaired;
}
