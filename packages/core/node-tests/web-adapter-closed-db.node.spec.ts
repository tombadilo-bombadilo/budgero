import { describe, it, expect } from 'vitest';
import path from 'node:path';
import initSqlJs, { type Database } from 'sql.js';
import { DatabaseError } from '../src/database/interface.js';
import { WebDatabaseAdapter } from '../src/database/web-adapter.js';

// A workspace switch closes the old sql.js database. sql.js then throws the bare
// string "Database closed"; the browser adapter must report that as the
// `closed` failure class, not the catch-all `error` (PostHog db_error, triage #4).

async function closedAdapter(): Promise<WebDatabaseAdapter> {
  const SQL = await initSqlJs({
    locateFile: (file: string) => path.join(process.cwd(), 'node_modules', 'sql.js', 'dist', file),
  });
  const db = new SQL.Database();
  db.exec('CREATE TABLE t (id INTEGER)');
  const adapter = Object.create(WebDatabaseAdapter.prototype) as WebDatabaseAdapter;
  (adapter as unknown as { db: Database; fkCheckCounter: number }).db = db;
  (adapter as unknown as { fkCheckCounter: number }).fkCheckCounter = 0;
  db.close();
  return adapter;
}

function thrown(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error('expected a throw');
}

describe('WebDatabaseAdapter on a closed database', () => {
  it('classifies queries as closed', async () => {
    const adapter = await closedAdapter();
    for (const run of [
      () => adapter.prepare('SELECT * FROM t').all(),
      () => adapter.prepare('SELECT * FROM t').get(),
      () => adapter.prepare('INSERT INTO t VALUES (1)').run(),
      () => adapter.exec('SELECT 1'),
    ]) {
      const error = thrown(run);
      expect(error).toBeInstanceOf(DatabaseError);
      expect((error as DatabaseError).code).toBe('closed');
    }
  });
});
