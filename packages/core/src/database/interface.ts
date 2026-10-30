/**
 * Database abstraction layer for SQLite operations
 * Provides a unified interface for sql.js across web and Node.js environments
 */

export interface Statement {
  get(...params: any[]): any;

  all(...params: any[]): any[];

  run(...params: any[]): { lastInsertRowid: number | bigint; changes: number };
  finalize(): void;
}

export interface DatabaseAdapter {
  prepare(sql: string): Statement;

  exec(sql: string): any;
  transaction<T>(fn: () => T): T;
  backup(): Uint8Array | Promise<Uint8Array>;
  restore(data: Uint8Array): void | Promise<void>;
  /**
   * Restore from a backup blob, then bring it up to the current schema by
   * running pending migrations before persisting. Use this for user-supplied
   * backup files (which may be from an older app version); throws
   * DatabaseNewerThanAppError if the file is from a newer version.
   */
  restoreAndMigrate(data: Uint8Array): void | Promise<void>;
  close(): void;

  readonly isEncrypted: boolean;
  readonly hasSync: boolean;
  readonly platform: 'web' | 'desktop';

  /**
   * Optional connection hooks (the sql.js adapters implement them; the budget
   * snapshot uses them for its TEMP-trigger change tracking and stays off
   * without them).
   *
   * Registers a scalar JS function on the current connection. sql.js drops
   * every registered function (and every TEMP object) when the connection is
   * re-opened: on `export()` and when the database is replaced.
   */
  createFunction?(name: string, fn: (...args: SqlFunctionValue[]) => SqlFunctionValue): void;
  /**
   * Calls `listener` synchronously right after the connection was re-opened:
   * `'export'` after `backup()` (same data, TEMP objects and functions gone),
   * `'replace'` after restore / replaceDatabase (different data). Returns an
   * unsubscribe function.
   */
  addConnectionListener?(listener: (event: ConnectionEvent) => void): () => void;
  /** True while `transaction()` runs its callback. */
  readonly inTransaction?: boolean;
}

export type SqlFunctionValue = number | string | Uint8Array | null;

export type ConnectionEvent = 'export' | 'replace';

/**
 * Listener list for DatabaseAdapter.addConnectionListener. A throwing listener
 * never breaks the adapter call that re-opened the connection.
 */
export class ConnectionListeners {
  private listeners = new Set<(event: ConnectionEvent) => void>();

  add(listener: (event: ConnectionEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(event: ConnectionEvent): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch {
        // listeners own their error handling
      }
    }
  }
}

/**
 * NOTE: this interface is intentionally duplicated as `LocalPersistenceCipher`
 * in `@budgero/runtime` (`runtime/src/crypto/persistence-cipher.ts`) — runtime
 * must not depend on core, so keep both declarations shape-identical when
 * changing it.
 */
export interface LocalPersistenceCipher {
  encrypt(data: Uint8Array): Promise<Uint8Array>;
  decrypt(data: Uint8Array): Promise<{
    decrypted: Uint8Array;
    wasEncrypted: boolean;
  }>;
}

export interface DatabaseOptions {
  encryptionEnabled?: boolean;
  password?: string;
  path?: string;
  forceServerData?: boolean;
  localPersistence?: LocalPersistenceCipher;
}

export abstract class BaseDatabaseAdapter implements DatabaseAdapter {
  abstract prepare(sql: string): Statement;

  abstract exec(sql: string): any;
  abstract transaction<T>(fn: () => T): T;
  abstract backup(): Uint8Array | Promise<Uint8Array>;
  abstract restore(data: Uint8Array): void | Promise<void>;
  abstract restoreAndMigrate(data: Uint8Array): void | Promise<void>;
  abstract close(): void;

  abstract readonly isEncrypted: boolean;

  abstract readonly hasSync: boolean;

  abstract readonly platform: 'web' | 'desktop';

  // Created lazily (not as field initializers) so adapters built without the
  // constructor (Object.create in tests) still work.
  private listeners?: ConnectionListeners;

  private transactionDepth?: number;

  get inTransaction(): boolean {
    return (this.transactionDepth ?? 0) > 0;
  }

  addConnectionListener(listener: (event: ConnectionEvent) => void): () => void {
    this.listeners ??= new ConnectionListeners();
    return this.listeners.add(listener);
  }

  /** Tells the connection listeners the connection was re-opened. */
  protected emitConnectionEvent(event: ConnectionEvent): void {
    this.listeners?.emit(event);
  }

  /** Runs `fn` with `inTransaction` set (adapters wrap their BEGIN/COMMIT in it). */
  protected trackTransaction<T>(fn: () => T): T {
    this.transactionDepth = (this.transactionDepth ?? 0) + 1;
    try {
      return fn();
    } finally {
      this.transactionDepth -= 1;
    }
  }

  protected validateSql(sql: string): void {
    // Basic SQL injection prevention
    const normalizedSql = sql.toLowerCase().trim();

    const allowedStatements = [
      'select',
      'insert',
      'update',
      'delete',
      'create',
      'drop',
      'alter',
      'pragma',
      'begin',
      'commit',
      'rollback',
      'with',
    ];

    const firstWord = normalizedSql.split(/\s+/)[0];
    if (!allowedStatements.includes(firstWord)) {
      throw new Error(`SQL statement not allowed: ${firstWord}`);
    }
  }
}

export class DatabaseError extends Error {
  constructor(
    message: string,
    public readonly code?: string
  ) {
    super(message);
    this.name = 'DatabaseError';
  }
}

/** Failure classes a DatabaseError can carry in `code` (besides adapter-specific ones). */
export type SqliteFailureClass =
  'constraint' | 'locked' | 'corrupt' | 'readonly' | 'full' | 'error';

/**
 * Classify a SQLite error message into a fixed failure class. The message is
 * only matched here; callers report the class, never the text (it can name
 * tables, columns and values).
 */
export function classifySqliteError(message: string): SqliteFailureClass {
  if (/constraint failed|constraint violation|SQLITE_CONSTRAINT/i.test(message))
    return 'constraint';
  if (/database is locked|SQLITE_BUSY|SQLITE_LOCKED/i.test(message)) return 'locked';
  if (/malformed|not a database|SQLITE_CORRUPT|SQLITE_NOTADB/i.test(message)) return 'corrupt';
  if (/readonly database|SQLITE_READONLY/i.test(message)) return 'readonly';
  if (/database or disk is full|SQLITE_FULL/i.test(message)) return 'full';
  return 'error';
}
