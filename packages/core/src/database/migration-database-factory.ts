import type { MigrationDatabase } from './migrations.js';

/**
 * Minimal structural type for a sql.js-like database that the migration
 * factory needs. Both the web and node sql.js adapters satisfy this shape.
 */
interface SqlJsLikeStatement {
  step(): boolean;
  getAsObject(): Record<string, unknown>;
  free(): void;
}

interface SqlJsLikeDatabase {
  exec(sql: string): unknown;
  prepare(sql: string): SqlJsLikeStatement;
}

/**
 * Wrapper to adapt a sql.js Database to the MigrationDatabase interface.
 * Shared by the web and node sql.js adapters.
 */
export function createMigrationDatabase(db: SqlJsLikeDatabase): MigrationDatabase {
  return {
    exec: (sql: string) => db.exec(sql) as ReturnType<MigrationDatabase['exec']>,
    prepare: (sql: string) => {
      const stmt = db.prepare(sql);
      return {
        get: () => {
          const hasRow = stmt.step();
          const result = hasRow ? stmt.getAsObject() : undefined;
          stmt.free();
          return result as { version?: number; foreign_keys?: number } | undefined;
        },
        finalize: () => {
          // Statement already freed in get()
        },
      };
    },
  };
}
