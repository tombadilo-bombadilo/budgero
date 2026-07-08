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
