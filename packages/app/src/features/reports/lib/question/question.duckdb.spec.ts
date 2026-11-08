/**
 * Runs compiled question SQL through DuckDB (the node build of the same wasm
 * engine the app uses) against the real `transactions_analytics` view and
 * snapshot-shaped tables, for every source.
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type * as DuckDbBlocking from '@duckdb/duckdb-wasm/blocking';
import { TRANSACTIONS_ANALYTICS_VIEW_SQL } from '@shared/lib/sql/analytics-views';
import { isReadOnlyQuery, stripLeadingSqlComments } from '@shared/lib/sql/read-only';
import { compileQuestion } from './compile';
import { applyDrill, rowDrillValues, type DrillAction } from './drill';
import { buildSavedQuestionQuery, parseQuestionHeader } from './header';
import {
  normalizeQuestion,
  questionColumns,
  type QuestionFilter,
  type QuestionSpec,
  type RelativeUnit,
} from './spec';

const require = createRequire(import.meta.url);
const duckdb =
  require('@duckdb/duckdb-wasm/dist/duckdb-node-blocking.cjs') as typeof DuckDbBlocking;

const distDir = path.dirname(require.resolve('@duckdb/duckdb-wasm/dist/duckdb-node-blocking.cjs'));

let db: DuckDbBlocking.DuckDBBindings;
let conn: DuckDbBlocking.DuckDBConnection;

const SCHEMA = `
CREATE TABLE budgets ("ID" BIGINT, "Name" VARCHAR, "DisplayCurrency" VARCHAR);
CREATE TABLE accounts ("ID" BIGINT, "Name" VARCHAR, "Type" VARCHAR, "Currency" VARCHAR, "OnBudget" BIGINT, "ReconciledAt" VARCHAR, "BudgetID" BIGINT, "Archived" BIGINT, "Position" BIGINT);
CREATE TABLE category_groups ("ID" BIGINT, "Name" VARCHAR, "Note" VARCHAR, "Position" BIGINT, "BudgetID" BIGINT);
CREATE TABLE categories ("ID" BIGINT, "Name" VARCHAR, "Note" VARCHAR, "CategoryGroupID" BIGINT, "Position" BIGINT, "BudgetID" BIGINT);
CREATE TABLE labels ("ID" BIGINT, "Name" VARCHAR, "Color" VARCHAR, "CreatedAt" VARCHAR, "BudgetID" BIGINT);
CREATE TABLE payees ("ID" BIGINT, "Name" VARCHAR, "Metadata" VARCHAR, "CreatedAt" VARCHAR, "UpdatedAt" VARCHAR, "BudgetID" BIGINT);
CREATE TABLE assignments ("ID" BIGINT, "CategoryID" BIGINT, "Amount" BIGINT, "Month" VARCHAR, "BudgetID" BIGINT);
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
INSERT INTO budgets VALUES (1, 'Home', 'EUR'), (2, 'Other', 'EUR'), (3, 'Recent', 'EUR');
INSERT INTO accounts VALUES
  (100, 'Checking', 'Checking', 'EUR', 1, NULL, 1, 0, 0),
  (101, 'Brokerage', 'Investment', 'USD', 0, NULL, 1, 1, 1),
  (200, 'Elsewhere', 'Checking', 'EUR', 1, NULL, 2, 0, 0),
  (300, 'Daily', 'Checking', 'EUR', 1, NULL, 3, 0, 0);
INSERT INTO category_groups VALUES (1, 'Income', '', 0, 1), (2, 'Living', '', 1, 1), (3, 'Daily', '', 0, 3);
INSERT INTO categories VALUES
  (10, 'Salary', '', 1, 0, 1), (20, 'Groceries', '', 2, 0, 1),
  (21, 'Rent', '', 2, 1, 1), (22, 'Fun', '', 2, 2, 1), (30, 'Coffee', '', 3, 0, 3);
INSERT INTO labels VALUES (1, 'Vacation', '#f00', NULL, 1);
INSERT INTO assignments VALUES
  (1, 20, 100000, '2026-01', 1),
  (2, 21, 600000, '2026-03', 1),
  (3, 10, 5000, '2026-01', 1),
  (4, 20, 999000, '2026-01', 2);
INSERT INTO transactions VALUES
  (1, 20, 100, 1, 1, NULL, 'Lidl', '2026-01-05', 'weekly shop', 0, 1, 0, 50000, 0, 50000, 0, 0, 1, 0, 0),
  (2, 10, 100, NULL, 1, NULL, 'Employer', '2026-01-10', '', 0, 1, 3000000, 0, 3000000, 0, 0, 0, 1, 0, 0),
  (3, NULL, 100, NULL, 1, NULL, 'Costco', '2026-02-03', '', 0, 0, 0, 120000, 0, 120000, 0, 0, 1, 0, 0),
  (4, NULL, 100, NULL, 1, 'tr_1', 'Transfer', '2026-02-15', '', 0, 0, 0, 500000, 0, 500000, 0, 0, 1, 0, 0),
  (5, NULL, 101, NULL, 1, NULL, 'Broker', '2026-02-20', '', 0, 0, 0, 70000, 0, 77000, 0, 0, 1, 0, 0),
  (6, 20, 100, NULL, 1, NULL, 'Lidl', '2026-02-21', 'refund', 0, 0, 10000, 0, 10000, 0, 0, 0, 1, 0, 0),
  (7, 20, 200, NULL, 2, NULL, 'Lidl', '2026-02-21', '', 0, 0, 0, 999000, 0, 999000, 0, 0, 1, 0, 0),
  (8, NULL, 100, NULL, 1, NULL, 'Landlord', '2026-03-01', '', 0, 0, 0, 100000, 0, 100000, 0, 0, 1, 0, 0);
INSERT INTO transactions VALUES
  (9, 30, 300, NULL, 3, NULL, 'Cafe', '2026-11-03', '', 0, 0, 0, 5000, 0, 5000, 0, 0, 1, 0, 0),
  (10, 30, 300, NULL, 3, NULL, 'Cafe', '2026-10-06', '', 0, 0, 0, 7000, 0, 7000, 0, 0, 1, 0, 0),
  (11, 30, 300, NULL, 3, NULL, 'Cafe', '2025-10-02', '', 0, 0, 0, 11000, 0, 11000, 0, 0, 1, 0, 0);
INSERT INTO transaction_splits VALUES
  (1, 3, 20, NULL, '', '', 0, 80000, 0, 80000, 0),
  (2, 3, 22, NULL, 'party', 'O''Brien''s', 0, 40000, 0, 40000, 1),
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
  await db.instantiate(() => undefined);
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

const NO_TRANSFERS: QuestionFilter = { field: 'is_transfer', op: 'is', values: [false] };
const ON_BUDGET: QuestionFilter = { field: 'on_budget', op: 'is', values: [true] };

/** "Today" for relative date filters (the node DuckDB build has no clock). */
const TODAY = '2026-11-06';

/** Rows of a question; hidden `<key>__key` columns (ids for drill-through) are left out. */
function query(spec: Partial<QuestionSpec>, budgetId = 1): Record<string, unknown>[] {
  return queryWithKeys(spec, budgetId).map((row) =>
    Object.fromEntries(Object.entries(row).filter(([key]) => !key.endsWith('__key')))
  );
}

function queryWithKeys(spec: Partial<QuestionSpec>, budgetId = 1): Record<string, unknown>[] {
  const full = normalizeQuestion({ source: 'transactions', ...spec });
  const { sql } = compileQuestion(full, { budgetId, today: TODAY });
  // Same path as a saved question: header line, then the executor strips it.
  const saved = buildSavedQuestionQuery(full, sql);
  expect(parseQuestionHeader(saved)).toEqual(full);
  const statement = stripLeadingSqlComments(saved);
  expect(isReadOnlyQuery(statement)).toBe(true);
  return conn
    .query(statement)
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

/** Transactions question with the default "no transfers, on budget" filters. */
function tx(spec: Partial<QuestionSpec>, budgetId = 1) {
  return query({ ...spec, filters: [NO_TRANSFERS, ON_BUDGET, ...(spec.filters ?? [])] }, budgetId);
}

describe('Transactions source', () => {
  it('spending by category attributes split lines to their categories', () => {
    expect(tx({ aggregations: [{ op: 'spending' }], breakouts: [{ field: 'category' }] })).toEqual([
      { category: 'Groceries', spending: 120 }, // 50 + 80 (split) - 10 refund
      { category: 'Rent', spending: 60 }, // split line; the transfer line is excluded
      { category: 'Fun', spending: 40 },
    ]);
  });

  it('income and spending by month, chronological, one column per metric', () => {
    expect(
      tx({
        aggregations: [{ op: 'income' }, { op: 'spending' }],
        breakouts: [{ field: 'date', bucket: 'month' }],
      })
    ).toEqual([
      { month: '2026-01', income: 3000, spending: 50 },
      { month: '2026-02', income: 0, spending: 110 },
      { month: '2026-03', income: 0, spending: 60 },
    ]);
  });

  it('single numbers: net, count, average spending, sum/avg/min/max/distinct', () => {
    expect(tx({ aggregations: [{ op: 'net' }] })).toEqual([{ net: 2780 }]);
    expect(tx({ aggregations: [{ op: 'count' }] })).toEqual([{ count: 5 }]);
    // 220 spending over 4 spending transactions (1, 3, 6, 8)
    expect(tx({ aggregations: [{ op: 'averageSpending' }] })).toEqual([{ average_spending: 55 }]);
    expect(
      tx({
        aggregations: [
          { op: 'sum', field: 'outflow' },
          { op: 'avg', field: 'amount' },
          { op: 'min', field: 'amount' },
          { op: 'max', field: 'inflow' },
          { op: 'distinct', field: 'category' },
          { op: 'distinct', field: 'payee' },
        ],
      })
    ).toEqual([
      {
        sum_outflow: 230, // 50 + 80 + 40 + 60 (transfer lines excluded)
        avg_amount: 463.33, // (−50 + 3000 − 80 − 40 + 10 − 60) / 6 lines
        min_amount: -80,
        max_inflow: 3000,
        distinct_category: 4,
        distinct_payee: 5, // Lidl, Employer, Costco, O'Brien's, Landlord
      },
    ]);
  });

  it('includes transfers and off-budget accounts once their filters are removed', () => {
    const all = query({ aggregations: [{ op: 'spending' }], breakouts: [{ field: 'category' }] });
    expect(all).toContainEqual({ category: 'Uncategorized', spending: 610 }); // 500 + 70 + 40
    const offBudget = query({
      filters: [NO_TRANSFERS],
      aggregations: [{ op: 'spending' }],
      breakouts: [{ field: 'category' }],
    });
    expect(offBudget).toContainEqual({ category: 'Uncategorized', spending: 70 });
  });

  it('scopes to the budget', () => {
    expect(tx({ aggregations: [{ op: 'spending' }], breakouts: [{ field: 'payee' }] }, 2)).toEqual([
      { payee: 'Lidl', spending: 999 },
    ]);
  });

  it('entity filters: is / is not / contains / starts with / empty', () => {
    const byCategory = (filters: QuestionSpec['filters'], includeTransfers = false) =>
      (includeTransfers ? query : tx)({
        filters,
        aggregations: [{ op: 'spending' }],
        breakouts: [{ field: 'category' }],
        sort: [{ column: 'category', direction: 'asc' }],
      });
    expect(byCategory([{ field: 'category', op: 'is', values: [20, 21] }])).toEqual([
      { category: 'Groceries', spending: 120 },
      { category: 'Rent', spending: 60 },
    ]);
    expect(byCategory([{ field: 'category', op: 'isNot', values: [20] }])).toEqual([
      { category: 'Fun', spending: 40 },
      { category: 'Rent', spending: 60 },
    ]);
    expect(byCategory([{ field: 'payee', op: 'contains', values: ["BRIEN'S"] }])).toEqual([
      { category: 'Fun', spending: 40 },
    ]);
    expect(byCategory([{ field: 'payee', op: 'is', values: ["o'brien's"] }])).toEqual([
      { category: 'Fun', spending: 40 },
    ]);
    expect(byCategory([{ field: 'payee', op: 'startsWith', values: ['lid'] }])).toEqual([
      { category: 'Groceries', spending: 40 },
    ]);
    expect(byCategory([{ field: 'category', op: 'isEmpty', values: [] }], true)).toEqual([
      { category: 'Uncategorized', spending: 610 },
    ]);
    expect(
      byCategory([
        { field: 'category', op: 'notEmpty', values: [] },
        { field: 'category_group', op: 'is', values: [2] },
        { field: 'label', op: 'is', values: [1] },
      ])
    ).toEqual([{ category: 'Groceries', spending: 50 }]);
    expect(byCategory([{ field: 'account', op: 'is', values: [101] }], true)).toEqual([
      { category: 'Uncategorized', spending: 70 },
    ]);
  });

  it('text and number filters', () => {
    const count = (filters: QuestionSpec['filters']) =>
      tx({ filters, aggregations: [{ op: 'count' }] })[0].count;
    expect(count([{ field: 'memo', op: 'contains', values: ['SHOP'] }])).toBe(1);
    expect(count([{ field: 'memo', op: 'is', values: ['party'] }])).toBe(1); // split-line memo
    expect(count([{ field: 'memo', op: 'isEmpty', values: [] }])).toBe(3); // 2, 3 (Groceries line), 8
    expect(count([{ field: 'amount', op: 'gt', values: [0] }])).toBe(2);
    expect(count([{ field: 'amount', op: 'lt', values: [-55] }])).toBe(2); // −80 split line, −60 line
    expect(count([{ field: 'amount', op: 'between', values: [-60, -40] }])).toBe(3);
    expect(count([{ field: 'amount', op: 'is', values: [10, -50] }])).toBe(2);
    expect(count([{ field: 'outflow', op: 'isNot', values: [0] }])).toBe(3);
    expect(count([{ field: 'cleared', op: 'is', values: [true] }])).toBe(2);
  });

  it('absolute date filters are inclusive / exclusive as named', () => {
    const months = (filter: QuestionSpec['filters'][number]) =>
      tx({
        filters: [filter],
        aggregations: [{ op: 'spending' }],
        breakouts: [{ field: 'date', bucket: 'month' }],
      });
    expect(months({ field: 'date', op: 'between', values: ['2026-02-01', '2026-02-28'] })).toEqual([
      { month: '2026-02', spending: 110 },
    ]);
    // Feb 1–2 are in range but empty: the month still shows, with 0.
    expect(months({ field: 'date', op: 'before', values: ['2026-02-03'] })).toEqual([
      { month: '2026-01', spending: 50 },
      { month: '2026-02', spending: 0 },
    ]);
    expect(months({ field: 'date', op: 'after', values: ['2026-02-21'] })).toEqual([
      { month: '2026-02', spending: 0 },
      { month: '2026-03', spending: 60 },
    ]);
    expect(months({ field: 'date', op: 'is', values: ['2026-03-01'] })).toEqual([
      { month: '2026-03', spending: 60 },
    ]);
  });

  it('relative date filters count back from today', () => {
    const total = (filter: QuestionSpec['filters'][number]) =>
      tx({ filters: [filter], aggregations: [{ op: 'spending' }] }, 3)[0].spending;
    const previous = (amount: number, unit: RelativeUnit, includeCurrent = true) =>
      total({ field: 'date', op: 'previous', values: [], amount, unit, includeCurrent });

    // Rows on 2026-11-03 (5), 2026-10-06 (7) and 2025-10-02 (11); today is 2026-11-06.
    expect(total({ field: 'date', op: 'current', values: [], unit: 'month' })).toBe(5);
    expect(previous(1, 'month', false)).toBe(7);
    expect(previous(2, 'month')).toBe(12);
    expect(previous(2, 'year')).toBe(23);
    expect(previous(1, 'year', false)).toBe(11);
    expect(previous(30, 'day')).toBe(5);
    expect(previous(1, 'week')).toBe(5);
    expect(total({ field: 'date', op: 'current', values: [], unit: 'quarter' })).toBe(12);
    expect(previous(2, 'quarter', false)).toBe(0);
    expect(total({ field: 'date', op: 'current', values: [], unit: 'year' })).toBe(12);
  });

  it('date buckets format labels', () => {
    const by = (bucket: 'day' | 'week' | 'quarter' | 'year') =>
      tx({ aggregations: [{ op: 'spending' }], breakouts: [{ field: 'date', bucket }] }).map(
        (row) => Object.values(row)[0]
      );
    expect(by('quarter')).toEqual(['2026-Q1']);
    expect(by('year')).toEqual(['2026']);
    // Empty buckets between the first and last row are filled in.
    expect(by('week')).toEqual([
      '2026-01-05',
      '2026-01-12',
      '2026-01-19',
      '2026-01-26',
      '2026-02-02',
      '2026-02-09',
      '2026-02-16',
      '2026-02-23',
    ]);
    const days = by('day');
    expect(days).toHaveLength(56); // 2026-01-05 … 2026-03-01
    expect(days.slice(0, 2)).toEqual(['2026-01-05', '2026-01-06']);
    expect(days.at(-1)).toBe('2026-03-01');
  });

  it('multiple groupings; limit keeps the top N of the non-date grouping', () => {
    expect(
      tx({
        aggregations: [{ op: 'spending' }],
        breakouts: [{ field: 'category' }, { field: 'date', bucket: 'month' }],
        limit: 2,
      })
    ).toEqual([
      { category: 'Groceries', month: '2026-01', spending: 50 },
      { category: 'Groceries', month: '2026-02', spending: 70 },
      { category: 'Rent', month: '2026-03', spending: 60 },
    ]);
    expect(
      tx({
        aggregations: [{ op: 'spending' }],
        breakouts: [{ field: 'date', bucket: 'month' }, { field: 'category_group' }],
      })
    ).toEqual([
      { month: '2026-01', category_group: 'Living', spending: 50 },
      { month: '2026-02', category_group: 'Living', spending: 110 },
      { month: '2026-03', category_group: 'Living', spending: 60 },
    ]);
  });

  it('sorts by metric or grouping and limits rows', () => {
    const base = {
      aggregations: [{ op: 'spending' as const }],
      breakouts: [{ field: 'category' }],
    };
    expect(
      tx({ ...base, sort: [{ column: 'spending', direction: 'asc' }], limit: 2 }).map(
        (row) => row.category
      )
    ).toEqual(['Fun', 'Rent']);
    expect(
      tx({ ...base, sort: [{ column: 'category', direction: 'desc' }] }).map((row) => row.category)
    ).toEqual(['Rent', 'Groceries', 'Fun']);
  });

  it('raw rows with a column picker, sort and limit', () => {
    expect(tx({ columns: ['date', 'payee', 'category', 'amount'], limit: 2 })).toEqual([
      { date: '2026-03-01', payee: 'Landlord', category: 'Rent', amount: -60 },
      { date: '2026-02-21', payee: 'Lidl', category: 'Groceries', amount: 10 },
    ]);
    expect(
      tx({
        columns: ['payee', 'amount', 'is_transfer'],
        sort: [{ column: 'amount', direction: 'asc' }],
        limit: 1,
      })
    ).toEqual([{ payee: 'Costco', amount: -80, is_transfer: false }]);
  });
});

describe('Budget source', () => {
  const budget = (spec: Partial<QuestionSpec>, budgetId = 1) =>
    query({ source: 'budget', ...spec }, budgetId);

  it('raw rows: assigned and activity per category per month, Income left out', () => {
    expect(budget({})).toEqual([
      {
        month: '2026-03',
        category_group: 'Living',
        category: 'Rent',
        assigned: 600,
        activity: -60,
      },
      { month: '2026-02', category_group: 'Living', category: 'Fun', assigned: 0, activity: -40 },
      {
        month: '2026-02',
        category_group: 'Living',
        category: 'Groceries',
        assigned: 0,
        activity: -70,
      },
      {
        month: '2026-01',
        category_group: 'Living',
        category: 'Groceries',
        assigned: 100,
        activity: -50,
      },
    ]);
  });

  it('summarizes by group and quarter, filters by month and category', () => {
    expect(
      budget({
        aggregations: [
          { op: 'sum', field: 'assigned' },
          { op: 'sum', field: 'activity' },
        ],
        breakouts: [{ field: 'category_group' }, { field: 'month', bucket: 'quarter' }],
      })
    ).toEqual([
      { category_group: 'Living', quarter: '2026-Q1', sum_assigned: 700, sum_activity: -220 },
    ]);
    expect(
      budget({
        filters: [
          { field: 'month', op: 'between', values: ['2026-01-01', '2026-02-28'] },
          { field: 'category', op: 'is', values: [20] },
        ],
        aggregations: [{ op: 'sum', field: 'activity' }],
        breakouts: [{ field: 'month', bucket: 'month' }],
      })
    ).toEqual([
      { month: '2026-01', sum_activity: -50 },
      { month: '2026-02', sum_activity: -70 },
    ]);
  });

  it('scopes assignments to the budget', () => {
    expect(budget({ aggregations: [{ op: 'sum', field: 'assigned' }] }, 2)).toEqual([
      { sum_assigned: 0 },
    ]);
  });
});

describe('Accounts source', () => {
  const accounts = (spec: Partial<QuestionSpec>, budgetId = 1) =>
    query({ source: 'accounts', ...spec }, budgetId);

  it('raw rows with balances computed from transactions', () => {
    expect(
      accounts({
        columns: [
          'account',
          'currency',
          'on_budget',
          'closed',
          'balance',
          'balance_native',
          'transaction_count',
          'last_transaction',
        ],
      })
    ).toEqual([
      {
        account: 'Brokerage',
        currency: 'USD',
        on_budget: false,
        closed: true,
        balance: -70,
        balance_native: -77,
        transaction_count: 1,
        last_transaction: '2026-02-20',
      },
      {
        account: 'Checking',
        currency: 'EUR',
        on_budget: true,
        closed: false,
        balance: 2240,
        balance_native: 2240,
        transaction_count: 6,
        last_transaction: '2026-03-01',
      },
    ]);
  });

  it('summarizes balances by on-budget and filters by type / text', () => {
    expect(
      accounts({
        aggregations: [{ op: 'sum', field: 'balance' }, { op: 'count' }],
        breakouts: [{ field: 'on_budget' }],
        sort: [{ column: 'on_budget', direction: 'asc' }],
      })
    ).toEqual([
      { on_budget: false, sum_balance: -70, count: 1 },
      { on_budget: true, sum_balance: 2240, count: 1 },
    ]);
    expect(
      accounts({
        filters: [{ field: 'account_type', op: 'is', values: ['investment'] }],
        columns: ['account'],
      })
    ).toEqual([{ account: 'Brokerage' }]);
    expect(
      accounts({
        filters: [{ field: 'balance', op: 'gt', values: [0] }],
        columns: ['account'],
      })
    ).toEqual([{ account: 'Checking' }]);
    expect(accounts({ columns: ['account'] }, 3)).toEqual([{ account: 'Daily' }]);
  });
});

describe('legacy v1 builder headers', () => {
  const v1 = (spec: Record<string, unknown>) => {
    const saved = `-- budgero-builder: ${JSON.stringify({ v: 1, dateRange: { preset: 'allTime' }, ...spec })}\nSELECT 1`;
    const upgraded = parseQuestionHeader(saved);
    expect(upgraded).not.toBeNull();
    return query(upgraded!);
  };

  it('run as equivalent v2 questions', () => {
    expect(v1({ measure: 'spending', groupBy: 'category', chartType: 'bar' })).toEqual([
      { category: 'Groceries', spending: 120 },
      { category: 'Rent', spending: 60 },
      { category: 'Fun', spending: 40 },
    ]);
    expect(v1({ measure: 'incomeVsSpending', groupBy: 'month', chartType: 'line' })).toEqual([
      { month: '2026-01', income: 3000, spending: 50 },
      { month: '2026-02', income: 0, spending: 110 },
      { month: '2026-03', income: 0, spending: 60 },
    ]);
    expect(v1({ measure: 'average', chartType: 'stat' })).toEqual([{ average_spending: 55 }]);
    expect(
      v1({ measure: 'spending', groupBy: 'category', splitBy: 'month', limit: 2, chartType: 'bar' })
    ).toEqual([
      { category: 'Groceries', month: '2026-01', spending: 50 },
      { category: 'Groceries', month: '2026-02', spending: 70 },
      { category: 'Rent', month: '2026-03', spending: 60 },
    ]);
    expect(
      v1({ measure: 'spending', groupBy: 'category', includeTransfers: true, chartType: 'bar' })
    ).toContainEqual({ category: 'Uncategorized', spending: 540 });
    expect(
      v1({
        measure: 'spending',
        groupBy: 'month',
        dateRange: { preset: 'custom', from: '2026-02-01', to: '2026-02-28' },
      })
    ).toEqual([{ month: '2026-02', spending: 110 }]);
  });
});

describe('power features', () => {
  // Budget 4: two "Misc" categories in different groups, and no rows in February.
  beforeAll(() => {
    for (const statement of [
      `INSERT INTO budgets VALUES (4, 'Power', 'EUR')`,
      `INSERT INTO accounts VALUES (400, 'Main', 'Checking', 'EUR', 1, NULL, 4, 0, 0)`,
      `INSERT INTO category_groups VALUES (41, 'Home', '', 0, 4), (42, 'Travel', '', 1, 4), (43, 'Income', '', 2, 4)`,
      `INSERT INTO categories VALUES (410, 'Misc', '', 41, 0, 4), (420, 'Misc', '', 42, 0, 4), (421, 'Flights', '', 42, 1, 4), (430, 'Salary', '', 43, 0, 4)`,
      `INSERT INTO transactions VALUES
        (1001, 410, 400, NULL, 4, NULL, 'Shop', '2026-01-10', '', 0, 1, 0, 10000, 0, 10000, 0, 0, 1, 0, 0),
        (1002, 420, 400, NULL, 4, NULL, 'Kiosk', '2026-01-20', '', 0, 1, 0, 20000, 0, 20000, 0, 0, 1, 0, 0),
        (1003, 421, 400, NULL, 4, NULL, 'O''Air', '2026-03-05', '', 0, 0, 0, 300000, 0, 300000, 0, 0, 1, 0, 0),
        (1004, 430, 400, NULL, 4, NULL, 'Employer', '2026-01-01', '', 0, 1, 1000000, 0, 1000000, 0, 0, 0, 1, 0, 0),
        (1005, 430, 400, NULL, 4, NULL, 'Employer', '2026-03-01', '', 0, 1, 1000000, 0, 1000000, 0, 0, 0, 1, 0, 0),
        (1006, 410, 400, NULL, 4, NULL, NULL, '2026-04-02', '', 0, 0, 0, 5000, 0, 5000, 0, 0, 1, 0, 0)`,
    ]) {
      conn.query(statement);
    }
  });

  const power = (spec: Partial<QuestionSpec>) => tx(spec, 4);
  const byMonth = { breakouts: [{ field: 'date', bucket: 'month' as const }] };

  it('keeps same-name categories in different groups apart, labeled with their group', () => {
    const rows = queryWithKeys(
      {
        filters: [NO_TRANSFERS],
        aggregations: [{ op: 'spending' }],
        breakouts: [{ field: 'category' }],
      },
      4
    );
    expect(rows).toEqual([
      { category: 'Flights', spending: 300, category__key: 421 },
      { category: 'Misc (Travel)', spending: 20, category__key: 420 },
      { category: 'Misc (Home)', spending: 15, category__key: 410 },
    ]);
    // Only ambiguous names get the group.
    expect(
      power({
        filters: [{ field: 'category', op: 'is', values: [410, 421] }],
        aggregations: [{ op: 'spending' }],
        breakouts: [{ field: 'category' }],
      })
    ).toEqual([
      { category: 'Flights', spending: 300 },
      { category: 'Misc', spending: 15 },
    ]);
  });

  it('fills empty months with the empty-group value (0 for sums, null for averages)', () => {
    expect(
      power({ aggregations: [{ op: 'spending' }, { op: 'avg', field: 'outflow' }], ...byMonth })
    ).toEqual([
      { month: '2026-01', spending: 30, avg_outflow: 10 }, // salary line has outflow 0
      { month: '2026-02', spending: 0, avg_outflow: null },
      { month: '2026-03', spending: 300, avg_outflow: 150 },
      { month: '2026-04', spending: 5, avg_outflow: 5 },
    ]);
    // A date filter widens the range to its bounds (capped at today).
    const rows = power({
      filters: [{ field: 'date', op: 'between', values: ['2025-12-01', '2026-05-31'] }],
      aggregations: [{ op: 'count' }],
      ...byMonth,
    });
    expect(rows.map((row) => row.month)).toEqual([
      '2025-12',
      '2026-01',
      '2026-02',
      '2026-03',
      '2026-04',
      '2026-05',
    ]);
    expect(rows[0].count).toBe(0);
    // No matching rows at all: no zero-filled months.
    expect(
      power({
        filters: [{ field: 'date', op: 'between', values: ['2020-01-01', '2020-12-31'] }],
        aggregations: [{ op: 'spending' }],
        ...byMonth,
      })
    ).toEqual([]);
  });

  it('running total and moving average carry across empty months', () => {
    expect(
      power({
        aggregations: [
          { op: 'spending', modifier: 'running' },
          { op: 'spending', modifier: 'moving', window: 2 },
        ],
        ...byMonth,
      })
    ).toEqual([
      { month: '2026-01', spending_running_total: 30, spending_moving_avg: 30 },
      { month: '2026-02', spending_running_total: 30, spending_moving_avg: 15 },
      { month: '2026-03', spending_running_total: 330, spending_moving_avg: 150 },
      { month: '2026-04', spending_running_total: 335, spending_moving_avg: 152.5 },
    ]);
  });

  it('running totals per series with two groupings', () => {
    const rows = power({
      aggregations: [{ op: 'spending', modifier: 'running' }],
      breakouts: [{ field: 'date', bucket: 'month' }, { field: 'category_group' }],
    });
    const travel = rows.filter((row) => row.category_group === 'Travel');
    expect(travel.map((row) => [row.month, row.spending_running_total])).toEqual([
      ['2026-01', 20],
      ['2026-02', 20],
      ['2026-03', 320],
      ['2026-04', 320],
    ]);
    expect(rows).toHaveLength(8); // 4 months × 2 groups
  });

  it('compares to the previous period with % change', () => {
    const spec = { aggregations: [{ op: 'spending' as const, compare: true }], ...byMonth };
    expect(questionColumns(normalizeQuestion(spec)).map((column) => column.key)).toEqual([
      'month',
      'spending',
      'spending_previous',
      'spending_change',
    ]);
    const rows = power(spec);
    expect(rows.map((row) => [row.month, row.spending, row.spending_previous])).toEqual([
      ['2026-01', 30, null],
      ['2026-02', 0, 30],
      ['2026-03', 300, 0],
      ['2026-04', 5, 300],
    ]);
    expect(rows.map((row) => row.spending_change)).toEqual([
      null,
      -100,
      null,
      expect.closeTo(-98.333, 2),
    ]);
  });

  it('% of total: of the column, or per date with two groupings', () => {
    const shares = power({
      aggregations: [{ op: 'spending', modifier: 'share' }],
      breakouts: [{ field: 'category_group' }],
    });
    expect(
      shares.map((row) => [row.category_group, Number(row.spending_share).toFixed(2)])
    ).toEqual([
      ['Travel', '95.52'],
      ['Home', '4.48'],
    ]);
    const perMonth = power({
      aggregations: [{ op: 'spending', modifier: 'share' }],
      breakouts: [{ field: 'date', bucket: 'month' }, { field: 'category_group' }],
    });
    const january = perMonth.filter((row) => row.month === '2026-01');
    expect(
      january.map((row) => [row.category_group, Number(row.spending_share).toFixed(1)])
    ).toEqual([
      ['Home', '33.3'],
      ['Travel', '66.7'],
    ]);
  });

  it('custom columns: raw output, grouping and metric input', () => {
    const customColumns = [
      { id: 'expr_1', name: 'Size', expression: 'case(abs([amount]) >= 100, "Big", "Small")' },
      { id: 'expr_2', name: 'Abs', expression: 'abs([amount])' },
      { id: 'expr_3', name: 'Abs x2', expression: '[expr_2] * 2' },
    ];
    expect(
      power({
        customColumns,
        columns: ['payee', 'expr_1', 'expr_3'],
        sort: [{ column: 'expr_3', direction: 'desc' }],
        limit: 3,
      })
    ).toEqual([
      { payee: 'Employer', expr_1: 'Big', expr_3: 2000 },
      { payee: 'Employer', expr_1: 'Big', expr_3: 2000 },
      { payee: "O'Air", expr_1: 'Big', expr_3: 600 },
    ]);
    expect(
      power({
        customColumns,
        filters: [{ field: 'is_income', op: 'is', values: [false] }],
        aggregations: [{ op: 'sum', field: 'expr_2' }, { op: 'count' }],
        breakouts: [{ field: 'expr_1' }],
        sort: [{ column: 'expr_1', direction: 'asc' }],
      })
    ).toEqual([
      { expr_1: 'Big', sum_expr_2: 300, count: 1 },
      { expr_1: 'Small', sum_expr_2: 35, count: 3 },
    ]);
    // Filters on custom columns (used by drill-through).
    expect(
      power({
        customColumns,
        filters: [{ field: 'expr_1', op: 'is', values: ['small'] }],
        aggregations: [{ op: 'count' }],
      })
    ).toEqual([{ count: 3 }]);
  });

  it('custom metrics: conditional sums, budget metric ratios, counts', () => {
    expect(
      power({
        aggregations: [
          {
            op: 'custom',
            name: 'Flights share',
            expression: 'SumIf([outflow], [category] = "flights") / Sum([outflow]) * 100',
          },
          { op: 'custom', name: 'Savings rate', expression: '(Income - Spending) / Income * 100' },
          { op: 'custom', name: 'Cleared', expression: 'CountIf([cleared]) / Count' },
        ],
      })
    ).toEqual([
      {
        custom_flights_share: expect.closeTo(89.552, 2),
        custom_savings_rate: 83.25,
        custom_cleared: expect.closeTo(0.667, 2), // 4 of 6 cleared
      },
    ]);
    // Per month, a month with no income divides by zero → null, not an error.
    const rows = power({
      aggregations: [{ op: 'custom', name: 'Rate', expression: 'Spending / Income * 100' }],
      ...byMonth,
    });
    expect(rows.map((row) => row.custom_rate)).toEqual([3, null, 30, null]);
  });

  it('runs custom expressions with quotes and SQL-looking text safely', () => {
    expect(
      power({
        aggregations: [
          { op: 'custom', name: 'Air', expression: `CountIf([payee] = "O'Air")` },
          {
            op: 'custom',
            name: 'Odd',
            expression: `CountIf([payee] = "x'); DROP TABLE transactions; --")`,
          },
        ],
      })
    ).toEqual([{ custom_air: 1, custom_odd: 0 }]);
    expect(power({ aggregations: [{ op: 'count' }] })).toEqual([{ count: 6 }]);
  });

  it('budget source: custom metric over assigned and activity', () => {
    expect(
      query({
        source: 'budget',
        aggregations: [
          { op: 'custom', name: 'Left', expression: 'Sum([assigned]) + Sum([activity])' },
        ],
      })
    ).toEqual([{ custom_left: 480 }]); // 700 assigned − 220 activity
  });

  describe('drill-through specs run', () => {
    const drill = (
      spec: Partial<QuestionSpec>,
      rowIndex: number,
      action: DrillAction,
      only?: string
    ) => {
      const full = normalizeQuestion({
        source: 'transactions',
        ...spec,
        filters: [NO_TRANSFERS, ...(spec.filters ?? [])],
      });
      const rows = queryWithKeys(full, 4);
      const resultColumns = Object.keys(rows[0]);
      const row = resultColumns.map((key) => rows[rowIndex][key]);
      const values = rowDrillValues(questionColumns(full), resultColumns, row, only);
      return applyDrill({ spec: full, values }, action);
    };

    it('see these transactions: a month bucket of a spending chart', () => {
      const next = drill({ aggregations: [{ op: 'spending' }], ...byMonth }, 0, {
        kind: 'records',
      });
      expect(next.filters).toContainEqual({
        field: 'date',
        op: 'between',
        values: ['2026-01-01', '2026-01-31'],
      });
      // Spending leaves income lines out, so the salary isn't listed.
      expect(query(next, 4).map((row) => row.payee)).toEqual(['Kiosk', 'Shop']);
    });

    it('see these transactions: one of two same-name categories', () => {
      const spec = {
        aggregations: [{ op: 'spending' as const }],
        breakouts: [{ field: 'category' }],
      };
      const next = drill(spec, 1, { kind: 'records' }); // Misc (Travel)
      expect(next.filters).toContainEqual({ field: 'category', op: 'is', values: [420] });
      expect(query(next, 4).map((row) => row.payee)).toEqual(['Kiosk']);
    });

    it('zoom: a quarter into months', () => {
      const next = drill(
        { aggregations: [{ op: 'spending' }], breakouts: [{ field: 'date', bucket: 'quarter' }] },
        0,
        { kind: 'zoom', key: 'quarter' }
      );
      expect(next.breakouts).toEqual([{ field: 'date', bucket: 'month' }]);
      expect(query(next, 4)).toEqual([
        { month: '2026-01', spending: 30 },
        { month: '2026-02', spending: 0 },
        { month: '2026-03', spending: 300 },
      ]);
    });

    it('break out a month by category; filter to / exclude a category', () => {
      const monthly = { aggregations: [{ op: 'spending' as const }], ...byMonth };
      const byCategory = drill(monthly, 0, { kind: 'breakout', field: 'category' });
      expect(query(byCategory, 4)).toEqual([
        { category: 'Misc (Travel)', spending: 20 },
        { category: 'Misc (Home)', spending: 10 },
      ]);
      const categories = {
        aggregations: [{ op: 'spending' as const }],
        breakouts: [{ field: 'category' }],
      };
      const only = drill(categories, 2, { kind: 'filter', key: 'category' }); // Misc (Home)
      expect(query(only, 4)).toEqual([{ category: 'Misc', spending: 15 }]);
      const without = drill(categories, 0, { kind: 'filter', key: 'category', exclude: true });
      expect(query(without, 4).map((row) => row.category)).toEqual([
        'Misc (Travel)',
        'Misc (Home)',
      ]);
    });

    it('payees without a name drill to "is empty"', () => {
      const spec = { aggregations: [{ op: 'count' as const }], breakouts: [{ field: 'payee' }] };
      const rows = queryWithKeys(normalizeQuestion({ ...spec, filters: [NO_TRANSFERS] }), 4);
      const index = rows.findIndex((row) => row.payee__key === null);
      expect(rows[index].payee).toBe('No payee');
      const next = drill(spec, index, { kind: 'records' });
      expect(next.filters).toContainEqual({ field: 'payee', op: 'isEmpty', values: [] });
      expect(query(next, 4)).toHaveLength(1);
    });

    it('custom column groupings drill too', () => {
      const spec = {
        customColumns: [
          { id: 'expr_1', name: 'Size', expression: 'case(abs([amount]) >= 100, "Big", "Small")' },
        ],
        aggregations: [{ op: 'count' as const }],
        breakouts: [{ field: 'expr_1' }],
        sort: [{ column: 'expr_1', direction: 'asc' as const }],
      };
      const next = drill(spec, 1, { kind: 'records' }); // Small
      expect(next.filters).toContainEqual({ field: 'expr_1', op: 'is', values: ['Small'] });
      expect(next.columns).toContain('expr_1');
      expect(query(next, 4)).toHaveLength(3);
    });
  });
});
