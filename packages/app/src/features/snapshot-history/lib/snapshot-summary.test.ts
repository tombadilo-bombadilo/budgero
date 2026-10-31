import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { SqlJsStatic } from '@shared/lib/sql/load-sql-js';
import { summarizeSnapshot } from './snapshot-summary';

// The same sql.js build the app serves from /sql.js/ (a UMD script; the app
// package is ESM, so it is evaluated as CommonJS by hand).
const SQL_JS_DIR = path.resolve(__dirname, '../../../../public/sql.js');
type TestSqlJs = {
  Database: new (data?: Uint8Array) => {
    exec(sql: string): unknown;
    export(): Uint8Array;
    close(): void;
  };
};
type InitSqlJs = (config: { wasmBinary: Uint8Array }) => Promise<TestSqlJs>;
function loadInitSqlJs(): InitSqlJs {
  const mod: { exports: unknown } = { exports: {} };

  new Function(
    'module',
    'exports',
    'require',
    '__dirname',
    '__filename',
    readFileSync(path.join(SQL_JS_DIR, 'sql-wasm.js'), 'utf8')
  )(mod, mod.exports, () => ({}), SQL_JS_DIR, path.join(SQL_JS_DIR, 'sql-wasm.js'));
  return mod.exports as InitSqlJs;
}
const initSqlJs = loadInitSqlJs();
const loadSql = () =>
  initSqlJs({ wasmBinary: new Uint8Array(readFileSync(path.join(SQL_JS_DIR, 'sql-wasm.wasm'))) });

vi.mock('@shared/lib/sql/load-sql-js', () => ({
  loadSqlJs: async () => (await loadSql()) as unknown as SqlJsStatic,
}));

async function snapshotBytes(withData: boolean): Promise<Uint8Array> {
  const SQL = await loadSql();
  const db = new SQL.Database();
  db.exec(`
    CREATE TABLE budgets (ID INTEGER PRIMARY KEY, Name TEXT);
    CREATE TABLE accounts (ID INTEGER PRIMARY KEY, BudgetID INTEGER);
    CREATE TABLE categories (ID INTEGER PRIMARY KEY);
    CREATE TABLE transactions (ID INTEGER PRIMARY KEY, Date TEXT, BudgetID INTEGER);
    INSERT INTO budgets (Name) VALUES ('B');
  `);
  if (withData) {
    db.exec(`
      INSERT INTO accounts (BudgetID) VALUES (1), (1);
      INSERT INTO categories DEFAULT VALUES;
      INSERT INTO transactions (Date, BudgetID) VALUES ('2026-10-01', 1), ('2026-10-30T12:00:00', 1);
    `);
  }
  const bytes = db.export();
  db.close();
  return bytes;
}

describe('summarizeSnapshot', () => {
  it('counts what a snapshot holds', async () => {
    expect(await summarizeSnapshot(await snapshotBytes(true))).toEqual({
      budgets: 1,
      accounts: 2,
      categories: 1,
      transactions: 2,
      lastTransactionDate: '2026-10-30',
    });
  });

  it('reports an empty snapshot as zeros', async () => {
    expect(await summarizeSnapshot(await snapshotBytes(false))).toMatchObject({
      transactions: 0,
      accounts: 0,
      lastTransactionDate: null,
    });
  });
});
