import { describe, it, expect, beforeAll } from 'vitest';
import path from 'node:path';
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import { NodeSqlJsAdapter, ServiceManager, DatabaseAdapter } from '../src';
import { asMilli } from '../src/money/index.js';
import { WebDatabaseAdapter } from '../src/database/web-adapter.js';
import { readAllRows, readRow } from '../src/database/sqljs-rows.js';

// all()/get() build rows from get() + column names read once per statement. These tests pin
// that the objects are exactly what sql.js getAsObject() returned per row before: same keys in
// the same order (incl. duplicated names in joins), same value types (number, string, null,
// Uint8Array; never bigint), same prototype.

type Row = Record<string, unknown>;

/** Strict comparison: key order, typeof, Object.is for primitives, byte-exact blobs. */
function expectIdentical(actual: Row[], expected: Row[]): void {
  expect(actual.length).toBe(expected.length);
  for (let r = 0; r < expected.length; r += 1) {
    const a = actual[r];
    const e = expected[r];
    // A column named __proto__ goes through the prototype setter in getAsObject too; then the
    // prototype is that row's value (a fresh object per row), so compare it as a value.
    const ap: unknown = Object.getPrototypeOf(a);
    const ep: unknown = Object.getPrototypeOf(e);
    if (ep === Object.prototype || ep === null) expect(ap).toBe(ep);
    else {
      expect(ep).toBeInstanceOf(Uint8Array);
      expect(ap).toBeInstanceOf(Uint8Array);
      expect(Array.from(ap as Uint8Array)).toEqual(Array.from(ep as Uint8Array));
    }
    expect(Object.keys(a)).toEqual(Object.keys(e));
    for (const k of Object.keys(e)) {
      const av = a[k];
      const ev = e[k];
      expect(typeof av).toBe(typeof ev);
      if (ev instanceof Uint8Array) {
        expect(av).toBeInstanceOf(Uint8Array);
        expect(Array.from(av as Uint8Array)).toEqual(Array.from(ev));
      } else {
        expect(Object.is(av, ev)).toBe(true);
      }
    }
  }
}

/** Copy a row as returned (services post-process rows in place); keeps key order and prototype. */
function snapshotRow(row: Row): Row {
  const copy = Object.create(Object.getPrototypeOf(row)) as Row;
  for (const k of Object.keys(row)) copy[k] = row[k];
  return copy;
}

function referenceAll(db: Database, sql: string, params: unknown[] = []): Row[] {
  const stmt = db.prepare(sql);
  stmt.bind(params as never);
  const rows: Row[] = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function referenceGet(db: Database, sql: string, params: unknown[] = []): Row | undefined {
  const stmt = db.prepare(sql);
  stmt.bind(params as never);
  const row = stmt.step() ? stmt.getAsObject() : undefined;
  stmt.free();
  return row;
}

const FIXTURE = `
  CREATE TABLE a (ID INTEGER PRIMARY KEY, Name TEXT, Amount INTEGER, Rate REAL, Data BLOB, Mixed);
  CREATE TABLE b (ID INTEGER PRIMARY KEY, AID INTEGER, Name TEXT, Amount INTEGER);
  INSERT INTO a VALUES
    (1, 'Plain', 100, 1.5, x'00ff10', 1),
    (2, 'Ünïcödé ✓ 😀', -250, 0.1, x'', 'text'),
    (3, '', 0, -0.0, NULL, NULL),
    (4, NULL, 9007199254740993, 1e300, x'deadbeef', 2.75),
    (5, 'Last', -9223372036854775808, -1e-300, x'01', x'0203');
  INSERT INTO b VALUES (10, 1, 'b-one', 7), (11, 1, 'b-two', NULL), (12, 2, NULL, 9), (13, 9, 'orphan', 1);
`;

const QUERIES: [string, string, unknown[]?][] = [
  ['every type', 'SELECT * FROM a ORDER BY ID'],
  ['no rows', 'SELECT * FROM a WHERE ID < 0'],
  ['bound params', 'SELECT ID, Name FROM a WHERE ID >= ? AND Name IS NOT ?', [2, 'Last']],
  [
    'join, SELECT * duplicates ID/Name/Amount',
    'SELECT * FROM a LEFT JOIN b ON b.AID = a.ID ORDER BY a.ID, b.ID',
  ],
  [
    'explicit duplicates keep first position, last value',
    'SELECT a.ID, b.ID, a.Name, b.Name AS Name, 1 AS ID FROM a JOIN b ON b.AID = a.ID ORDER BY b.ID',
  ],
  ['case-distinct names', 'SELECT 1 AS x, 2 AS X, 3 AS "x "'],
  [
    'integer-like and odd names',
    `SELECT 1 AS "2", 2 AS "1", 3 AS "", 4 AS "toString", 5 AS "😀", 6 AS "a.b"`,
  ],
  ['__proto__ column', 'SELECT 1 AS "__proto__", 2 AS y'],
  ['__proto__ object value', 'SELECT 1 AS y, Data AS "__proto__" FROM a WHERE ID = 1'],
  ['expressions without alias', "SELECT 1+1, 'a' || 'b', NULL, x'ff', 2.0 * 3, COUNT(*) FROM a"],
  ['mixed affinity per row', 'SELECT Mixed FROM a ORDER BY ID'],
  ['aggregates over nothing', 'SELECT SUM(Amount), MAX(Name), COUNT(*) AS n FROM a WHERE 0'],
  [
    'large result',
    "WITH RECURSIVE r(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM r WHERE i < 5000) SELECT i, i * 0.5 AS half, 'row ' || i AS label, CASE WHEN i % 3 = 0 THEN NULL ELSE i END AS maybe FROM r",
  ],
];

describe('sql.js row materialisation matches getAsObject()', () => {
  let SQL: SqlJsStatic;
  let db: Database;

  beforeAll(async () => {
    SQL = await initSqlJs({
      locateFile: (file: string) =>
        path.join(process.cwd(), 'node_modules', 'sql.js', 'dist', file),
    });
    db = new SQL.Database();
    db.exec(FIXTURE);
  });

  for (const [name, sql, params = []] of QUERIES) {
    it(`readAllRows / readRow: ${name}`, () => {
      const expected = referenceAll(db, sql, params);

      const stmt = db.prepare(sql);
      stmt.bind(params as never);
      const actual = readAllRows(stmt);
      stmt.free();
      expectIdentical(actual, expected);

      const one = db.prepare(sql);
      one.bind(params as never);
      const first = one.step() ? readRow(one) : undefined;
      one.free();
      const expectedFirst = referenceGet(db, sql, params);
      if (expectedFirst === undefined) expect(first).toBeUndefined();
      else expectIdentical([first as Row], [expectedFirst]);
    });
  }

  it('never yields bigint and keeps getAsObject precision loss for huge integers', () => {
    const rows = readAllRows(db.prepare('SELECT Amount FROM a WHERE ID IN (4, 5) ORDER BY ID'));
    expect(rows.map((r) => typeof r.Amount)).toEqual(['number', 'number']);
    expectIdentical(rows, referenceAll(db, 'SELECT Amount FROM a WHERE ID IN (4, 5) ORDER BY ID'));
  });
});

describe('NodeSqlJsAdapter.prepare().all()/get() match getAsObject()', () => {
  it('on fixture queries', async () => {
    const adapter = await NodeSqlJsAdapter.create();
    adapter.exec(FIXTURE);
    const raw = (adapter as unknown as { db: Database }).db;
    for (const [, sql, params = []] of QUERIES) {
      const stmt = adapter.prepare(sql);
      expectIdentical(stmt.all(...params) as Row[], referenceAll(raw, sql, params));
      const got = stmt.get(...params) as Row | undefined;
      const exp = referenceGet(raw, sql, params);
      if (exp === undefined) expect(got).toBeUndefined();
      else expectIdentical([got as Row], [exp]);
    }
  });

  it('on real service queries (register joins, budget, accounts)', async () => {
    const adapter = await NodeSqlJsAdapter.create();
    const sm = new ServiceManager();
    await sm.initialize(adapter as DatabaseAdapter);
    const services = sm.getServices();
    const budgetId = await services.budgets.createBudget({
      name: 'Rows',
      display_currency: 'USD',
      badge_icon: 'dollar',
      number_format: '123,456.78',
      create_default_categories: true,
    });
    const checking = await services.accounts.createAccount(
      'Checking',
      budgetId,
      'checking',
      'USD',
      0
    );
    const savings = await services.accounts.createAccount(
      'Savings ✓',
      budgetId,
      'savings',
      'USD',
      0
    );
    const groupId = services.categories.addCategoryGroup('Group', budgetId);
    const categoryId = services.categories.addCategory(groupId, budgetId, 'Food 🍕');
    for (let i = 1; i <= 24; i += 1) {
      await services.transactions.addTransaction(
        asMilli(i % 4 === 0 ? 5000 * i : 0),
        asMilli(i % 4 === 0 ? 0 : 3000 * i),
        i % 3 === 0 ? savings.ID : checking.ID,
        categoryId,
        budgetId,
        `2026-0${1 + (i % 9)}-1${i % 10}`,
        i % 5 === 0 ? '' : `memo ${i} ✓`,
        '',
        i % 2 ? `Payee ${i % 7}` : undefined
      );
    }

    const raw = (adapter as unknown as { db: Database }).db;
    const calls: { kind: 'all' | 'get'; sql: string; params: unknown[]; result: unknown }[] = [];
    const original = adapter.prepare.bind(adapter);
    adapter.prepare = (sql: string) => {
      const stmt = original(sql);
      return {
        ...stmt,
        all: (...params: unknown[]) => {
          const result = stmt.all(...params);
          calls.push({ kind: 'all', sql, params, result: (result as Row[]).map(snapshotRow) });
          return result;
        },
        get: (...params: unknown[]) => {
          const result = stmt.get(...params);
          calls.push({ kind: 'get', sql, params, result: result && snapshotRow(result as Row) });
          return result;
        },
      };
    };
    services.transactions.getTransactionsByAccount(checking.ID);
    services.transactions.getAllTransactionsDetailed(budgetId);
    services.accounts.listAccounts(budgetId);
    services.monthlyBudgets.getMonthlyBudget('2026-05', budgetId);
    services.transactions.getTransactionsByAccountAndMonth(checking.ID, '2026-05');
    adapter.prepare = original;

    expect(calls.some((c) => c.kind === 'all' && (c.result as Row[]).length >= 16)).toBe(true);
    for (const c of calls) {
      expect(/^\s*(with|select)/i.test(c.sql)).toBe(true); // safe to re-run
      if (c.kind === 'all') expectIdentical(c.result as Row[], referenceAll(raw, c.sql, c.params));
      else {
        const exp = referenceGet(raw, c.sql, c.params);
        if (exp === undefined) expect(c.result).toBeUndefined();
        else expectIdentical([c.result as Row], [exp]);
      }
    }
  });
});

describe('WebDatabaseAdapter.prepare().all()/get() match getAsObject()', () => {
  it('on fixture queries', async () => {
    const SQL = await initSqlJs({
      locateFile: (file: string) =>
        path.join(process.cwd(), 'node_modules', 'sql.js', 'dist', file),
    });
    const db = new SQL.Database();
    db.exec(FIXTURE);
    const adapter = Object.create(WebDatabaseAdapter.prototype) as WebDatabaseAdapter;
    (adapter as unknown as { db: Database }).db = db;
    for (const [, sql, params = []] of QUERIES) {
      const stmt = adapter.prepare(sql);
      expectIdentical(stmt.all(...params) as Row[], referenceAll(db, sql, params));
      const got = stmt.get(...params) as Row | undefined;
      const exp = referenceGet(db, sql, params);
      if (exp === undefined) expect(got).toBeUndefined();
      else expectIdentical([got as Row], [exp]);
    }
  });
});
