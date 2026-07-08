import type { Migration, MigrationDatabase } from '../migrations.js';
import { createLogger } from '../../logger.js';

const debugLog = createLogger('database:migrations');

export const migration025: Migration = {
  version: 25,
  description: 'Add ContextLength column to llm_settings for context window tracking',
  up: (db: MigrationDatabase) => {
    try {
      db.exec(`ALTER TABLE llm_settings ADD COLUMN ContextLength INTEGER`);
    } catch (error) {
      debugLog('[Migration 25] statement failed (may already exist)', { error });
    }
  },
  verify: (db: MigrationDatabase) => {
    try {
      const info = db.exec(`PRAGMA table_info(llm_settings)`);
      if (!info || info.length === 0) return false;
      const columns = info[0].values.map((row: unknown[]) => row[1]);
      return columns.includes('ContextLength');
    } catch (error) {
      debugLog('[Migration 25] verification failed', { error });
      return false;
    }
  },
};
