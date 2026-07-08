import type { Migration, MigrationDatabase } from '../migrations.js';
import { createLogger } from '../../logger.js';

const debugLog = createLogger('database:migrations');

export const migration037: Migration = {
  version: 37,
  description: 'Add EnabledTools column to chat_settings for per-tool enable/disable',
  up: (db: MigrationDatabase) => {
    try {
      // JSON array of enabled chat tool keys. NULL means "all tools enabled".
      db.exec(`ALTER TABLE chat_settings ADD COLUMN EnabledTools TEXT`);
    } catch (error) {
      debugLog('[Migration 37] statement failed (may already exist)', { error });
    }
  },
  verify: (db: MigrationDatabase) => {
    try {
      const info = db.exec(`PRAGMA table_info(chat_settings)`);
      if (!info || info.length === 0) return false;
      const columns = info[0].values.map((row: unknown[]) => row[1]);
      return columns.includes('EnabledTools');
    } catch (error) {
      debugLog('[Migration 37] verification failed', { error });
      return false;
    }
  },
};
