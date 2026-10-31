import { loadSqlJs, type SqlJsDatabase } from '@shared/lib/sql/load-sql-js';

/** What a decrypted snapshot contains, counted on the device. */
export interface SnapshotSummary {
  budgets: number;
  accounts: number;
  categories: number;
  transactions: number;
  /** Date of the newest transaction (YYYY-MM-DD), null when there are none. */
  lastTransactionDate: string | null;
}

function scalar(db: SqlJsDatabase, sql: string): unknown {
  try {
    return db.exec(sql)[0]?.values[0]?.[0] ?? null;
  } catch {
    // Missing table in an old or empty snapshot.
    return null;
  }
}

/**
 * Open a decrypted snapshot in an in-memory sql.js database (never persisted,
 * never the live one), count what it holds, close it.
 */
export async function summarizeSnapshot(bytes: Uint8Array): Promise<SnapshotSummary> {
  const SQL = await loadSqlJs();
  const db = new SQL.Database(bytes);
  try {
    const count = (table: string) => Number(scalar(db, `SELECT count(*) FROM ${table}`) ?? 0);
    const last = scalar(db, 'SELECT max(substr(Date, 1, 10)) FROM transactions');
    return {
      budgets: count('budgets'),
      accounts: count('accounts'),
      categories: count('categories'),
      transactions: count('transactions'),
      lastTransactionDate: typeof last === 'string' ? last : null,
    };
  } finally {
    db.close();
  }
}
