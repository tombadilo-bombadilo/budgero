import initSqlJs, { Database as SqlJsDatabase, SqlJsStatic, BindParams } from 'sql.js';
import path from 'node:path';
import { BaseDatabaseAdapter, Statement, DatabaseOptions, DatabaseError } from './interface.js';
import { MigrationRunner } from './migrations.js';
import { createMigrationDatabase } from './migration-database-factory.js';

import { createLogger } from '../logger.js';

const debugLog = createLogger('database:node-sqljs-adapter');

/**
 * NodeSqlJsAdapter - Node.js adapter using sql.js in-memory database
 * Uses node_modules/sql.js/dist/sql-wasm.wasm via locateFile
 */
export class NodeSqlJsAdapter extends BaseDatabaseAdapter {
  private db: SqlJsDatabase;

  private SQL: SqlJsStatic;

  readonly isEncrypted = false;

  readonly hasSync = false;

  readonly platform = 'desktop' as const;

  private constructor(SQL: SqlJsStatic, db: SqlJsDatabase) {
    super();
    this.SQL = SQL;
    this.db = db;
  }

  static async create(
    initialData?: Uint8Array,
    _options: DatabaseOptions = {}
  ): Promise<NodeSqlJsAdapter> {
    try {
      const SQL = await initSqlJs({
        locateFile: (file: string) =>
          path.join(process.cwd(), 'node_modules', 'sql.js', 'dist', file),
      });

      const db = new SQL.Database(initialData);
      const adapter = new NodeSqlJsAdapter(SQL, db);

      // Run migrations first
      const migrationRunner = new MigrationRunner(createMigrationDatabase(db));
      migrationRunner.runMigrations();

      // Clean up orphaned records before enabling foreign keys
      const orphansRemoved = migrationRunner.cleanupOrphanedRecords();
      if (orphansRemoved > 0) {
        debugLog(`Cleaned up ${orphansRemoved} orphaned records on startup`);
      }

      // Optimize database: prune old data and run VACUUM to reclaim space
      const optimizeResult = migrationRunner.optimizeDatabase();
      if (optimizeResult.pruned > 0 || optimizeResult.vacuumed) {
        debugLog(
          `Database optimized: ${optimizeResult.pruned} records pruned, vacuumed: ${optimizeResult.vacuumed}`
        );
      }

      // Now enable foreign keys (should succeed after cleanup)
      adapter.enableForeignKeys();

      return adapter;
    } catch (error) {
      throw new DatabaseError(
        `Failed to initialize Node sql.js database: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private enableForeignKeys(): void {
    try {
      this.db.exec('PRAGMA foreign_keys = ON');
    } catch {
      // ignore
    }
  }

  /** See MigrationDatabase.setForeignKeysSuspended — used during table-rebuild migrations. */
  setForeignKeysSuspended(suspended: boolean): void {
    try {
      this.db.exec(`PRAGMA foreign_keys = ${suspended ? 'OFF' : 'ON'}`);
    } catch {
      // ignore
    }
  }

  prepare(sql: string): Statement {
    this.validateSql(sql);

    return {
      get: (...params: unknown[]) => {
        try {
          const stmt = this.db.prepare(sql);
          stmt.bind(params as BindParams);
          const hasRow = stmt.step();
          const result = hasRow ? stmt.getAsObject() : undefined;
          stmt.free();
          return result;
        } catch (error) {
          console.error('Query failed:', sql);
          console.error('Parameters:', params);
          throw new DatabaseError(
            `Query execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`
          );
        }
      },
      all: (...params: unknown[]) => {
        try {
          const stmt = this.db.prepare(sql);
          stmt.bind(params as BindParams);
          const results: Record<string, unknown>[] = [];
          while (stmt.step()) results.push(stmt.getAsObject());
          stmt.free();
          return results;
        } catch (error) {
          console.error('Query failed:', sql);
          console.error('Parameters:', params);
          throw new DatabaseError(
            `Query execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`
          );
        }
      },
      run: (...params: unknown[]) => {
        try {
          const stmt = this.db.prepare(sql);
          stmt.bind(params as BindParams);
          stmt.step();
          const changes = this.db.getRowsModified();
          const lastRowStmt = this.db.prepare('SELECT last_insert_rowid()');
          lastRowStmt.step();
          const lastInsertRowid = Number(lastRowStmt.get()[0] || 0);
          lastRowStmt.free();
          stmt.free();
          return { lastInsertRowid, changes };
        } catch (error) {
          console.error('Query failed:', sql);
          console.error('Parameters:', params);
          throw new DatabaseError(
            `Query execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`
          );
        }
      },
      finalize: () => {
        // no-op, statements are freed per operation
      },
    };
  }

  exec(sql: string): unknown {
    this.validateSql(sql);
    try {
      const result = this.db.exec(sql);
      return result;
    } catch (error) {
      throw new DatabaseError(
        `SQL execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN TRANSACTION');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  backup(): Uint8Array {
    return this.db.export();
  }

  restore(data: Uint8Array): void {
    this.db.close();
    this.db = new this.SQL.Database(data);
    this.enableForeignKeys();
  }

  restoreAndMigrate(data: Uint8Array): void {
    this.db.close();
    this.db = new this.SQL.Database(data);
    const runner = new MigrationRunner(createMigrationDatabase(this.db));
    runner.runMigrations();
    this.enableForeignKeys();
  }

  close(): void {
    this.db.close();
  }
}
