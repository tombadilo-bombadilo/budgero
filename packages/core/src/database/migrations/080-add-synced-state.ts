import type { Migration, MigrationDatabase } from '../migrations.js';
import { createLogger } from '../../logger.js';

const debugLog = createLogger('database:migrations');

/**
 * Generic synced key/value state (services/synced-state): small app state
 * that used to live in one browser's localStorage. Value is JSON text, NULL
 * once deleted (kept as a tombstone so an older write can't bring it back);
 * Clocks holds the write times that make replays order-independent.
 */
export const migration080: Migration = {
  version: 80,
  description: 'Add synced key/value state',
  up: (db: MigrationDatabase) => {
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS synced_state (
          Scope     TEXT NOT NULL,
          Key       TEXT NOT NULL,
          Value     TEXT NULL,
          UpdatedAt TEXT NOT NULL,
          Clocks    TEXT NULL,
          PRIMARY KEY (Scope, Key)
        )
      `);
    } catch (error) {
      debugLog('[Migration 80] statement failed (may already exist)', { error });
    }
  },
  verify: (db: MigrationDatabase) => {
    try {
      const info = db.exec(`PRAGMA table_info(synced_state)`);
      const columns = info?.[0]?.values?.map((row: unknown[]) => row[1]) ?? [];
      return ['Scope', 'Key', 'Value', 'UpdatedAt', 'Clocks'].every((c) => columns.includes(c));
    } catch (error) {
      debugLog('[Migration 80] verification failed', { error });
      return false;
    }
  },
};
