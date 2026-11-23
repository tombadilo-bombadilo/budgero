import type { Migration, MigrationDatabase } from '../migrations.js';
import { createLogger } from '../../logger.js';

const debugLog = createLogger('database:migrations');

/**
 * Optional time of day on a transaction: 'HH:MM', local wall-clock time with
 * no time zone, NULL when the row has none (every existing row). Kept apart
 * from Date so nothing about date handling changes. ShowTransactionTime is the
 * register display preference (off by default).
 */
const COLUMNS: [table: string, name: string, definition: string][] = [
  ['transactions', 'Time', 'TEXT NULL'],
  ['user_meta', 'ShowTransactionTime', 'BOOLEAN NOT NULL DEFAULT 0'],
];

export const migration082: Migration = {
  version: 82,
  description: 'Add optional transaction time and the register time preference',
  up: (db: MigrationDatabase) => {
    for (const [table, name, definition] of COLUMNS) {
      try {
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
      } catch (error) {
        // Only an existing column is fine (a re-run); anything else fails the migration.
        if (!(error instanceof Error && error.message.includes('duplicate column'))) throw error;
        debugLog('[Migration 82] column already exists', { table, name });
      }
    }
  },
  verify: (db: MigrationDatabase) => {
    try {
      return COLUMNS.every(([table, name]) => {
        const info = db.exec(`PRAGMA table_info(${table})`);
        const columns = info?.[0]?.values?.map((row: unknown[]) => row[1]) ?? [];
        return columns.includes(name);
      });
    } catch (error) {
      debugLog('[Migration 82] verification failed', { error });
      return false;
    }
  },
};
