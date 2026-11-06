/**
 * Runs compiled builder SQL through DuckDB (the node build of the same wasm
 * engine the app uses) against the real `transactions_analytics` view.
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type * as DuckDbBlocking from '@duckdb/duckdb-wasm/dist/duckdb-node-blocking';
import { TRANSACTIONS_ANALYTICS_VIEW_SQL } from '@shared/lib/sql/analytics-views';
import { stripLeadingSqlComments } from '@shared/lib/sql/read-only';
import {
  buildSavedBuilderQuery,
  compileReportSpec,
  createDefaultSpec,
  type ReportBuilderSpec,
} from './report-builder';

const require = createRequire(import.meta.url);
const duckdb =
  require('@duckdb/duckdb-wasm/dist/duckdb-node-blocking.cjs') as typeof DuckDbBlocking;

const distDir = path.dirname(require.resolve('@duckdb/duckdb-wasm/dist/duckdb-node-blocking.cjs'));

let db: DuckDbBlocking.DuckDBBindings;
let conn: DuckDbBlocking.DuckDBConnection;

const SCHEMA = `
CREATE TABLE budgets ("ID" BIGINT, "Name" VARCHAR, "DisplayCurrency" VARCHAR);
CREATE TABLE accounts ("ID" BIGINT, "Name" VARCHAR, "Type" VARCHAR, "Currency" VARCHAR, "OnBudget" BIGINT, "ReconciledAt" VARCHAR, "BudgetID" BIGINT);
CREATE TABLE category_groups ("ID" BIGINT, "Name" VARCHAR, "Note" VARCHAR, "Position" BIGINT, "BudgetID" BIGINT);
CREATE TABLE categories ("ID" BIGINT, "Name" VARCHAR, "Note" VARCHAR, "CategoryGroupID" BIGINT, "Position" BIGINT, "BudgetID" BIGINT);
CREATE TABLE labels ("ID" BIGINT, "Name" VARCHAR, "Color" VARCHAR, "CreatedAt" VARCHAR, "BudgetID" BIGINT);
CREATE TABLE payees ("ID" BIGINT, "Name" VARCHAR, "Metadata" VARCHAR, "CreatedAt" VARCHAR, "UpdatedAt" VARCHAR, "BudgetID" BIGINT);
CREATE TABLE transactions (
  "ID" BIGINT, "CategoryID" BIGINT, "AccountID" BIGINT, "LabelID" BIGINT, "BudgetID" BIGINT,
  "TransferID" VARCHAR, "Payee" VARCHAR, "Date" VARCHAR, "Memo" VARCHAR, "Reconciled" BIGINT,
  "Cleared" BIGINT, "InflowConverted" BIGINT, "OutflowConverted" BIGINT, "InflowNative" BIGINT,
  "OutflowNative" BIGINT, "RunningBalanceConverted" BIGINT, "RunningBalanceNative" BIGINT,
  "ExchangeRate" DOUBLE, "ExchangeRateOverride" BIGINT, "ConversionPending" BIGINT
);
CREATE TABLE transaction_splits (
  "ID" BIGINT, "TransactionID" BIGINT, "CategoryID" BIGINT, "TransferAccountID" BIGINT,
  "Memo" VARCHAR, "Payee" VARCHAR, "InflowConverted" BIGINT, "OutflowConverted" BIGINT,
  "InflowNative" BIGINT, "OutflowNative" BIGINT, "OrderIndex" BIGINT
);
INSERT INTO budgets VALUES (1, 'Home', 'EUR'), (2, 'Other', 'EUR');
INSERT INTO accounts VALUES
  (100, 'Checking', 'Checking', 'EUR', 1, NULL, 1),
  (101, 'Brokerage', 'Investment', 'EUR', 0, NULL, 1),
  (200, 'Elsewhere', 'Checking', 'EUR', 1, NULL, 2);
INSERT INTO category_groups VALUES (1, 'Income', '', 0, 1), (2, 'Living', '', 1, 1);
INSERT INTO categories VALUES
  (10, 'Salary', '', 1, 0, 1), (20, 'Groceries', '', 2, 0, 1),
  (21, 'Rent', '', 2, 1, 1), (22, 'Fun', '', 2, 2, 1);
INSERT INTO labels VALUES (1, 'Vacation', '#f00', NULL, 1);
INSERT INTO transactions VALUES
  (1, 20, 100, 1, 1, NULL, 'Lidl', '2026-01-05', '', 0, 0, 0, 50000, 0, 50000, 0, 0, 1, 0, 0),
  (2, 10, 100, NULL, 1, NULL, 'Employer', '2026-01-10', '', 0, 0, 3000000, 0, 3000000, 0, 0, 0, 1, 0, 0),
  (3, NULL, 100, NULL, 1, NULL, 'Costco', '2026-02-03', '', 0, 0, 0, 120000, 0, 120000, 0, 0, 1, 0, 0),
  (4, NULL, 100, NULL, 1, 'tr_1', 'Transfer', '2026-02-15', '', 0, 0, 0, 500000, 0, 500000, 0, 0, 1, 0, 0),
  (5, NULL, 101, NULL, 1, NULL, 'Broker', '2026-02-20', '', 0, 0, 0, 70000, 0, 70000, 0, 0, 1, 0, 0),
  (6, 20, 100, NULL, 1, NULL, 'Lidl', '2026-02-21', '', 0, 0, 10000, 0, 10000, 0, 0, 0, 1, 0, 0),
  (7, 20, 200, NULL, 2, NULL, 'Lidl', '2026-02-21', '', 0, 0, 0, 999000, 0, 999000, 0, 0, 1, 0, 0),
  (8, NULL, 100, NULL, 1, NULL, 'Landlord', '2026-03-01', '', 0, 0, 0, 100000, 0, 100000, 0, 0, 1, 0, 0);
INSERT INTO transaction_splits VALUES
  (1, 3, 20, NULL, '', '', 0, 80000, 0, 80000, 0),
  (2, 3, 22, NULL, '', 'O''Brien''s', 0, 40000, 0, 40000, 1),
  (3, 8, 21, NULL, '', '', 0, 60000, 0, 60000, 0),
  (4, 8, NULL, 101, '', '', 0, 40000, 0, 40000, 1);
`;

beforeAll(async () => {
  db = await duckdb.createDuckDB(
    {
      mvp: { mainModule: path.join(distDir, 'duckdb-mvp.wasm'), mainWorker: '' },
      eh: { mainModule: path.join(distDir, 'duckdb-eh.wasm'), mainWorker: '' },
    },
    new duckdb.VoidLogger(),
    duckdb.NODE_RUNTIME
  );
  await db.instantiate();
  conn = db.connect();
  conn.query('SET old_implicit_casting = true');
  for (const statement of SCHEMA.split(';').map((part) => part.trim())) {
    if (statement) conn.query(statement);
  }
  conn.query(TRANSACTIONS_ANALYTICS_VIEW_SQL);
}, 30_000);

afterAll(() => {
  conn?.close();
});

function run(overrides: Partial<ReportBuilderSpec>, budgetId = 1): Record<string, unknown>[] {
  const spec = createDefaultSpec({ dateRange: { preset: 'allTime' }, ...overrides });
  const { sql } = compileReportSpec(spec, { budgetId });
  // Same path as a saved report: header line, then the executor strips it.
  const saved = buildSavedBuilderQuery(spec, sql);
  return conn
    .query(stripLeadingSqlComments(saved))
    .toArray()
    .map((row) =>
      Object.fromEntries(
        Object.entries(row.toJSON() as Record<string, unknown>).map(([key, value]) => [
          key,
          typeof value === 'bigint' ? Number(value) : value,
        ])
      )
    );
}

describe('compiled builder SQL on DuckDB', () => {
  it('spending by category attributes split lines to their categories', () => {
    expect(run({ groupBy: 'category' })).toEqual([
      { label: 'Groceries', value: 120 }, // 50 + 80 (split) - 10 refund
      { label: 'Rent', value: 60 }, // split line; the transfer line is excluded
      { label: 'Fun', value: 40 },
    ]);
  });

  it('includes transfers and off-budget accounts when asked', () => {
    expect(run({ groupBy: 'category', includeTransfers: true })).toContainEqual({
      label: 'Uncategorized',
      value: 540,
    });
    expect(run({ groupBy: 'category', includeOffBudget: true })).toContainEqual({
      label: 'Uncategorized',
      value: 70,
    });
  });

  it('income vs spending by month, chronological', () => {
    expect(run({ measure: 'incomeVsSpending', groupBy: 'month' })).toEqual([
      { label: '2026-01', series: 'Income', value: 3000 },
      { label: '2026-01', series: 'Spending', value: 50 },
      { label: '2026-02', series: 'Spending', value: 110 },
      { label: '2026-03', series: 'Spending', value: 60 },
    ]);
  });

  it('net, count and average as stats', () => {
    expect(run({ measure: 'net', chartType: 'stat' })).toEqual([{ value: 2780 }]);
    expect(run({ measure: 'count', chartType: 'stat' })).toEqual([{ value: 5 }]);
    // 220 spending over 4 spending transactions (1, 3, 6, 8)
    expect(run({ measure: 'average', chartType: 'stat' })).toEqual([{ value: 55 }]);
  });

  it('scopes to the budget', () => {
    expect(run({ groupBy: 'payee' }, 2)).toEqual([{ label: 'Lidl', value: 999 }]);
  });

  it('filters payees by name, including split-line payees with quotes', () => {
    expect(
      run({
        groupBy: 'category',
        filters: {
          accountIds: [],
          categoryIds: [],
          categoryGroupIds: [],
          labelIds: [],
          payees: ["o'brien's"],
        },
      })
    ).toEqual([{ label: 'Fun', value: 40 }]);
  });

  it('filters by label and category group, splits by series, applies Top N', () => {
    expect(
      run({
        groupBy: 'label',
        filters: {
          accountIds: [],
          categoryIds: [],
          categoryGroupIds: [2],
          labelIds: [1],
          payees: [],
        },
      })
    ).toEqual([{ label: 'Vacation', value: 50 }]);

    expect(run({ groupBy: 'category', limit: 1 })).toEqual([{ label: 'Groceries', value: 120 }]);
    expect(run({ groupBy: 'category', sort: 'label' }).map((row) => row.label)).toEqual([
      'Fun',
      'Groceries',
      'Rent',
    ]);

    expect(run({ groupBy: 'category', splitBy: 'month', limit: 2 })).toEqual([
      { label: 'Groceries', series: '2026-01', value: 50 },
      { label: 'Groceries', series: '2026-02', value: 70 },
      { label: 'Rent', series: '2026-03', value: 60 },
    ]);
  });

  it('time group-bys format labels', () => {
    expect(run({ groupBy: 'quarter' })).toEqual([{ label: '2026-Q1', value: 220 }]);
    expect(run({ groupBy: 'year' })).toEqual([{ label: '2026', value: 220 }]);
    expect(run({ groupBy: 'week' }).map((row) => row.label)).toEqual([
      '2026-01-05',
      '2026-02-02',
      '2026-02-16',
      '2026-02-23',
    ]);
  });

  it('custom date ranges are inclusive', () => {
    expect(
      run({
        groupBy: 'month',
        dateRange: { preset: 'custom', from: '2026-02-01', to: '2026-02-28' },
      })
    ).toEqual([{ label: '2026-02', value: 110 }]);
  });
});
