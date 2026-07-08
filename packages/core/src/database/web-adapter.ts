import {
  BaseDatabaseAdapter,
  Statement,
  DatabaseOptions,
  DatabaseError,
  LocalPersistenceCipher,
} from './interface.js';
import { MigrationRunner } from './migrations.js';
import { createMigrationDatabase } from './migration-database-factory.js';

import { createLogger } from '../logger.js';

const debugLog = createLogger('database:web-adapter');

interface SqlJsDatabase {
  prepare(sql: string): SqlJsStatement;
  exec(sql: string): SqlJsExecResult[];
  getRowsModified(): number;
  export(): Uint8Array;
  close(): void;
}

interface SqlJsStatement {
  bind(params: unknown[]): void;
  step(): boolean;
  getAsObject(): Record<string, unknown>;
  get(): unknown[];
  free(): void;
}

interface SqlJsExecResult {
  columns: string[];
  values: unknown[][];
}

interface SqlJsStatic {
  Database: new (data?: Uint8Array) => SqlJsDatabase;
}

type InitSqlJsFunction = (config: { locateFile: (file: string) => string }) => Promise<SqlJsStatic>;

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  if (bytes.buffer instanceof ArrayBuffer) {
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  }
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

declare global {
  interface Window {
    initSqlJs: InitSqlJsFunction;
  }
}

/**
 * Web database adapter using sql.js (SQLite compiled to WebAssembly)
 * Always encrypted with sync capability
 */
export class WebDatabaseAdapter extends BaseDatabaseAdapter {
  private db: SqlJsDatabase;

  private SQL: SqlJsStatic;

  private dbFilename = 'budget.db';

  private localPersistenceCipher?: LocalPersistenceCipher;

  private needsEncryptionResave = false;

  readonly isEncrypted = true;

  readonly hasSync = true;

  readonly platform = 'web' as const;

  private constructor(
    SQL: SqlJsStatic,
    db: SqlJsDatabase,
    options: { cipher?: LocalPersistenceCipher } = {}
  ) {
    super();
    this.SQL = SQL;
    this.db = db;
    this.localPersistenceCipher = options.cipher;
  }

  static async create(
    initialData?: Uint8Array,
    options: DatabaseOptions = {}
  ): Promise<WebDatabaseAdapter> {
    try {
      debugLog('Initializing sql.js...');

      const SQL = await WebDatabaseAdapter.loadSqlJs();

      const dbFilename = options.path || WebDatabaseAdapter.getUserDatabaseFilename();

      const { localPersistence } = options;

      let dbData = initialData;
      let loadedFromLocalPersistence = false;
      if (!dbData) {
        const opfsData = await WebDatabaseAdapter.loadFromOPFS(dbFilename);
        if (opfsData) {
          dbData = opfsData;
          loadedFromLocalPersistence = true;
        }
      }

      let requiresEncryptionResave = false;
      if (dbData && loadedFromLocalPersistence && localPersistence) {
        const { decrypted, wasEncrypted } = await localPersistence.decrypt(dbData);
        dbData = decrypted;
        requiresEncryptionResave = !wasEncrypted;
        if (!wasEncrypted) {
          debugLog('Local persistence data was plaintext; scheduling encrypted rewrite');
        }
      }

      const db = new SQL.Database(dbData);

      const adapter = new WebDatabaseAdapter(SQL, db, { cipher: localPersistence });
      adapter.dbFilename = dbFilename;
      adapter.needsEncryptionResave = requiresEncryptionResave;

      // Run migrations first (this handles both new and existing databases)
      const migrationRunner = new MigrationRunner(createMigrationDatabase(db));
      migrationRunner.runMigrations();

      // Clean up orphaned records BEFORE trying to enable foreign keys
      // This removes constraint violations that would prevent FK enforcement
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

      // Now try to enable foreign keys (should succeed after cleanup)
      await adapter.ensureForeignKeysEnabled();

      if (initialData) {
        await adapter.persist(initialData);
      }

      if (adapter.needsEncryptionResave) {
        await adapter.forceSave();
        adapter.needsEncryptionResave = false;
      }

      return adapter;
    } catch (error) {
      if (
        error instanceof DatabaseError ||
        (error instanceof Error &&
          (error.message.toLowerCase().includes('decryption failed') ||
            error.message.toLowerCase().includes('failed to decrypt')))
      ) {
        throw error;
      }
      const errorMsg = error instanceof Error ? error.message : String(error);
      throw new DatabaseError(`Failed to initialize web database: ${errorMsg}`);
    }
  }

  private static async loadSqlJs(): Promise<SqlJsStatic> {
    if (typeof window !== 'undefined' && typeof window.initSqlJs === 'function') {
      debugLog('Using already loaded sql.js');
      try {
        return await window.initSqlJs({
          locateFile: (file: string) => {
            const path = WebDatabaseAdapter.sqlJsUrl(file);
            debugLog('SQL.js (existing) requesting file:', { file, path });
            return path;
          },
        });
      } catch (error) {
        debugLog('Failed to use existing sql.js, reloading...', { error });
        // Fall through to reload
      }
    }

    return await WebDatabaseAdapter.loadSqlJsFromScript();
  }

  private static async loadSqlJsFromScript(): Promise<SqlJsStatic> {
    debugLog('Loading sql.js from local files...');

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timeout loading sql.js - this may indicate WASM file is not accessible'));
      }, 15000);

      const script = document.createElement('script');

      // Local, bundled sql.js only — no CDN fallback, so the app stays fully
      // functional offline and never phones out to an external host.
      script.src = WebDatabaseAdapter.sqlJsUrl('sql-wasm.js');
      script.onload = async () => {
        try {
          debugLog('SQL.js script loaded, waiting for initSqlJs...');

          let attempts = 0;
          const waitForInit = () => {
            if (typeof window.initSqlJs === 'function') {
              debugLog('initSqlJs function found, calling with local WASM path...');
              window
                .initSqlJs({
                  locateFile: (file: string) => {
                    const path = WebDatabaseAdapter.sqlJsUrl(file);
                    debugLog('SQL.js requesting file:', { file, path });
                    return path;
                  },
                })
                .then((SQL: SqlJsStatic) => {
                  clearTimeout(timeout);
                  debugLog('SQL.js initialized successfully');
                  resolve(SQL);
                })
                .catch((error: unknown) => {
                  clearTimeout(timeout);
                  debugLog('Error initializing SQL.js:', { error });
                  reject(error);
                });
            } else if (attempts < 50) {
              // Wait up to 5 seconds (50 * 100ms)
              attempts++;
              setTimeout(waitForInit, 100);
            } else {
              clearTimeout(timeout);
              reject(new Error('initSqlJs function never became available'));
            }
          };

          waitForInit();
        } catch (error) {
          clearTimeout(timeout);
          debugLog('Error in script onload:', { error });
          reject(error);
        }
      };

      script.onerror = (event) => {
        clearTimeout(timeout);
        debugLog('Local sql.js script failed to load', { event });
        reject(new Error('Failed to load bundled sql.js (/sql.js/sql-wasm.js)'));
      };

      debugLog('Adding SQL.js script to DOM...');
      document.head.appendChild(script);
    });
  }

  private static sqlJsUrl(file: string): string {
    // Always use absolute path to work from any route (e.g., /settings/api)
    return `/sql.js/${file}`;
  }

  private static async loadFromOPFS(filename: string): Promise<Uint8Array | null> {
    try {
      if (!navigator.storage || !navigator.storage.getDirectory) {
        debugLog('OPFS not available');
        return null;
      }

      const opfsRoot = await navigator.storage.getDirectory();
      const fileHandle = await opfsRoot.getFileHandle(filename);
      const file = await fileHandle.getFile();
      const data = new Uint8Array(await file.arrayBuffer());
      debugLog(`Loaded database from OPFS (${filename})`, { size: data.length });
      return data;
    } catch (error) {
      // File doesn't exist or OPFS not available
      debugLog(`Failed to load from OPFS (${filename})`, { error });
      return null;
    }
  }

  private static getUserDatabaseFilename(): string {
    if (typeof window !== 'undefined' && window.localStorage) {
      const authToken = localStorage.getItem('auth_token');
      if (authToken) {
        try {
          const parts = authToken.split('.');
          if (parts.length === 3) {
            const payload = JSON.parse(atob(parts[1]));
            const userId = payload.user_id || payload.sub;
            if (userId) {
              return `user_${userId}.db`;
            }
          }
        } catch (error) {
          debugLog('Failed to decode JWT token, falling back to hash', { error });
        }

        // Fallback to hash if JWT decoding fails
        const hash = btoa(authToken)
          .replace(/[^a-zA-Z0-9]/g, '')
          .substring(0, 16);
        return `budget_${hash}.db`;
      }
    }

    debugLog('No auth token found, using default database filename');
    return 'budget_default.db';
  }

  prepare(sql: string): Statement {
    this.validateSql(sql);

    return {
      get: (...params: unknown[]) => {
        try {
          this.ensureForeignKeysOnOperation();
          const stmt = this.db.prepare(sql);
          stmt.bind(params);
          const hasRow = stmt.step();
          const result = hasRow ? stmt.getAsObject() : undefined;
          stmt.free();
          return result;
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          throw new DatabaseError(
            `Query execution failed: ${errorMsg} [SQL: ${sql.substring(0, 100)}] [Params: ${JSON.stringify(params)}]`
          );
        }
      },

      all: (...params: unknown[]) => {
        try {
          this.ensureForeignKeysOnOperation();
          const stmt = this.db.prepare(sql);
          stmt.bind(params);
          const results = [];
          while (stmt.step()) {
            results.push(stmt.getAsObject());
          }
          stmt.free();
          return results;
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          throw new DatabaseError(
            `Query execution failed: ${errorMsg} [SQL: ${sql.substring(0, 100)}] [Params: ${JSON.stringify(params)}]`
          );
        }
      },

      run: (...params: unknown[]) => {
        try {
          this.ensureForeignKeysOnOperation();
          const stmt = this.db.prepare(sql);
          stmt.bind(params);
          stmt.step();
          const changes = this.db.getRowsModified();

          const lastRowStmt = this.db.prepare('SELECT last_insert_rowid()');
          lastRowStmt.step();
          const lastInsertRowid = Number(lastRowStmt.get()[0] || 0);
          lastRowStmt.free();
          stmt.free();

          return { lastInsertRowid, changes };
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          throw new DatabaseError(
            `Query execution failed: ${errorMsg} [SQL: ${sql.substring(0, 100)}] [Params: ${JSON.stringify(params)}]`
          );
        }
      },

      finalize: () => {
        // No-op for sql.js since we free statements immediately
      },
    };
  }

  exec(sql: string): SqlJsExecResult[] {
    this.validateSql(sql);
    try {
      this.ensureForeignKeysOnOperation();
      const result = this.db.exec(sql);
      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      throw new DatabaseError(`SQL execution failed: ${errorMsg} [SQL: ${sql.substring(0, 100)}]`);
    }
  }

  transaction<T>(fn: () => T): T {
    this.ensureForeignKeysOnOperation();
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

  async restore(data: Uint8Array): Promise<void> {
    this.db.close();
    this.db = new this.SQL.Database(data);
    // Re-enable foreign key constraints after restore
    this.ensureForeignKeysOnOperation();
    // Await so a failed write can't leave the on-disk copy behind the
    // in-memory one after restore() reports success.
    await this.persist(data);
  }

  async restoreAndMigrate(data: Uint8Array): Promise<void> {
    this.db.close();
    this.db = new this.SQL.Database(data);

    // Bring a possibly-older backup up to the current schema. Throws
    // DatabaseNewerThanAppError if the file is from a newer app version.
    const runner = new MigrationRunner(createMigrationDatabase(this.db));
    runner.runMigrations();
    this.ensureForeignKeysOnOperation();

    // Persist the MIGRATED bytes, not the raw restored ones, so the on-disk
    // copy matches what we're now operating on.
    const migrated = this.db.export();
    await this.persist(migrated);
  }

  close(): void {
    this.db.close();
  }

  private async saveToOPFS(data: Uint8Array, encrypted: boolean): Promise<void> {
    try {
      if (!navigator.storage || !navigator.storage.getDirectory) {
        debugLog('OPFS not available for saving');
        return;
      }

      const opfsRoot = await navigator.storage.getDirectory();
      const fileHandle = await opfsRoot.getFileHandle(this.dbFilename, { create: true });
      const writable = await fileHandle.createWritable();
      // Write as Blob to satisfy FileSystemWriteChunkType and avoid ArrayBufferLike typing issues
      await writable.write(new Blob([toArrayBuffer(data)]));
      await writable.close();
      debugLog(`Saved database to OPFS (${this.dbFilename})`, {
        encryptedSize: data.length,
        encrypted,
      });
    } catch (error) {
      debugLog('Failed to save to OPFS', { error });
    }
  }

  async saveToOPFSPublic(): Promise<void> {
    const data = await this.backup();
    await this.persist(data);
  }

  updateLocalPersistenceCipher(cipher: LocalPersistenceCipher): void {
    this.localPersistenceCipher = cipher;
  }

  async forceSave(): Promise<void> {
    debugLog('Force saving database...');
    const data = await this.backup();
    await this.persist(data);
  }

  private async persist(data: Uint8Array): Promise<void> {
    let payload = data;
    let payloadWasEncrypted = false;
    if (this.localPersistenceCipher) {
      try {
        payload = await this.localPersistenceCipher.encrypt(data);
        payloadWasEncrypted = true;
      } catch (error) {
        debugLog('Failed to encrypt local persistence payload; falling back to plaintext', {
          error,
        });
        payload = data;
      }
    }

    await this.saveToOPFS(payload, payloadWasEncrypted);
  }

  /**
   * Ensure foreign keys are enabled, clean up violations if needed
   */
  async ensureForeignKeysEnabled(): Promise<void> {
    if (this.fkSuspended) return;
    try {
      const beforeResult = this.db.exec('PRAGMA foreign_keys');
      const fkEnabled =
        beforeResult && beforeResult.length > 0 && beforeResult[0].values[0][0] === 1;

      if (fkEnabled) {
        debugLog('Foreign keys already enabled');
        return;
      }

      debugLog('Foreign keys disabled, attempting to enable...');

      this.db.exec('PRAGMA foreign_keys = ON');

      const afterResult = this.db.exec('PRAGMA foreign_keys');
      const nowEnabled = afterResult && afterResult.length > 0 && afterResult[0].values[0][0] === 1;

      if (nowEnabled) {
        debugLog('✅ Foreign keys successfully enabled');
        // Force save to OPFS to ensure foreign key setting persists across sessions
        await this.forceSave();
      } else {
        debugLog('❌ Failed to enable foreign keys - likely due to existing constraint violations');
        debugLog('Database may have orphaned records that prevent foreign key enforcement');
        // Don't throw error - let the app continue but log the issue
      }
    } catch (error) {
      debugLog('Error checking/enabling foreign keys', { error });
      // Don't throw - let the app continue
    }
  }

  /** While true, all FK auto-re-enable logic is paused (table-rebuild migrations). */
  private fkSuspended = false;

  /** See MigrationDatabase.setForeignKeysSuspended — used during table-rebuild migrations. */
  setForeignKeysSuspended(suspended: boolean): void {
    this.fkSuspended = suspended;
    try {
      this.db.exec(`PRAGMA foreign_keys = ${suspended ? 'OFF' : 'ON'}`);
    } catch (error) {
      debugLog('Failed to toggle foreign keys', { suspended, error });
    }
  }

  /**
   * Force enable foreign keys on every operation to ensure they stay enabled
   */
  private ensureForeignKeysOnOperation(): void {
    if (this.fkSuspended) return;
    try {
      // Only check/set foreign keys every 100 operations to minimize overhead
      if (!this.fkCheckCounter) this.fkCheckCounter = 0;
      this.fkCheckCounter++;

      if (this.fkCheckCounter >= 100) {
        const result = this.db.exec('PRAGMA foreign_keys');
        const fkEnabled = result && result.length > 0 && result[0].values[0][0] === 1;

        if (!fkEnabled) {
          this.db.exec('PRAGMA foreign_keys = ON');
        }

        this.fkCheckCounter = 0;
      }
    } catch {
      // Silent fail - don't break operations
    }
  }

  private fkCheckCounter = 0;

  static async cleanupDatabaseFile(filename?: string): Promise<void> {
    try {
      const target = filename || WebDatabaseAdapter.getUserDatabaseFilename();
      if (!target) return;
      if (!navigator.storage || !navigator.storage.getDirectory) {
        return;
      }

      const opfsRoot = await navigator.storage.getDirectory();
      try {
        await opfsRoot.removeEntry(target);
        debugLog(`Cleaned up database file: ${target}`);
      } catch (error: unknown) {
        if (error instanceof DOMException && error.name === 'NotFoundError') {
          return;
        }
        debugLog('Failed to remove database file', { error, target });
      }
    } catch (error) {
      debugLog('Failed to cleanup database file', { error, filename });
    }
  }

  static async cleanupStaleSpaceDatabases(
    keepSpaceIds: string[],
    options?: { suffix?: string }
  ): Promise<void> {
    try {
      if (!navigator.storage || !navigator.storage.getDirectory) {
        return;
      }

      const suffix = options?.suffix ?? '';
      const filenameFor = (id: string) => `space_${id}${suffix}.db`;
      const relevantSuffix = `${suffix}.db`;
      const keepNames = new Set(keepSpaceIds.map(filenameFor).filter(Boolean));
      const opfsRoot = await navigator.storage.getDirectory();
      // FileSystemDirectoryHandle.entries() is not in all TypeScript DOM libs, so we use a type assertion
      const { entries } = opfsRoot as unknown as {
        entries?: () => AsyncIterable<[string, FileSystemHandle]>;
      };
      if (typeof entries !== 'function') return;

      for await (const entry of entries.call(opfsRoot)) {
        const [name] = entry;
        if (typeof name !== 'string') continue;
        if (!name.endsWith('.db')) continue;
        if (!name.startsWith('space_')) continue;
        if (suffix && !name.endsWith(relevantSuffix)) continue;
        if (keepNames.has(name)) continue;
        try {
          await opfsRoot.removeEntry(name);
          debugLog('[WebDatabaseAdapter] Removed stale space database', { name });
        } catch (error) {
          debugLog('[WebDatabaseAdapter] Failed to remove stale space database', {
            name,
            error,
          });
        }
      }
    } catch (error) {
      debugLog('[WebDatabaseAdapter] Failed to cleanup stale space databases', { error });
    }
  }
}
