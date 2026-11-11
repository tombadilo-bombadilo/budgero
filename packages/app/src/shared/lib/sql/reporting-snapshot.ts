/**
 * The DuckDB copy of the local SQLite database that reports query, kept
 * separate from DuckDB's wasm setup so tests can drive it with the node build.
 *
 * - The copy (every SQLite table, the analytics views, empty derived tables)
 *   is rebuilt only when the data changed (SQLite's total_changes plus a row
 *   fingerprint, minus the derived builders' own writes), the local day turned
 *   or another database is passed in.
 * - Derived tables (budget_months, scheduled_*) are filled when a query names them.
 * - Rebuilds and fills take a write lock; queries run under a read lock, so
 *   parallel queries still run together but never see a copy being rebuilt.
 */
import type { QueryResult } from './report-query-executor';
import { mapSQLiteTypeToDuckDb, reportingViewsSql } from './analytics-views';
import { arrowTableToRows, type ArrowTableLike } from './arrow-rows';
import { applyQueryLimit, createCountQuery } from './sql-limit';
import {
  DERIVED_TABLES,
  derivedTablesIn,
  type DerivedColumn,
  type DerivedTable,
  type DerivedTableContext,
} from './report-derived-tables';

export interface ReportingSqlStatement {
  all(): Record<string, unknown>[];
  get(): Record<string, unknown> | undefined;
  finalize(): void;
}

export interface ReportingSqlDatabase {
  prepare(sql: string): ReportingSqlStatement;
}

export interface ReportingDuckDb {
  query(sql: string): Promise<ArrowTableLike>;
  /** Inserts rows with an explicit column-type map (never auto-detected types). */
  insertRows(
    table: string,
    columns: readonly { name: string; type: string }[],
    rows: Record<string, unknown>[]
  ): Promise<void>;
}

export interface ReportingSnapshotOptions {
  /** The user's local day (YYYY-MM-DD). */
  today: () => string;
  /** App services for the derived tables; null skips them (they stay empty). */
  services: () => DerivedTableContext['services'] | null;
}

export const DEFAULT_MAX_ROWS = 10_000;

export function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function normalizeBigInt(value: bigint): number | string {
  const asNumber = Number(value);
  return Number.isSafeInteger(asNumber) ? asNumber : value.toString();
}

function normalizeForJson(value: unknown): unknown {
  if (typeof value === 'bigint') return normalizeBigInt(value);
  if (value instanceof Uint8Array) return Array.from(value);
  if (Array.isArray(value)) return value.map((entry) => normalizeForJson(entry));
  if (value && typeof value === 'object') {
    const normalized: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      normalized[key] = normalizeForJson(nested);
    }
    return normalized;
  }
  return value;
}

function stripTrailingSemicolon(query: string): string {
  return query.replace(/;\s*$/, '').trim();
}

function querySupportsAutomaticLimit(query: string): boolean {
  const normalized = query.trim().toLowerCase();
  return normalized.startsWith('select') || normalized.startsWith('with');
}

function sqliteRows(db: ReportingSqlDatabase, sql: string): Record<string, unknown>[] {
  const statement = db.prepare(sql);
  try {
    return statement.all();
  } finally {
    statement.finalize();
  }
}

/** Many readers or one writer; waiters are woken in a batch and re-check. */
class ReadWriteLock {
  private readers = 0;

  private writer = false;

  private waiting: (() => void)[] = [];

  private async acquire(write: boolean): Promise<void> {
    while (write ? this.writer || this.readers > 0 : this.writer) {
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    }
    if (write) this.writer = true;
    else this.readers += 1;
  }

  private release(write: boolean): void {
    if (write) this.writer = false;
    else this.readers -= 1;
    const { waiting } = this;
    this.waiting = [];
    for (const wake of waiting) wake();
  }

  async read<T>(task: () => Promise<T>): Promise<T> {
    await this.acquire(false);
    try {
      return await task();
    } finally {
      this.release(false);
    }
  }

  async write<T>(task: () => Promise<T>): Promise<T> {
    await this.acquire(true);
    try {
      return await task();
    } finally {
      this.release(true);
    }
  }
}

interface DerivedCacheEntry {
  key: string;
  rows: Record<string, unknown>[];
}

export class ReportingSnapshot {
  private readonly lock = new ReadWriteLock();

  /** Database and freshness key the current copy was built from. */
  private builtFrom: { db: ReportingSqlDatabase; key: string | null } | null = null;

  private filled = new Set<string>();

  private readonly ownChanges = new WeakMap<object, number>();

  private readonly derivedCache = new WeakMap<object, Map<string, DerivedCacheEntry>>();

  /** Rebuilds so far (tests and diagnostics). */
  rebuilds = 0;

  constructor(
    private readonly duck: ReportingDuckDb,
    private readonly options: ReportingSnapshotOptions
  ) {}

  /** Local day + data version, or null when SQLite can't tell (then always rebuild). */
  private freshnessKey(db: ReportingSqlDatabase): string | null {
    try {
      const [row] = sqliteRows(
        db,
        `SELECT total_changes() AS n,
           (SELECT COUNT(*) FROM sqlite_master) AS tables,
           (SELECT MAX(rowid) FROM transactions) AS last_transaction`
      );
      const changes = Number(row?.n);
      if (!Number.isFinite(changes)) return null;
      const own = this.ownChanges.get(db) ?? 0;
      return `${this.options.today()}:${changes - own}:${String(row?.tables)}:${String(row?.last_transaction)}`;
    } catch {
      return null;
    }
  }

  private isFresh(db: ReportingSqlDatabase, key: string | null): boolean {
    return key !== null && this.builtFrom?.db === db && this.builtFrom.key === key;
  }

  /** Runs `task` counting the SQLite writes it makes as the builders' own. */
  private trackOwnWrites<T>(db: ReportingSqlDatabase, task: () => T): T {
    const changes = () => {
      try {
        return Number(sqliteRows(db, 'SELECT total_changes() AS n')[0]?.n);
      } catch {
        return Number.NaN;
      }
    };
    const before = changes();
    try {
      return task();
    } finally {
      const after = changes();
      if (Number.isFinite(before) && Number.isFinite(after)) {
        this.ownChanges.set(db, (this.ownChanges.get(db) ?? 0) + (after - before));
      }
    }
  }

  private async rebuild(db: ReportingSqlDatabase, key: string | null): Promise<void> {
    this.rebuilds += 1;
    const existing = arrowTableToRows(
      await this.duck.query(
        `SELECT table_name, table_type FROM information_schema.tables WHERE table_schema = 'main'`
      )
    ).rows;
    for (const [name, type] of existing) {
      if (type === 'VIEW')
        await this.duck.query(`DROP VIEW IF EXISTS ${quoteIdentifier(String(name))}`);
    }
    for (const [name, type] of existing) {
      if (type !== 'VIEW')
        await this.duck.query(`DROP TABLE IF EXISTS ${quoteIdentifier(String(name))}`);
    }
    this.filled = new Set();

    const tables = sqliteRows(
      db,
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`
    )
      .map((row) => String(row.name ?? ''))
      .filter(Boolean);
    for (const table of tables) {
      const allColumns = sqliteRows(db, `PRAGMA table_info(${quoteIdentifier(table)})`)
        .map((column) => ({ name: String(column.name ?? ''), type: String(column.type ?? '') }))
        .filter((column) => column.name.length > 0);
      // BLOBs (e.g. warranty receipt images) aren't analytics data.
      const columns = allColumns.filter((column) => !column.type.toUpperCase().includes('BLOB'));
      if (columns.length === 0) continue;
      const typed = columns.map((c) => ({ name: c.name, type: mapSQLiteTypeToDuckDb(c.type) }));
      await this.duck.query(
        `CREATE TABLE ${quoteIdentifier(table)} (${typed
          .map((c) => `${quoteIdentifier(c.name)} ${c.type}`)
          .join(', ')})`
      );
      const rows = sqliteRows(db, `SELECT * FROM ${quoteIdentifier(table)}`).map((row) => {
        const normalized = normalizeForJson(row) as Record<string, unknown>;
        const kept: Record<string, unknown> = {};
        for (const column of columns) kept[column.name] = normalized[column.name];
        return kept;
      });
      if (rows.length > 0) await this.duck.insertRows(table, typed, rows);
    }
    const names = new Set(tables);
    for (const table of DERIVED_TABLES) {
      if (names.has(table.name)) continue;
      await this.duck.query(derivedTableDdl(table.name, table.columns));
    }
    for (const sql of reportingViewsSql(this.options.today())) {
      try {
        await this.duck.query(sql);
      } catch (error) {
        console.warn('[reporting-snapshot] Failed to register an analytics view', { error });
      }
    }
    this.builtFrom = { db, key };
  }

  /** A derived table's rows, cached until the data or the day changes. */
  private derivedRows(table: DerivedTable, db: ReportingSqlDatabase): Record<string, unknown>[] {
    const services = this.options.services();
    if (!services) return [];
    const key = this.freshnessKey(db);
    const cache = this.derivedCache.get(db) ?? new Map<string, DerivedCacheEntry>();
    this.derivedCache.set(db, cache);
    const hit = cache.get(table.name);
    if (key !== null && hit?.key === key) return hit.rows;
    const rows = this.trackOwnWrites(db, () =>
      table.build({ services, db, today: this.options.today() })
    );
    // The builders' own writes don't count, so this is the key after them too.
    if (key !== null) cache.set(table.name, { key, rows });
    return rows;
  }

  private async fill(tables: DerivedTable[], db: ReportingSqlDatabase): Promise<void> {
    for (const table of tables) {
      if (this.filled.has(table.name)) continue;
      let rows: Record<string, unknown>[] = [];
      try {
        rows = this.derivedRows(table, db);
      } catch (error) {
        console.warn('[reporting-snapshot] Failed to build a derived table', {
          table: table.name,
          error,
        });
      }
      await this.duck.query(`DELETE FROM ${quoteIdentifier(table.name)}`);
      if (rows.length > 0) await this.duck.insertRows(table.name, table.columns, rows);
      this.filled.add(table.name);
    }
  }

  /**
   * Brings the copy up to date for `query` (write lock only when something
   * must change) and returns the build it is valid for.
   */
  private async prepare(query: string, db: ReportingSqlDatabase): Promise<object | null> {
    const needed = derivedTablesIn(query);
    const ready = () =>
      this.isFresh(db, this.freshnessKey(db)) && needed.every((t) => this.filled.has(t.name));
    if (ready()) return this.builtFrom;
    return await this.lock.write(async () => {
      const key = this.freshnessKey(db);
      if (!this.isFresh(db, key)) await this.rebuild(db, key);
      await this.fill(needed, db);
      return this.builtFrom;
    });
  }

  async execute(
    rawQuery: string,
    db: ReportingSqlDatabase,
    options?: { maxRows?: number }
  ): Promise<QueryResult> {
    const query = stripTrailingSemicolon(rawQuery);
    const maxRows = options?.maxRows ?? DEFAULT_MAX_ROWS;
    const needed = derivedTablesIn(query);
    const startTime = performance.now();
    for (let attempt = 0; ; attempt += 1) {
      const build = await this.prepare(query, db);
      const result = await this.lock.read(async () => {
        // Another query rebuilt the copy between prepare and here: prepare
        // again (nothing changes while we hold the read lock). After a few
        // tries run on what is there (data changing under every query).
        const same =
          this.builtFrom === build && needed.every((table) => this.filled.has(table.name));
        if (!same && attempt < 3) return null;
        return this.run(query, maxRows, startTime);
      });
      if (result) return result;
    }
  }

  private async run(query: string, maxRows: number, startTime: number): Promise<QueryResult> {
    let countBeforeLimit = 0;
    let queryToRun = query;
    if (querySupportsAutomaticLimit(query)) {
      const { query: limited, userLimit } = applyQueryLimit(query, maxRows);
      queryToRun = limited;
      if (userLimit === null || userLimit > maxRows) {
        try {
          const counted = arrowTableToRows(await this.duck.query(createCountQuery(query)));
          const count = Number(counted.rows[0]?.[0] ?? 0);
          countBeforeLimit = Number.isFinite(count) ? count : 0;
        } catch {
          countBeforeLimit = 0;
        }
      }
    }
    const { columns, rows } = arrowTableToRows(await this.duck.query(queryToRun));
    return {
      columns,
      rows,
      rowCount: countBeforeLimit || rows.length,
      executionTime: performance.now() - startTime,
    };
  }
}

function derivedTableDdl(name: string, columns: readonly DerivedColumn[]): string {
  return `CREATE TABLE ${quoteIdentifier(name)} (${columns
    .map((column) => `${quoteIdentifier(column.name)} ${column.type}`)
    .join(', ')})`;
}
