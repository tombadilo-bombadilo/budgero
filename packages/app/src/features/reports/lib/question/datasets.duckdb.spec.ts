/**
 * The Balances, Budget (available + goals), Scheduled / Upcoming and Payees
 * sources against a real core database: core's services write the data, the
 * SQLite tables are copied into DuckDB the way the reporting engine does, the
 * derived tables are built by the same builders, and the question results
 * are compared with what the services (the app's screens) report.
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type * as DuckDbBlocking from '@duckdb/duckdb-wasm/blocking';
// The integration test needs the Node database adapter; production uses the browser entry.
// eslint-disable-next-line no-restricted-imports
import {
  GoalPurpose,
  GoalType,
  NodeSqlJsAdapter,
  ServiceManager,
  asMilli,
  setClock,
  type Services,
} from '@budgero/core';
import { REPORTING_VIEWS_SQL, mapSQLiteTypeToDuckDb } from '@shared/lib/sql/analytics-views';
import {
  DERIVED_TABLES,
  frequencyCode,
  monthlyEquivalent,
  type DerivedSqlDatabase,
} from '@shared/lib/sql/report-derived-tables';
import { compileQuestion, usesBudgetScreenFields } from './compile';
import { applyDashboardFilters } from './dashboard-filters';
import { applyDrill, drillOptions, rowDrillValues } from './drill';
import { buildSavedQuestionQuery, parseQuestionHeader } from './header';
import { createQuestion, normalizeQuestion, questionColumns, type QuestionSpec } from './spec';

const require = createRequire(import.meta.url);
const duckdb =
  require('@duckdb/duckdb-wasm/dist/duckdb-node-blocking.cjs') as typeof DuckDbBlocking;

const distDir = path.dirname(require.resolve('@duckdb/duckdb-wasm/dist/duckdb-node-blocking.cjs'));

const TODAY = '2026-11-10';

let duck: DuckDbBlocking.DuckDBBindings;
let conn: DuckDbBlocking.DuckDBConnection;
let sqlite: Awaited<ReturnType<typeof NodeSqlJsAdapter.create>>;
let services: Services;
let budgetId: number;
const ids: Record<string, number> = {};

const m = (units: number) => asMilli(Math.round(units * 1000));

async function newDuckDb() {
  const instance = await duckdb.createDuckDB(
    {
      mvp: { mainModule: path.join(distDir, 'duckdb-mvp.wasm'), mainWorker: '' },
      eh: { mainModule: path.join(distDir, 'duckdb-eh.wasm'), mainWorker: '' },
    },
    new duckdb.VoidLogger(),
    duckdb.NODE_RUNTIME
  );
  await instance.instantiate(() => undefined);
  return instance;
}

/** SQL literal of a JSON value, cast to the column type. */
function literal(value: unknown, type: string): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (typeof value === 'number')
    return `CAST(${JSON.stringify(String(value)).replace(/"/g, "'")} AS ${type})`;
  return `CAST('${String(value).replace(/'/g, "''")}' AS ${type})`;
}

function insertJson(table: string, columns: { name: string; type: string }[], rows: unknown[]) {
  for (let start = 0; start < rows.length; start += 500) {
    const values = rows
      .slice(start, start + 500)
      .map(
        (row) =>
          `(${columns
            .map((c) => literal((row as Record<string, unknown>)[c.name], c.type))
            .join(', ')})`
      );
    conn.query(`INSERT INTO "${table}" VALUES ${values.join(', ')}`);
  }
}

/** The engine's snapshot: every SQLite table, the views, then the derived tables. */
function snapshot() {
  for (const row of conn
    .query(
      `SELECT table_name, table_type FROM information_schema.tables WHERE table_schema = 'main'`
    )
    .toArray()) {
    const { table_name: name, table_type: type } = row.toJSON() as Record<string, string>;
    conn.query(`DROP ${type === 'VIEW' ? 'VIEW' : 'TABLE'} IF EXISTS "${name}"`);
  }
  const tables = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all() as { name: string }[];
  for (const { name } of tables) {
    const columns = (
      sqlite.prepare(`PRAGMA table_info("${name}")`).all() as {
        name: string;
        type: string;
      }[]
    )
      .filter((column) => !column.type.toUpperCase().includes('BLOB'))
      .map((column) => ({ name: column.name, type: mapSQLiteTypeToDuckDb(column.type) }));
    conn.query(
      `CREATE TABLE "${name}" (${columns.map((c) => `"${c.name}" ${c.type}`).join(', ')})`
    );
    const rows = (sqlite.prepare(`SELECT * FROM "${name}"`).all() as Record<string, unknown>[]).map(
      (row) => Object.fromEntries(columns.map((c) => [c.name, row[c.name]]))
    );
    insertJson(name, columns, rows);
  }
  // The node DuckDB build has no clock: pin the views' CURRENT_DATE.
  for (const sql of REPORTING_VIEWS_SQL)
    conn.query(sql.replaceAll('CURRENT_DATE', `DATE '${TODAY}'`));
  for (const table of DERIVED_TABLES) {
    conn.query(
      `CREATE TABLE "${table.name}" (${table.columns.map((c) => `"${c.name}" ${c.type}`).join(', ')})`
    );
    const rows = table.build({
      services,
      db: sqlite as unknown as DerivedSqlDatabase,
      today: TODAY,
    });
    insertJson(table.name, [...table.columns], rows);
  }
}

function rows(sql: string): Record<string, unknown>[] {
  return conn
    .query(sql)
    .toArray()
    .map((row) =>
      Object.fromEntries(
        Object.entries(row.toJSON() as Record<string, unknown>)
          .filter(([key]) => !key.endsWith('__key'))
          .map(([key, value]) => [key, typeof value === 'bigint' ? Number(value) : value])
      )
    );
}

function runSpec(spec: QuestionSpec) {
  const { sql } = compileQuestion(spec, { budgetId, today: TODAY });
  const saved = buildSavedQuestionQuery(spec, sql);
  expect(parseQuestionHeader(saved)).toEqual(spec);
  return conn.query(sql);
}

function query(spec: Partial<QuestionSpec>): Record<string, unknown>[] {
  const full = normalizeQuestion({ source: 'transactions', ...spec });
  const { sql } = compileQuestion(full, { budgetId, today: TODAY });
  return rows(sql);
}

/** Today's balance per account as the Accounts page shows it (stored balance minus future rows). */
function accountsPageBalances(): Map<number, number> {
  const future = new Map(
    services.transactions
      .getFutureBalanceAdjustments(budgetId, TODAY)
      .map((row) => [row.AccountID, row.Converted ?? 0])
  );
  return new Map(
    services.accounts
      .listAccounts(budgetId)
      .map((account) => [
        account.ID,
        ((account.BalanceConverted ?? account.BalanceNative ?? 0) - (future.get(account.ID) ?? 0)) /
          1000,
      ])
  );
}

beforeAll(async () => {
  duck = await newDuckDb();
  conn = duck.connect();
  conn.query('SET old_implicit_casting = true');
  setClock(new Date(2026, 10, 10, 12, 0, 0));
  globalThis.fetch = (async () => {
    throw new Error('offline (test)');
  }) as typeof fetch;
  const cwd = vi.spyOn(process, 'cwd').mockReturnValue(path.resolve(process.cwd(), '../core'));
  const manager = new ServiceManager();
  try {
    sqlite = await NodeSqlJsAdapter.create();
    await manager.initialize(sqlite);
  } finally {
    cwd.mockRestore();
  }
  services = manager.getServices();
  budgetId = await services.budgets.createBudget({
    name: 'Datasets',
    display_currency: 'USD',
    badge_icon: 'dollar',
    number_format: '123,456.78',
    create_default_categories: false,
  });
  const c = services.categories;
  const living = c.addCategoryGroup('Living', budgetId);
  ids.groceries = c.addCategory(living, budgetId, 'Groceries');
  ids.rent = c.addCategory(living, budgetId, 'Rent');
  ids.fun = c.addCategory(living, budgetId, 'Fun');
  ids.vacation = c.addCategory(living, budgetId, 'Vacation');
  ids.income = c.getCategoryByName('Income', budgetId)!.ID;
  ids.transfers = c.getCategoryByName('Transfers', budgetId)!.ID;

  const a = services.accounts;
  ids.checking = (await a.createAccount('Checking', budgetId, 'Checking', 'USD', m(0))).ID;
  ids.savings = (await a.createAccount('Savings', budgetId, 'Savings', 'USD', m(0))).ID;
  ids.card = (await a.createAccount('Visa', budgetId, 'Credit', 'USD', m(0))).ID;
  ids.euro = (
    await a.createAccount('Euro savings', budgetId, 'Savings', 'EUR', m(0), undefined, false)
  ).ID;

  const t = services.transactions;
  const add = (
    account: number,
    category: number,
    date: string,
    amount: number,
    payee: string,
    extra: { transferId?: string; rate?: number } = {}
  ) =>
    t.addTransaction(
      m(amount > 0 ? amount : 0),
      m(amount < 0 ? -amount : 0),
      account,
      category,
      budgetId,
      date,
      '',
      extra.transferId ?? '',
      payee,
      null,
      extra.rate ?? null
    );
  // August: salary, rent, groceries. September: nothing at all (carry forward).
  await add(ids.checking, ids.income, '2026-08-01', 3000, 'Employer');
  await add(ids.checking, ids.rent, '2026-08-03', -1200, 'Landlord');
  await add(ids.checking, ids.groceries, '2026-08-10', -80, 'Lidl');
  await add(ids.card, ids.groceries, '2026-08-20', -40, 'lidl ');
  // October: groceries overspent (assigned 100, spent 150), a transfer, card payment.
  await add(ids.checking, ids.groceries, '2026-10-05', -150, 'Lidl');
  await add(ids.checking, ids.transfers, '2026-10-06', -500, 'Transfer : Savings', {
    transferId: 'tr-1',
  });
  await add(ids.savings, ids.transfers, '2026-10-06', 500, 'Transfer : Checking', {
    transferId: 'tr-1',
  });
  await add(ids.checking, ids.fun, '2026-10-12', -30, 'Cinema');
  // Foreign currency: €1000 at 1.10, €200 out at 1.20.
  await add(ids.euro, ids.transfers, '2026-08-15', 1000, 'Opening', { rate: 1.1 });
  await add(ids.euro, ids.transfers, '2026-10-20', -200, 'Fee', { rate: 1.2 });
  // November and a future-dated row (not in today's balances).
  await add(ids.checking, ids.groceries, '2026-11-02', -25, 'Lidl');
  await add(ids.checking, ids.fun, '2026-12-15', -999, 'Future');

  // Revaluation journal: +€-account true-up of $40 on 2026-10-25 (as revalueAccounts writes it).
  sqlite.exec(
    `INSERT INTO account_revaluations (BudgetID, AccountID, Date, OldRate, NewRate, BalanceNative, DeltaConverted)
     VALUES (${budgetId}, ${ids.euro}, '2026-10-25', 1.1, 1.15, 800000, 40000)`
  );
  sqlite.exec(
    `UPDATE accounts SET BalanceConverted = BalanceConverted + 40000 WHERE ID = ${ids.euro}`
  );

  const mb = services.monthlyBudgets;
  mb.upsertMonthlyAssignment(ids.rent, m(1200), '2026-08', budgetId);
  mb.upsertMonthlyAssignment(ids.groceries, m(150), '2026-08', budgetId);
  mb.upsertMonthlyAssignment(ids.groceries, m(100), '2026-10', budgetId);
  mb.upsertMonthlyAssignment(ids.fun, m(50), '2026-10', budgetId);
  mb.upsertMonthlyAssignment(ids.vacation, m(200), '2026-09', budgetId);

  services.goals.createGoal(GoalType.MONTHLY, ids.groceries, m(120), '2026-01-01', '');
  services.goals.createGoal(
    GoalType.TARGET_BALANCE,
    ids.vacation,
    m(1000),
    '2026-01-01',
    '',
    GoalPurpose.SAVINGS
  );

  const r = services.recurring;
  const template = async (
    name: string,
    amount: number,
    unit: 'day' | 'week' | 'month' | 'year',
    count: number,
    extra: Partial<Parameters<typeof r.createRecurringTransaction>[0]> = {}
  ) =>
    (
      await r.createRecurringTransaction({
        budgetId,
        accountId: ids.checking,
        categoryId: ids.fun,
        name,
        amount: m(Math.abs(amount)),
        direction: amount < 0 ? 'outflow' : 'inflow',
        schedule: { startDate: '2026-11-15', intervalUnit: unit, intervalCount: count },
        ...extra,
      })
    ).id;
  ids.netflix = await template('Netflix', -12, 'month', 1);
  ids.gym = await template('Gym', -10, 'week', 2);
  ids.coffee = await template('Coffee', -3, 'day', 1);
  ids.insurance = await template('Insurance', -600, 'year', 1);
  ids.salary = await template('Salary', 3000, 'month', 1, { categoryId: ids.income });
  ids.paused = await template('Old magazine', -5, 'month', 1, { active: false });
  ids.save = await template('Save', -100, 'month', 1, {
    toAccountId: ids.savings,
    categoryId: null,
  });

  snapshot();
}, 60_000);

afterAll(() => {
  conn?.close();
  setClock(null);
});

// ---------------------------------------------------------------------------
// Balances over time
// ---------------------------------------------------------------------------

describe('Balances source', () => {
  it("today's balances equal the Accounts page, revaluations and foreign currency included", () => {
    const page = accountsPageBalances();
    const asOf = query({ source: 'balances', columns: ['account', 'balance', 'balance_native'] });
    expect(asOf).toHaveLength(page.size);
    const byName = new Map(asOf.map((row) => [row.account, row]));
    // 3000 − 1200 − 80 − 150 − 500 (transfer) − 30 − 25; the December row is future
    expect(byName.get('Checking')).toEqual({
      account: 'Checking',
      balance: 1015,
      balance_native: 1015,
    });
    expect(byName.get('Euro savings')).toEqual({
      account: 'Euro savings',
      // 1100 − 240 + 40 revaluation (USD); 800 EUR native
      balance: 900,
      balance_native: 800,
    });
    const ids = new Map(
      services.accounts.listAccounts(budgetId).map((account) => [account.Name, account.ID])
    );
    for (const row of asOf) {
      expect(row.balance).toBe(page.get(Number(ids.get(String(row.account)))));
    }
    // The view says the same for today.
    const view = rows(
      `SELECT account_name, CAST(balance AS DOUBLE) AS balance FROM account_balances_daily
       WHERE budget_id = ${budgetId} AND date = '${TODAY}' ORDER BY account_name`
    );
    expect(view.map((row) => [row.account_name, Number(row.balance)])).toEqual(
      [...byName.values()]
        .map((row) => [row.account, row.balance])
        .sort((x, y) => String(x[0]).localeCompare(String(y[0])))
    );
  });

  it('net worth by month carries balances through months without transactions', () => {
    expect(query(createQuestion('balances'))).toEqual([
      // Aug: 3000 − 1200 − 80 = 1720 checking, −40 card, 1100 euro
      { month: '2026-08', sum_balance: 2780 },
      // Sep: no transactions, carried
      { month: '2026-09', sum_balance: 2780 },
      // Oct: −150 −30 groceries/fun, transfer nets 0, euro −240, revaluation +40
      { month: '2026-10', sum_balance: 2400 },
      // Nov (as of today): −25; the December row is in the future
      { month: '2026-11', sum_balance: 2375 },
    ]);
  });

  it('assets and debts split by account type; change per period', () => {
    expect(
      query({
        source: 'balances',
        aggregations: [
          { op: 'sum', field: 'assets' },
          { op: 'sum', field: 'debts' },
          { op: 'sum', field: 'change' },
        ],
        breakouts: [{ field: 'date', bucket: 'month' }],
      })
    ).toEqual([
      { month: '2026-08', sum_assets: 2820, sum_debts: 40, sum_change: 2780 },
      { month: '2026-09', sum_assets: 2820, sum_debts: 40, sum_change: 0 },
      { month: '2026-10', sum_assets: 2440, sum_debts: 40, sum_change: -380 },
      { month: '2026-11', sum_assets: 2415, sum_debts: 40, sum_change: -25 },
    ]);
  });

  it('daily rows exist for every day; as-of a past date with the change over the range', () => {
    const daily = query({
      source: 'balances',
      filters: [{ field: 'account', op: 'is', values: [ids.checking] }],
      aggregations: [{ op: 'sum', field: 'balance' }],
      breakouts: [{ field: 'date', bucket: 'day' }],
    });
    // 2026-08-01 … 2026-11-10
    expect(daily).toHaveLength(102);
    expect(daily.find((row) => row.day === '2026-09-15')).toEqual({
      day: '2026-09-15',
      sum_balance: 1720,
    });
    expect(
      query({
        source: 'balances',
        filters: [
          { field: 'account', op: 'is', values: [ids.checking] },
          { field: 'date', op: 'between', values: ['2026-09-01', '2026-10-31'] },
        ],
        columns: ['account', 'date', 'balance', 'change'],
      })
    ).toEqual([{ account: 'Checking', date: '2026-10-31', balance: 1040, change: -680 }]);
  });

  it('a dashboard date range applies; Budget-only filters are ignored', () => {
    const applied = applyDashboardFilters(createQuestion('balances'), {
      date: { preset: 'custom', from: '2026-10-01', to: '2026-11-30' },
      accounts: [ids.checking],
      categoryGroups: [1],
    });
    expect(applied.applied).toEqual(['date', 'accounts']);
    expect(applied.ignored).toEqual(['categoryGroups']);
    expect(query(applied.spec)).toEqual([
      { month: '2026-10', sum_balance: 1040 },
      { month: '2026-11', sum_balance: 1015 },
    ]);
  });

  it("drills to the account's transactions in the period", () => {
    const spec = normalizeQuestion({
      source: 'balances',
      aggregations: [{ op: 'sum', field: 'change' }],
      breakouts: [{ field: 'date', bucket: 'month' }, { field: 'account' }],
    });
    const result = runSpec(spec);
    const resultColumns = result.schema.fields.map((field) => field.name);
    const resultRows = result.toArray().map((row) => resultColumns.map((name) => row[name]));
    const row = resultRows.find(
      (cells) =>
        cells[resultColumns.indexOf('month')] === '2026-10' &&
        cells[resultColumns.indexOf('account')] === 'Checking'
    )!;
    const context = { spec, values: rowDrillValues(questionColumns(spec), resultColumns, row) };
    expect(drillOptions(context).transactions).toBe(true);
    const drilled = applyDrill(context, { kind: 'transactions' });
    expect(drilled.source).toBe('transactions');
    const lines = query({ ...drilled, aggregations: [{ op: 'net' }] });
    // −150 groceries, −500 transfer, −30 fun = the period's change
    expect(lines).toEqual([{ net: -680 }]);
  });
});

// ---------------------------------------------------------------------------
// Budget: available and goals
// ---------------------------------------------------------------------------

describe('Budget source: available and goals', () => {
  const budgetRows = () =>
    query({
      source: 'budget',
      columns: ['month', 'category', 'assigned', 'activity', 'available'],
      sort: [
        { column: 'month', direction: 'asc' },
        { column: 'category', direction: 'asc' },
      ],
    });

  for (const mode of ['cumulative', 'monthly'] as const) {
    it(`available equals the budget screen in ${mode} mode (overspending, rollover)`, () => {
      sqlite.exec(`UPDATE budgets SET RtaMode = '${mode}' WHERE ID = ${budgetId}`);
      snapshot();
      const result = budgetRows();
      for (const month of ['2026-08', '2026-09', '2026-10', '2026-11']) {
        const screen = services.monthlyBudgets
          .getMonthlyBudget(month, budgetId)
          .filter((row) => !['Income', 'Transfers'].includes(row.CategoryGroup));
        expect(screen.length).toBeGreaterThan(0);
        for (const row of screen) {
          expect(
            result.find((entry) => entry.month === month && entry.category === row.Category)
          ).toEqual({
            month,
            category: row.Category,
            assigned: row.Assigned / 1000,
            activity: row.Activity / 1000,
            available: row.Available / 1000,
          });
        }
      }
      const groceries = (month: string) =>
        result.find((entry) => entry.month === month && entry.category === 'Groceries');
      // October: 30 left from August + 100 − 150 = −20 overspent.
      expect(groceries('2026-10')?.available).toBe(-20);
      // November: the overspend carries in cumulative mode, resets in monthly mode.
      expect(groceries('2026-11')?.available).toBe(mode === 'monthly' ? -25 : -45);
      // Vacation: assigned in September, rolls over with no activity.
      expect(
        result.find((e) => e.month === '2026-11' && e.category === 'Vacation')?.available
      ).toBe(200);
    });
  }

  it('goal fields match the budget screen goal progress', () => {
    sqlite.exec(`UPDATE budgets SET RtaMode = 'cumulative' WHERE ID = ${budgetId}`);
    snapshot();
    expect(
      query({
        source: 'budget',
        filters: [
          { field: 'month', op: 'is', values: ['2026-11-01'] },
          { field: 'goal_type', op: 'notEmpty', values: [] },
        ],
        columns: [
          'category',
          'goal_type',
          'goal_target',
          'goal_monthly_target',
          'goal_needed',
          'goal_progress',
          'goal_funded',
        ],
        sort: [{ column: 'category', direction: 'asc' }],
      })
    ).toEqual([
      {
        category: 'Groceries',
        goal_type: 'monthly',
        goal_target: 120,
        goal_monthly_target: 120,
        goal_needed: 120,
        goal_progress: 0,
        goal_funded: false,
      },
      {
        category: 'Vacation',
        goal_type: 'target-balance',
        goal_target: 1000,
        goal_monthly_target: expect.any(Number),
        goal_needed: 800,
        goal_progress: 20,
        goal_funded: false,
      },
    ]);
  });

  it('old budget questions keep their SQL; new fields switch to the budget screen numbers', () => {
    const old = normalizeQuestion({
      source: 'budget',
      aggregations: [{ op: 'sum', field: 'assigned' }],
      breakouts: [{ field: 'month', bucket: 'month' }],
    });
    expect(usesBudgetScreenFields(old)).toBe(false);
    expect(compileQuestion(old, { budgetId, today: TODAY }).sql).not.toContain('budget_months');
    const withAvailable = normalizeQuestion({
      ...old,
      aggregations: [...old.aggregations, { op: 'sum', field: 'available' }],
    });
    expect(usesBudgetScreenFields(withAvailable)).toBe(true);
    expect(query(old)).toEqual(
      query(withAvailable).map(({ month, sum_assigned }) => ({ month, sum_assigned }))
    );
  });
});

// ---------------------------------------------------------------------------
// Scheduled transactions and upcoming occurrences
// ---------------------------------------------------------------------------

describe('Scheduled source', () => {
  it('monthly equivalent for each frequency', () => {
    expect(monthlyEquivalent(-12, 'month', 1)).toBe(-12);
    expect(monthlyEquivalent(-10, 'week', 2)).toBeCloseTo((-10 * 52) / 2 / 12, 10);
    expect(monthlyEquivalent(-3, 'day', 1)).toBeCloseTo((-3 * 365) / 12, 10);
    expect(monthlyEquivalent(-600, 'year', 1)).toBe(-50);
    expect(frequencyCode('week', 2)).toBe('2-week');
    expect(
      query({
        source: 'scheduled',
        filters: [],
        columns: [
          'payee',
          'frequency',
          'amount',
          'monthly_amount',
          'status',
          'next_date',
          'is_transfer',
        ],
        sort: [{ column: 'payee', direction: 'asc' }],
      })
    ).toEqual([
      row('Coffee', 'day', -3, -91.25, 'active', '2026-11-15', false),
      row('Gym', '2-week', -10, -21.667, 'active', '2026-11-15', false),
      row('Insurance', 'year', -600, -50, 'active', '2026-11-15', false),
      row('Netflix', 'month', -12, -12, 'active', '2026-11-15', false),
      row('Old magazine', 'month', -5, -5, 'paused', null, false),
      row('Salary', 'month', 3000, 3000, 'active', '2026-11-15', false),
      row('Save', 'month', -100, -100, 'active', '2026-11-15', true),
    ]);
    function row(
      payee: string,
      frequency: string,
      amount: number,
      monthly: number,
      status: string,
      next: string | null,
      transfer: boolean
    ) {
      return {
        payee,
        frequency,
        amount,
        monthly_amount: monthly,
        status,
        next_date: next,
        is_transfer: transfer,
      };
    }
  });

  it('recurring total per month is one sum (active, no transfers by default)', () => {
    expect(
      query({
        ...createQuestion('scheduled'),
        aggregations: [{ op: 'sum', field: 'monthly_amount' }],
      })
    ).toEqual([{ sum_monthly_amount: 3000 - 91.25 - 21.667 - 50 - 12 }]);
  });

  it('bills due in the next 30 days, from the upcoming occurrences', () => {
    const due = query({
      ...createQuestion('upcoming'),
      filters: [...createQuestion('upcoming').filters, { field: 'amount', op: 'lt', values: [0] }],
      aggregations: [{ op: 'sum', field: 'outflow' }, { op: 'count' }],
      breakouts: [{ field: 'payee' }],
      sort: [{ column: 'payee', direction: 'asc' }],
    });
    // 15 Nov – 10 Dec: coffee daily (26), gym every 2 weeks (2), Netflix (1), insurance (1)
    expect(due).toEqual([
      { payee: 'Coffee', sum_outflow: 78, count: 26 },
      { payee: 'Gym', sum_outflow: 20, count: 2 },
      { payee: 'Insurance', sum_outflow: 600, count: 1 },
      { payee: 'Netflix', sum_outflow: 12, count: 1 },
    ]);
  });

  it('a split template still loads (no category, marked split)', () => {
    sqlite.exec(
      `UPDATE recurring_transactions SET Name = 'Split groceries' WHERE ID = ${ids.netflix}`
    );
    const original = services.recurring.listRecurringTransactions.bind(services.recurring);
    const spy = vi
      .spyOn(services.recurring, 'listRecurringTransactions')
      .mockImplementation((id, inactive) =>
        original(id, inactive).map((template) =>
          template.id === ids.netflix
            ? ({
                ...template,
                categoryId: null,
                splits: [{ categoryId: ids.fun }, { categoryId: ids.groceries }],
              } as typeof template)
            : template
        )
      );
    try {
      snapshot();
      expect(
        query({
          source: 'scheduled',
          filters: [{ field: 'payee', op: 'is', values: ['split groceries'] }],
          columns: ['payee', 'category', 'is_split', 'monthly_amount'],
        })
      ).toEqual([
        {
          payee: 'Split groceries',
          category: 'Several categories',
          is_split: true,
          monthly_amount: -12,
        },
      ]);
    } finally {
      spy.mockRestore();
      sqlite.exec(`UPDATE recurring_transactions SET Name = 'Netflix' WHERE ID = ${ids.netflix}`);
      snapshot();
    }
  });
});

// ---------------------------------------------------------------------------
// Payees
// ---------------------------------------------------------------------------

describe('Payees source', () => {
  it('one row per payee, transfers left out, names merged case-insensitively', () => {
    expect(
      query({
        source: 'payees',
        filters: [],
        columns: [
          'payee',
          'transaction_count',
          'outflow',
          'inflow',
          'total',
          'first_seen',
          'last_seen',
          'top_category',
        ],
      })
    ).toEqual([
      // Lidl + "lidl " (card): 80 + 40 + 150 + 25
      {
        payee: 'Lidl',
        transaction_count: 4,
        outflow: 295,
        inflow: 0,
        total: -295,
        first_seen: '2026-08-10',
        last_seen: '2026-11-02',
        top_category: 'Groceries',
      },
      expect.objectContaining({ payee: 'Cinema', transaction_count: 1 }),
      expect.objectContaining({ payee: 'Employer', transaction_count: 1 }),
      expect.objectContaining({ payee: 'Future', transaction_count: 1 }),
      expect.objectContaining({ payee: 'Landlord', transaction_count: 1 }),
    ]);
  });

  it('filter-only fields narrow the transactions counted; drill shows them', () => {
    const spec = normalizeQuestion({
      source: 'payees',
      filters: [
        { field: 'date', op: 'between', values: ['2026-10-01', '2026-11-30'] },
        { field: 'account', op: 'is', values: [ids.checking] },
      ],
      aggregations: [{ op: 'sum', field: 'outflow' }],
      breakouts: [{ field: 'payee' }],
    });
    expect(query(spec)).toEqual([
      { payee: 'Lidl', sum_outflow: 175 },
      { payee: 'Cinema', sum_outflow: 30 },
    ]);
    const result = runSpec(spec);
    const resultColumns = result.schema.fields.map((field) => field.name);
    const lidl = result
      .toArray()
      .map((row) => resultColumns.map((name) => row[name]))
      .find((cells) => cells[resultColumns.indexOf('payee')] === 'Lidl')!;
    const context = { spec, values: rowDrillValues(questionColumns(spec), resultColumns, lidl) };
    const drilled = applyDrill(context, { kind: 'transactions' });
    expect(drilled.source).toBe('transactions');
    expect(query({ ...drilled, aggregations: [{ op: 'count' }] })).toEqual([{ count: 2 }]);
  });

  it('the payee_summary view agrees', () => {
    expect(
      rows(
        `SELECT payee_name, transaction_count, CAST(outflow AS DOUBLE) AS outflow FROM payee_summary
         WHERE budget_id = ${budgetId} AND payee_name = 'Lidl'`
      ).map((row) => ({ ...row, outflow: Number(row.outflow) }))
    ).toEqual([{ payee_name: 'Lidl', transaction_count: 4, outflow: 295 }]);
  });
});
