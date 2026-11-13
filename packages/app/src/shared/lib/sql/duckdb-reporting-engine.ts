/**
 * DuckDB-wasm setup for reports; the snapshot logic (copy, views, derived
 * tables, locking) lives in reporting-snapshot.ts.
 */
import * as duckdb from '@duckdb/duckdb-wasm';
import duckdbWasmMvp from '@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url';
import duckdbWorkerMvp from '@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url';
import duckdbWasmEh from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url';
import duckdbWorkerEh from '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url';
import { getRuntime } from '@shared/runtime/global';
import { getTodayISO } from '@shared/lib/date-utils';
import type { QueryResult } from './report-query-executor';
import {
  DEFAULT_MAX_ROWS,
  ReportingSnapshot,
  quoteIdentifier,
  type ReportingDuckDb,
  type ReportingSqlDatabase,
} from './reporting-snapshot';

export type { ReportingSqlDatabase, ReportingSqlStatement } from './reporting-snapshot';
export { DEFAULT_MAX_ROWS };

const DUCKDB_BUNDLES: duckdb.DuckDBBundles = {
  mvp: {
    mainModule: duckdbWasmMvp,
    mainWorker: duckdbWorkerMvp,
  },
  eh: {
    mainModule: duckdbWasmEh,
    mainWorker: duckdbWorkerEh,
  },
};

let duckDb: duckdb.AsyncDuckDB | null = null;
let duckDbConnection: duckdb.AsyncDuckDBConnection | null = null;
let initializationPromise: Promise<void> | null = null;
let tempFiles = 0;

/** Single-quoted SQL string literal (struct keys, type names, file paths). */
function quoteJsonKey(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

async function ensureInitialized(): Promise<void> {
  if (duckDb && duckDbConnection) return;
  if (initializationPromise) {
    await initializationPromise;
    return;
  }

  initializationPromise = (async () => {
    if (typeof Worker === 'undefined') {
      throw new Error('DuckDB reporting requires Worker support');
    }

    const bundle = await duckdb.selectBundle(DUCKDB_BUNDLES);
    if (!bundle.mainWorker) {
      throw new Error('DuckDB worker bundle is not available');
    }
    const worker = new Worker(bundle.mainWorker);
    const logger = new duckdb.VoidLogger();

    const instance = new duckdb.AsyncDuckDB(logger, worker);
    await instance.instantiate(bundle.mainModule, bundle.pthreadWorker);

    duckDb = instance;
    duckDbConnection = await instance.connect();

    // DuckDB ≥ 0.10 dropped implicit VARCHAR↔DATE casting, which breaks
    // AI-generated and saved report SQL that compares the analytics views'
    // TEXT date columns against DATE literals (`t.date >= DATE '2025-06-01'`
    // → binder error). Restore the old casting behavior — this is a
    // read-only reporting surface, so the looser casts carry no integrity
    // risk. Guarded: if a future DuckDB removes the setting, init must
    // still succeed (the AI prompt also steers away from DATE literals).
    try {
      await duckDbConnection.query(`SET old_implicit_casting = true`);
    } catch (error) {
      console.warn('[DuckDB] old_implicit_casting unavailable; DATE-literal SQL may fail', error);
    }
  })();

  try {
    await initializationPromise;
  } finally {
    initializationPromise = null;
  }
}

function connection(): duckdb.AsyncDuckDBConnection {
  if (!duckDb || !duckDbConnection) throw new Error('DuckDB is not initialized');
  return duckDbConnection;
}

const wasmDuckDb: ReportingDuckDb = {
  query: (sql) => connection().query(sql),
  async insertRows(table, columns, rows) {
    const conn = connection();
    tempFiles += 1;
    const file = `snapshot_${tempFiles}.json`;
    await duckDb!.registerFileText(file, JSON.stringify(rows));
    try {
      // Explicit column types: read_json's auto-detection infers UNSIGNED
      // integers from non-negative samples and then fails on a negative value.
      const struct = columns
        .map((c) => `${quoteJsonKey(c.name)}: ${quoteJsonKey(c.type)}`)
        .join(', ');
      await conn.query(
        `INSERT INTO ${quoteIdentifier(table)} SELECT * FROM read_json(${quoteJsonKey(
          file
        )}, format='array', columns={${struct}})`
      );
    } finally {
      await duckDb!.dropFile(file).catch(() => undefined);
    }
  },
};

const snapshot = new ReportingSnapshot(wasmDuckDb, {
  today: getTodayISO,
  services: () => getRuntime()?.services() ?? null,
});

export async function executeDuckDbReportQuery(
  query: string,
  sqliteDb: ReportingSqlDatabase,
  options?: { maxRows?: number }
): Promise<QueryResult> {
  await ensureInitialized();
  return snapshot.execute(query, sqliteDb, options);
}
