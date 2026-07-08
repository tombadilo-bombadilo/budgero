import type { Migration, MigrationDatabase } from '../migrations.js';
import { createLogger } from '../../logger.js';

const debugLog = createLogger('database:migrations');

export const migration023: Migration = {
  version: 23,
  description: 'Add ApiKey column to llm_settings for cloud providers',
  up: (db: MigrationDatabase) => {
    try {
      db.exec(`ALTER TABLE llm_settings ADD COLUMN ApiKey TEXT NOT NULL DEFAULT ''`);
    } catch (error) {
      debugLog('[Migration 23] statement failed (may already exist)', { error });
    }
  },
  verify: (db: MigrationDatabase) => {
    try {
      const info = db.exec(`PRAGMA table_info(llm_settings)`);
      if (!info || info.length === 0) return false;
      const columns = info[0].values.map((row: unknown[]) => row[1]);
      return columns.includes('ApiKey');
    } catch (error) {
      debugLog('[Migration 23] verification failed', { error });
      return false;
    }
  },
};
