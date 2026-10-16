import { afterEach, describe, expect, it, vi } from 'vitest';
import { NodeSqlJsAdapter, ServiceManager, asMilli, GoalType, type DatabaseAdapter } from '../src';

/** Deterministic official rate for base→symbol on a date (varies by day). */
function officialRate(base: string, symbol: string, date: string): number {
  const toUsd: Record<string, number> = { USD: 1, EUR: 1.1, GBP: 1.3 };
  const day = Number(date.slice(8, 10));
  return Number(((toUsd[base] / toUsd[symbol]) * (1 + day / 1000)).toFixed(6));
}

/** fetch stub for /api/v1/exchange-rates; `fail(date)` makes that request fail. */
function stubRates(fail: (base: string, date: string) => boolean = () => false) {
  const fetchMock = vi.fn(async (url: string) => {
    const params = new URL(url, 'http://local').searchParams;
    const base = params.get('base')!;
    const date = params.get('date')!;
    if (fail(base, date))
      return { ok: false, status: 503, statusText: 'down', json: async () => ({}) };
    const quotes: Record<string, number> = {};
    for (const symbol of params.get('symbols')!.split(',').filter(Boolean)) {
      quotes[`${base}${symbol}`] = officialRate(base, symbol, date);
    }
    return { ok: true, json: async () => ({ date, quotes }) };
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function open(bytes?: Uint8Array) {
  const adapter = await NodeSqlJsAdapter.create(bytes);
  const manager = new ServiceManager();
  await manager.initialize(adapter as DatabaseAdapter);
  return { adapter, services: manager.getServices() };
}

async function seed() {
  const { adapter, services } = await open();
  const budgetId = await services.budgets.createBudget({
    name: 'Currency change',
    display_currency: 'USD',
    badge_icon: 'dollar',
    number_format: '123,456.78',
    create_default_categories: false,
  });
  const group = services.categories.addCategoryGroup('Bills', budgetId);
  const categoryId = services.categories.addCategory(group, budgetId, 'Rent');
  const eur = await services.accounts.createAccount(
    'Euro',
    budgetId,
    'checking',
    'EUR',
    asMilli(0)
  );
  const usd = await services.accounts.createAccount(
    'Dollar',
    budgetId,
    'checking',
    'USD',
    asMilli(0)
  );
  // Rates for the EUR account's own transactions in the old (USD) currency.
  stubRates();
  for (const [date, outflow] of [
    ['2026-01-10', 10_000],
    ['2026-02-20', 25_550],
    ['2026-03-05', 7_001],
  ] as const) {
    await services.transactions.addTransaction(
      asMilli(0),
      asMilli(outflow),
      eur.ID,
      categoryId,
      budgetId,
      date,
      'eur'
    );
    await services.transactions.addTransaction(
      asMilli(outflow),
      asMilli(0),
      usd.ID,
      categoryId,
      budgetId,
      date,
      'usd'
    );
  }
  services.monthlyBudgets.upsertMonthlyAssignment(categoryId, asMilli(50_000), '2026-01', budgetId);
  services.monthlyBudgets.upsertMonthlyAssignment(categoryId, asMilli(60_000), '2026-02', budgetId);
  services.goals.createGoal(GoalType.MONTHLY, categoryId, asMilli(100_000), '2026-01-01', '');
  vi.unstubAllGlobals();
  return { adapter, services, budgetId, eurId: eur.ID, usdId: usd.ID };
}

/** Every row the change touches, for whole-DB comparisons. */
function state(adapter: DatabaseAdapter) {
  const q = (sql: string) => {
    const stmt = adapter.prepare(sql);
    const rows = stmt.all();
    stmt.finalize();
    return rows;
  };
  return {
    budgets: q('SELECT ID, DisplayCurrency FROM budgets ORDER BY ID'),
    transactions: q(
      `SELECT ID, AccountID, InflowNative, OutflowNative, InflowConverted, OutflowConverted,
              RunningBalanceConverted, ExchangeRate FROM transactions ORDER BY ID`
    ),
    accounts: q('SELECT ID, BalanceNative, BalanceConverted FROM accounts ORDER BY ID'),
    assignments: q('SELECT CategoryID, Month, Amount FROM assignments ORDER BY CategoryID, Month'),
    goals: q('SELECT ID, Target FROM goals ORDER BY ID'),
    revaluations: q('SELECT * FROM account_revaluations ORDER BY ID'),
  };
}

function rates(adapter: DatabaseAdapter) {
  const stmt = adapter.prepare(
    'SELECT FromCurrency, ToCurrency, RateDate, Rate FROM currency_rates ORDER BY 1, 2, 3'
  );
  const rows = stmt.all();
  stmt.finalize();
  return rows;
}

afterEach(() => vi.unstubAllGlobals());

describe('budget display-currency change', () => {
  it('changes nothing when a needed rate is unavailable, and says which', async () => {
    const { adapter, services, budgetId } = await seed();
    const before = state(adapter);
    const ratesBefore = rates(adapter);
    // The provider is down for February only.
    stubRates((_base, date) => date.startsWith('2026-02'));

    await expect(services.budgets.updateBudgetCurrency(budgetId, 'GBP')).rejects.toMatchObject({
      name: 'ExchangeRateUnavailableError',
      message: expect.stringContaining('EUR→GBP'),
    });
    expect(state(adapter)).toEqual(before);
    expect(rates(adapter)).toEqual(ratesBefore);
  });

  it('converts transactions, balances, assignments and goals in one go', async () => {
    const { adapter, services, budgetId, eurId } = await seed();
    stubRates();
    await services.budgets.updateBudgetCurrency(budgetId, 'GBP');
    const after = state(adapter);
    expect(after.budgets).toEqual([{ ID: budgetId, DisplayCurrency: 'GBP' }]);
    const eurRows = after.transactions.filter((t) => t.AccountID === eurId) as {
      OutflowNative: number;
      OutflowConverted: number;
      ExchangeRate: number;
    }[];
    expect(eurRows.map((t) => t.ExchangeRate)).toEqual([
      officialRate('EUR', 'GBP', '2026-01-10'),
      officialRate('EUR', 'GBP', '2026-02-20'),
      officialRate('EUR', 'GBP', '2026-03-05'),
    ]);
    expect(eurRows.map((t) => t.OutflowConverted)).toEqual(
      eurRows.map((t) => Math.round(t.OutflowNative * t.ExchangeRate))
    );
    // Mid-month anchors; like the cache, a rate fetched up to a week earlier
    // (the USD account's 2026-01-10 row) serves 2026-01-15.
    expect((after.assignments as { Amount: number }[]).map((a) => a.Amount)).toEqual([
      Math.round(50_000 * officialRate('USD', 'GBP', '2026-01-10')),
      Math.round(60_000 * officialRate('USD', 'GBP', '2026-02-15')),
    ]);
  });

  it('prepares the change without writing, and replays it identically on another device offline', async () => {
    const { adapter, services, budgetId } = await seed();
    const snapshot = adapter.backup() as Uint8Array;
    const before = state(adapter);

    stubRates();
    const change = await services.budgets.prepareBudgetCurrencyChange(budgetId, 'GBP');
    expect(change?.fromCurrency).toBe('USD');
    expect(state(adapter)).toEqual(before);
    // The op args are JSON on the wire.
    const args = JSON.parse(JSON.stringify(change));
    await services.budgets.updateBudgetCurrency(budgetId, 'GBP', args);

    // Device B starts from the pre-change state and has no network at all.
    const deviceB = await open(snapshot);
    const fetchMock = stubRates(() => true);
    await deviceB.services.budgets.updateBudgetCurrency(budgetId, 'GBP', {
      ...args,
      replay: true,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(state(deviceB.adapter)).toEqual(state(adapter));
  });

  it('repairs a replay onto a snapshot taken mid-change instead of skipping it', async () => {
    const { adapter, services, budgetId } = await seed();
    const snapshot = adapter.backup() as Uint8Array;
    stubRates();
    const args = JSON.parse(
      JSON.stringify(await services.budgets.prepareBudgetCurrencyChange(budgetId, 'GBP'))
    );
    await services.budgets.updateBudgetCurrency(budgetId, 'GBP', args);
    const done = state(adapter);

    // What an older client could upload half way: currency switched and
    // converted amounts cleared, conversions not yet redone.
    const half = await open(snapshot);
    half.adapter.exec(`UPDATE budgets SET DisplayCurrency = 'GBP' WHERE ID = ${budgetId}`);
    half.adapter.exec(
      `UPDATE transactions SET InflowConverted = InflowNative, OutflowConverted = OutflowNative,
       RunningBalanceConverted = RunningBalanceNative WHERE BudgetID = ${budgetId}`
    );
    half.adapter.exec(`UPDATE accounts SET BalanceConverted = NULL WHERE BudgetID = ${budgetId}`);
    stubRates(() => true);
    await half.services.budgets.updateBudgetCurrency(budgetId, 'GBP', { ...args, replay: true });

    const repaired = state(half.adapter);
    expect(repaired.transactions).toEqual(done.transactions);
    const foreign = (rows: unknown[]) =>
      (rows as { ID: number; BalanceConverted: number | null }[]).filter(
        (r) => r.BalanceConverted !== null
      );
    expect(foreign(repaired.accounts)).toEqual(foreign(done.accounts));
  });

  it('keeps the same-currency update a no-op for a local edit', async () => {
    const { adapter, services, budgetId } = await seed();
    const fetchMock = stubRates();
    const before = state(adapter);
    await services.budgets.updateBudgetCurrency(budgetId, 'USD');
    expect(state(adapter)).toEqual(before);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
