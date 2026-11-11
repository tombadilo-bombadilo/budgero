/**
 * The reporting snapshot under load: parallel queries (incl. the derived
 * budget_months and scheduled_occurrences tables) while other queries force
 * rebuilds, against a real core database and the node DuckDB build.
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type * as DuckDbBlocking from '@duckdb/duckdb-wasm/blocking';
// The integration test needs the Node database adapter; production uses the browser entry.
// eslint-disable-next-line no-restricted-imports
import { NodeSqlJsAdapter, ServiceManager, asMilli, setClock, type Services } from '@budgero/core';
import {
  ReportingSnapshot,
  type ReportingDuckDb,
  type ReportingSqlDatabase,
} from './reporting-snapshot';

const require = createRequire(import.meta.url);
const duckdb =
  require('@duckdb/duckdb-wasm/dist/duckdb-node-blocking.cjs') as typeof DuckDbBlocking;

const distDir = path.dirname(require.resolve('@duckdb/duckdb-wasm/dist/duckdb-node-blocking.cjs'));

let conn: DuckDbBlocking.DuckDBConnection;
let sqlite: Awaited<ReturnType<typeof NodeSqlJsAdapter.create>>;
let services: Services;
let budgetId: number;
let today = '2026-11-11';

const pause = () => new Promise((resolve) => setTimeout(resolve, Math.random() * 4));

function literal(value: unknown, type: string): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  return `CAST('${String(value).replace(/'/g, "''")}' AS ${type})`;
}

/** Node DuckDB with an await (and a random pause) on every statement, so work interleaves. */
let beforeQuery: ((sql: string) => Promise<void>) | null = null;
const nodeDuckDb: ReportingDuckDb = {
  async query(sql) {
    await pause();
    if (beforeQuery) await beforeQuery(sql);
    return conn.query(sql);
  },
  async insertRows(table, columns, rows) {
    for (let start = 0; start < rows.length; start += 500) {
      await pause();
      const values = rows
        .slice(start, start + 500)
        .map((row) => `(${columns.map((c) => literal(row[c.name], c.type)).join(', ')})`);
      conn.query(`INSERT INTO "${table}" VALUES ${values.join(', ')}`);
    }
  },
};

const db = () => sqlite as unknown as ReportingSqlDatabase;
const newSnapshot = () =>
  new ReportingSnapshot(nodeDuckDb, { today: () => today, services: () => services });

beforeAll(async () => {
  const duck = await duckdb.createDuckDB(
    {
      mvp: { mainModule: path.join(distDir, 'duckdb-mvp.wasm'), mainWorker: '' },
      eh: { mainModule: path.join(distDir, 'duckdb-eh.wasm'), mainWorker: '' },
    },
    new duckdb.VoidLogger(),
    duckdb.NODE_RUNTIME
  );
  await duck.instantiate(() => undefined);
  conn = duck.connect();
  setClock(new Date(2026, 10, 11, 12));
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
    name: 'Load',
    display_currency: 'USD',
    badge_icon: 'dollar',
    number_format: '123,456.78',
    create_default_categories: false,
  });
  const group = services.categories.addCategoryGroup('Living', budgetId);
  const food = services.categories.addCategory(group, budgetId, 'Food');
  const account = (
    await services.accounts.createAccount('Checking', budgetId, 'Checking', 'USD', asMilli(0))
  ).ID;
  for (let month = 1; month <= 10; month += 1) {
    const key = `2026-${String(month).padStart(2, '0')}`;
    services.monthlyBudgets.upsertMonthlyAssignment(food, asMilli(100_000), key, budgetId);
    await services.transactions.addTransaction(
      asMilli(0),
      asMilli(60_000),
      account,
      food,
      budgetId,
      `${key}-10`,
      '',
      '',
      'Shop'
    );
  }
  await services.recurring.createRecurringTransaction({
    budgetId,
    accountId: account,
    categoryId: food,
    name: 'Box',
    amount: asMilli(10_000),
    direction: 'outflow',
    schedule: { startDate: '2026-11-15', intervalUnit: 'week', intervalCount: 1 },
  });
}, 60_000);

afterAll(() => {
  conn?.close();
  setClock(null);
});

const QUERIES = [
  [`SELECT CAST(SUM(available) AS DOUBLE) AS v FROM budget_months WHERE month = '2026-10-01'`, 400],
  [`SELECT COUNT(*) AS v FROM scheduled_occurrences WHERE due_date <= '2026-12-31'`, 7],
  [`SELECT COUNT(*) AS v FROM transactions_analytics`, 10],
  [
    `SELECT CAST(SUM(balance) AS DOUBLE) AS v FROM account_balances_daily WHERE date = '2026-11-11'`,
    -600,
  ],
] as const;

describe('ReportingSnapshot', () => {
  it('parallel queries while others force rebuilds all see complete tables', async () => {
    const snapshot = newSnapshot();
    const runs: Promise<[string, unknown, number]>[] = [];
    for (let index = 0; index < 60; index += 1) {
      const [sql, expected] = QUERIES[index % QUERIES.length];
      // Every few queries the data "changes" (a no-op write moves total_changes)
      // while earlier queries are still running.
      if (index % 3 === 0) {
        await new Promise((resolve) => setTimeout(resolve, 2));
        sqlite.exec(`UPDATE budgets SET Name = Name WHERE ID = ${budgetId}`);
      }
      runs.push(snapshot.execute(sql, db()).then((result) => [sql, result.rows[0]?.[0], expected]));
    }
    for (const [sql, value, expected] of await Promise.all(runs)) {
      expect([sql, value]).toEqual([sql, expected]);
    }
    expect(snapshot.rebuilds).toBeGreaterThan(1);
  }, 120_000);

  it('a rebuild started by another query waits until a running query has read its tables', async () => {
    const snapshot = newSnapshot();
    const target = `SELECT CAST(SUM(available) AS DOUBLE) AS v FROM budget_months WHERE month = '2026-10-01'`;
    let other: Promise<unknown> | null = null;
    beforeQuery = async (sql) => {
      if (!sql.startsWith(target) || other) return;
      // Right before the first query reads budget_months, the data changes and
      // a second query starts (and wants a rebuild).
      sqlite.exec(`UPDATE budgets SET Name = Name WHERE ID = ${budgetId}`);
      other = snapshot.execute('SELECT COUNT(*) FROM transactions_analytics', db());
      await new Promise((resolve) => setTimeout(resolve, 400));
    };
    try {
      const result = await snapshot.execute(target, db());
      expect(result.rows[0]?.[0]).toBe(400);
      expect((await other) as unknown).toMatchObject({ rows: [[10]] });
    } finally {
      beforeQuery = null;
    }
  }, 60_000);

  it('rebuilds only when the data, the day or the database changes', async () => {
    const snapshot = newSnapshot();
    for (let i = 0; i < 4; i += 1)
      await snapshot.execute('SELECT COUNT(*) FROM transactions_analytics', db());
    expect(snapshot.rebuilds).toBe(1);
    // Reading the scheduled tables materializes occurrences: not a data change.
    await snapshot.execute('SELECT COUNT(*) FROM scheduled_occurrences', db());
    await snapshot.execute('SELECT COUNT(*) FROM scheduled_occurrences', db());
    expect(snapshot.rebuilds).toBe(1);
    sqlite.exec(`UPDATE budgets SET Name = Name WHERE ID = ${budgetId}`);
    await snapshot.execute('SELECT 1', db());
    expect(snapshot.rebuilds).toBe(2);
    today = '2026-11-12';
    try {
      await snapshot.execute('SELECT 1', db());
      expect(snapshot.rebuilds).toBe(3);
    } finally {
      today = '2026-11-11';
    }
  }, 60_000);
});
