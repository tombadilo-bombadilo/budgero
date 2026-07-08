import { DatabaseAdapter } from './interface.js';

/**
 * Thin wrappers around the `prepare → get/all/run → finalize` dance repeated
 * at every query site. `finalize()` is a documented no-op in both adapters
 * (statements are freed per operation), but the helpers still call it for
 * fidelity with the `Statement` contract.
 */

/** Prepares `sql`, fetches the first row (or `undefined`), finalizes. */
export function getRow<T = unknown>(
  db: DatabaseAdapter,
  sql: string,
  ...params: any[]
): T | undefined {
  const stmt = db.prepare(sql);
  const row = stmt.get(...params) as T | undefined;
  stmt.finalize();
  return row;
}

/** Prepares `sql`, fetches all rows, finalizes. Always returns an array. */
export function allRows<T = unknown>(db: DatabaseAdapter, sql: string, ...params: any[]): T[] {
  const stmt = db.prepare(sql);
  const rows = stmt.all(...params) as T[];
  stmt.finalize();
  return rows || [];
}

/** Prepares `sql`, runs it, finalizes. Returns the adapter's run result. */
export function run(
  db: DatabaseAdapter,
  sql: string,
  ...params: any[]
): { lastInsertRowid: number | bigint; changes: number } {
  const stmt = db.prepare(sql);
  const result = stmt.run(...params);
  stmt.finalize();
  return result;
}
