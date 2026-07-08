import * as duckdb from '@duckdb/duckdb-wasm';
import duckdbWasmMvp from '@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url';
import duckdbWorkerMvp from '@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url';
import duckdbWasmEh from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url';
import duckdbWorkerEh from '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url';
import type { QueryResult } from './report-query-executor';

export interface ReportingSqlStatement {
  all(): Record<string, unknown>[];
  get(): Record<string, unknown> | undefined;
  finalize(): void;
}

export interface ReportingSqlDatabase {
  prepare(sql: string): ReportingSqlStatement;
}

interface SQLiteTableColumnRow {
  name: string;
  type: string;
}

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

export const DEFAULT_MAX_ROWS = 10_000;

let duckDb: duckdb.AsyncDuckDB | null = null;
let duckDbConnection: duckdb.AsyncDuckDBConnection | null = null;
let initializationPromise: Promise<void> | null = null;
let snapshotPromise: Promise<void> | null = null;
let snapshotVersion = 0;

function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

/** Single-quoted SQL string literal (struct keys, type names, file paths). */
function quoteJsonKey(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function sanitizeTempFileName(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function normalizeBigInt(value: bigint): number | string {
  const asNumber = Number(value);
  return Number.isSafeInteger(asNumber) ? asNumber : value.toString();
}

function normalizeDuckDbValue(value: unknown): unknown {
  if (typeof value === 'bigint') {
    return normalizeBigInt(value);
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return value;
}

function normalizeForJson(value: unknown): unknown {
  if (typeof value === 'bigint') {
    return normalizeBigInt(value);
  }
  if (value instanceof Uint8Array) {
    return Array.from(value);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeForJson(entry));
  }
  if (value && typeof value === 'object') {
    const normalized: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      normalized[key] = normalizeForJson(nested);
    }
    return normalized;
  }
  return value;
}

function mapSQLiteTypeToDuckDb(type: string): string {
  const normalizedType = String(type ?? '')
    .trim()
    .toUpperCase();
  if (!normalizedType) return 'VARCHAR';
  if (normalizedType.includes('INT')) return 'BIGINT';
  if (
    normalizedType.includes('REAL') ||
    normalizedType.includes('FLOA') ||
    normalizedType.includes('DOUB') ||
    normalizedType.includes('NUM') ||
    normalizedType.includes('DEC')
  ) {
    return 'DOUBLE';
  }
  // SQLite stores booleans as 0/1 integers and the analytics views query them
  // that way (e.g. `account_on_budget = 1`); keep them numeric.
  if (normalizedType.includes('BOOL')) return 'BIGINT';
  if (normalizedType.includes('BLOB')) return 'BLOB';
  return 'VARCHAR';
}

function stripTrailingSemicolon(query: string): string {
  return query.replace(/;\s*$/, '').trim();
}

function extractLimit(query: string): number | null {
  const limitMatch = query.match(/\bLIMIT\s+(\d+)/i);
  return limitMatch ? parseInt(limitMatch[1], 10) : null;
}

function applyQueryLimit(
  query: string,
  maxRows: number
): { query: string; userLimit: number | null; effectiveLimit: number } {
  const userLimit = extractLimit(query);
  const effectiveLimit = userLimit === null ? maxRows : Math.min(userLimit, maxRows);

  if (userLimit === null) {
    return {
      query: `${query} LIMIT ${effectiveLimit}`,
      userLimit: null,
      effectiveLimit,
    };
  }

  if (userLimit > maxRows) {
    return {
      query: query.replace(/\bLIMIT\s+\d+/i, `LIMIT ${effectiveLimit}`),
      userLimit,
      effectiveLimit,
    };
  }

  return { query, userLimit, effectiveLimit };
}

function createCountQuery(query: string): string {
  const queryWithoutLimit = query.replace(/\bLIMIT\s+\d+/i, '');
  return `SELECT COUNT(*) as count FROM (${queryWithoutLimit}) as subquery`;
}

function querySupportsAutomaticLimit(query: string): boolean {
  const normalized = query.trim().toLowerCase();
  return normalized.startsWith('select') || normalized.startsWith('with');
}

function arrowTableToRows(table: Awaited<ReturnType<duckdb.AsyncDuckDBConnection['query']>>): {
  columns: string[];
  rows: unknown[][];
} {
  const columns = table.schema.fields.map((field) => field.name);
  const objectRows = table.toArray() as Record<string, unknown>[];
  const rows = objectRows.map((row) =>
    columns.map((columnName) => normalizeDuckDbValue(row[columnName]))
  );
  return { columns, rows };
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
  })();

  try {
    await initializationPromise;
  } finally {
    initializationPromise = null;
  }
}

async function listDuckDbBaseTables(connection: duckdb.AsyncDuckDBConnection): Promise<string[]> {
  const table = await connection.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'main' AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `);
  const rows = table.toArray() as Record<string, unknown>[];
  return rows.map((row) => String(row.table_name ?? ''));
}

async function listDuckDbViews(connection: duckdb.AsyncDuckDBConnection): Promise<string[]> {
  const table = await connection.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'main' AND table_type = 'VIEW'
    ORDER BY table_name
  `);
  const rows = table.toArray() as Record<string, unknown>[];
  return rows.map((row) => String(row.table_name ?? ''));
}

function listSQLiteTables(sqliteDb: ReportingSqlDatabase): string[] {
  const tablesStmt = sqliteDb.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  `);
  const tableRows = tablesStmt.all();
  tablesStmt.finalize();
  return tableRows
    .map((row) => String((row as Record<string, unknown>).name ?? ''))
    .filter((name) => name.length > 0);
}

function getSQLiteTableColumns(
  sqliteDb: ReportingSqlDatabase,
  tableName: string
): SQLiteTableColumnRow[] {
  const pragmaStmt = sqliteDb.prepare(`PRAGMA table_info(${quoteIdentifier(tableName)})`);
  const columns = pragmaStmt.all();
  pragmaStmt.finalize();
  return columns
    .map((column) => ({
      name: String((column as Record<string, unknown>).name ?? ''),
      type: String((column as Record<string, unknown>).type ?? ''),
    }))
    .filter((column) => column.name.length > 0);
}

function getSQLiteTableRows(
  sqliteDb: ReportingSqlDatabase,
  tableName: string
): Record<string, unknown>[] {
  const rowsStmt = sqliteDb.prepare(`SELECT * FROM ${quoteIdentifier(tableName)}`);
  const rows = rowsStmt.all();
  rowsStmt.finalize();
  return rows as Record<string, unknown>[];
}

async function registerPrebuiltAnalyticsViews(
  connection: duckdb.AsyncDuckDBConnection
): Promise<void> {
  await connection.query(`
    CREATE OR REPLACE VIEW transactions_analytics AS
    WITH split_stats AS (
      SELECT
        "TransactionID" AS transaction_id,
        COUNT(*) AS split_count,
        -- Stored amounts are integer milliunits; analytics keeps exact
        -- DECIMAL currency units so saved reports and AI SQL stay decimal
        CAST(COALESCE(SUM("Inflow"), 0) / 1000.0 AS DECIMAL(18, 3)) AS split_inflow,
        CAST(COALESCE(SUM("Outflow"), 0) / 1000.0 AS DECIMAL(18, 3)) AS split_outflow
      FROM transaction_splits
      GROUP BY "TransactionID"
    ),
    tx_normalized AS (
      SELECT
        t.*,
        COALESCE(
          TRY_CAST(t."Date" AS DATE),
          TRY_CAST(to_timestamp(TRY_CAST(t."Date" AS DOUBLE) / 1000) AS DATE),
          TRY_CAST(to_timestamp(TRY_CAST(t."Date" AS DOUBLE)) AS DATE),
          TRY_CAST(SUBSTR(CAST(t."Date" AS VARCHAR), 1, 10) AS DATE)
        ) AS parsed_date
      FROM transactions t
    )
    SELECT
      t."ID" AS transaction_id,
      t."CategoryID" AS category_id,
      t."AccountID" AS account_id,
      t."LabelID" AS label_id,
      t."BudgetID" AS budget_id,
      t."TransferID" AS transfer_id,
      t."Payee" AS payee,
      strftime(t.parsed_date, '%Y-%m-%d') AS date,
      strftime(DATE_TRUNC('week', t.parsed_date), '%Y-%m-%d') AS week,
      strftime(DATE_TRUNC('month', t.parsed_date), '%Y-%m-%d') AS month,
      strftime(DATE_TRUNC('quarter', t.parsed_date), '%Y-%m-%d') AS quarter,
      strftime(DATE_TRUNC('year', t.parsed_date), '%Y-%m-%d') AS year,
      t."Memo" AS memo,
      t."Reconciled" AS reconciled,
      CAST(t."Inflow" / 1000.0 AS DECIMAL(18, 3)) AS inflow,
      CAST(t."Outflow" / 1000.0 AS DECIMAL(18, 3)) AS outflow,
      CAST(t."InflowOriginal" / 1000.0 AS DECIMAL(18, 3)) AS inflow_original,
      CAST(t."OutflowOriginal" / 1000.0 AS DECIMAL(18, 3)) AS outflow_original,
      CAST(t."RunningBalance" / 1000.0 AS DECIMAL(18, 3)) AS running_balance,
      CAST(t."RunningBalanceOriginal" / 1000.0 AS DECIMAL(18, 3)) AS running_balance_original,
      t."ExchangeRate" AS exchange_rate,
      t."ExchangeRateOverride" AS exchange_rate_override,
      t."ConversionPending" AS conversion_pending,
      a."Name" AS account_name,
      a."Type" AS account_type,
      a."Currency" AS account_currency,
      a."OnBudget" AS account_on_budget,
      a."ReconciledAt" AS account_reconciled_at,
      b."Name" AS budget_name,
      b."DisplayCurrency" AS budget_display_currency,
      c."Name" AS category_name,
      c."Note" AS category_note,
      c."CategoryGroupID" AS category_group_id,
      c."Position" AS category_position,
      cg."Name" AS category_group_name,
      cg."Note" AS category_group_note,
      cg."Position" AS category_group_position,
      l."Name" AS label_name,
      l."Color" AS label_color,
      l."CreatedAt" AS label_created_at,
      COALESCE(NULLIF(TRIM(t."Payee"), ''), p."Name") AS payee_name,
      p."ID" AS payee_id,
      p."Metadata" AS payee_metadata,
      p."CreatedAt" AS payee_created_at,
      p."UpdatedAt" AS payee_updated_at,
      COALESCE(ss.split_count, 0) AS split_count,
      COALESCE(ss.split_inflow, 0) AS split_inflow,
      COALESCE(ss.split_outflow, 0) AS split_outflow,
      COALESCE(ss.split_count, 0) > 0 AS has_splits
    FROM tx_normalized t
    LEFT JOIN accounts a
      ON a."ID" = t."AccountID"
    LEFT JOIN budgets b
      ON b."ID" = t."BudgetID"
    LEFT JOIN categories c
      ON c."ID" = t."CategoryID"
    LEFT JOIN category_groups cg
      ON cg."ID" = c."CategoryGroupID"
    LEFT JOIN labels l
      ON l."ID" = t."LabelID" AND l."BudgetID" = t."BudgetID"
    LEFT JOIN payees p
      ON p."BudgetID" = t."BudgetID" AND LOWER(TRIM(p."Name")) = LOWER(TRIM(t."Payee"))
    LEFT JOIN split_stats ss
      ON ss.transaction_id = t."ID"
  `);
}

async function rebuildDuckDbSnapshot(sqliteDb: ReportingSqlDatabase): Promise<void> {
  await ensureInitialized();
  if (!duckDb || !duckDbConnection) {
    throw new Error('DuckDB is not initialized');
  }

  const existingViews = await listDuckDbViews(duckDbConnection);
  for (const viewName of existingViews) {
    await duckDbConnection.query(`DROP VIEW IF EXISTS ${quoteIdentifier(viewName)}`);
  }

  const existingTables = await listDuckDbBaseTables(duckDbConnection);
  for (const tableName of existingTables) {
    await duckDbConnection.query(`DROP TABLE IF EXISTS ${quoteIdentifier(tableName)}`);
  }

  const sqliteTables = listSQLiteTables(sqliteDb);
  snapshotVersion += 1;

  for (const tableName of sqliteTables) {
    const allColumns = getSQLiteTableColumns(sqliteDb, tableName);
    if (allColumns.length === 0) continue;
    // BLOBs (e.g. warranty receipt images) aren't analytics data and don't
    // round-trip through JSON as a BLOB — drop them from the snapshot.
    const columns = allColumns.filter(
      (column) =>
        !String(column.type ?? '')
          .toUpperCase()
          .includes('BLOB')
    );
    if (columns.length === 0) continue;
    const droppedKeys = new Set(allColumns.filter((c) => !columns.includes(c)).map((c) => c.name));
    const columnDefinitions = columns
      .map((column) => `${quoteIdentifier(column.name)} ${mapSQLiteTypeToDuckDb(column.type)}`)
      .join(', ');
    await duckDbConnection.query(
      `CREATE TABLE ${quoteIdentifier(tableName)} (${columnDefinitions})`
    );

    const rows = getSQLiteTableRows(sqliteDb, tableName);
    if (rows.length === 0) continue;

    const normalizedRows = rows.map((row) => {
      const normalized = normalizeForJson(row) as Record<string, unknown>;
      for (const key of droppedKeys) delete normalized[key];
      return normalized;
    });
    const tempFileName = `sqlite_snapshot_${snapshotVersion}_${sanitizeTempFileName(tableName)}.json`;
    await duckDb.registerFileText(tempFileName, JSON.stringify(normalizedRows));
    try {
      // Insert with an EXPLICIT column-type map so DuckDB never auto-detects.
      // Auto-detection (read_json_auto, used by insertJSONFromPath) infers an
      // UNSIGNED integer from a sample of non-negative rows and then fails
      // ("Expected unsigned int or null, got number") on the first negative
      // (credit/overdrawn RunningBalance) or fractional (pre-milliunit) value.
      const columnStruct = columns
        .map((c) => `${quoteJsonKey(c.name)}: ${quoteJsonKey(mapSQLiteTypeToDuckDb(c.type))}`)
        .join(', ');
      await duckDbConnection.query(
        `INSERT INTO ${quoteIdentifier(tableName)} SELECT * FROM read_json(${quoteJsonKey(
          tempFileName
        )}, format='array', columns={${columnStruct}})`
      );
    } finally {
      await duckDb.dropFile(tempFileName).catch(() => undefined);
    }
  }

  try {
    await registerPrebuiltAnalyticsViews(duckDbConnection);
  } catch (error) {
    console.warn('[duckdb-reporting-engine] Failed to register prebuilt analytics views', {
      error,
    });
  }
}

async function ensureFreshSnapshot(sqliteDb: ReportingSqlDatabase): Promise<void> {
  if (snapshotPromise) {
    await snapshotPromise;
    return;
  }

  snapshotPromise = rebuildDuckDbSnapshot(sqliteDb);
  try {
    await snapshotPromise;
  } finally {
    snapshotPromise = null;
  }
}

export async function executeDuckDbReportQuery(
  query: string,
  sqliteDb: ReportingSqlDatabase,
  options?: { maxRows?: number }
): Promise<QueryResult> {
  const trimmedQuery = stripTrailingSemicolon(query);
  const maxRows = options?.maxRows ?? DEFAULT_MAX_ROWS;
  const shouldApplyLimit = querySupportsAutomaticLimit(trimmedQuery);
  const startTime = performance.now();

  await ensureFreshSnapshot(sqliteDb);
  if (!duckDbConnection) {
    throw new Error('DuckDB connection is not available');
  }

  let countBeforeLimit = 0;
  let queryToRun = trimmedQuery;

  if (shouldApplyLimit) {
    const { query: limitedQuery, userLimit } = applyQueryLimit(trimmedQuery, maxRows);
    queryToRun = limitedQuery;

    if (userLimit === null || userLimit > maxRows) {
      try {
        const countTable = await duckDbConnection.query(createCountQuery(trimmedQuery));
        const countRows = countTable.toArray() as { count?: number | bigint }[];
        const rawCount = countRows[0]?.count ?? 0;
        const normalizedCount = Number(rawCount);
        countBeforeLimit = Number.isFinite(normalizedCount) ? normalizedCount : 0;
      } catch {
        countBeforeLimit = 0;
      }
    }
  }

  const table = await duckDbConnection.query(queryToRun);
  const { columns, rows } = arrowTableToRows(table);
  const executionTime = performance.now() - startTime;

  return {
    columns,
    rows,
    rowCount: countBeforeLimit || rows.length,
    executionTime,
  };
}
