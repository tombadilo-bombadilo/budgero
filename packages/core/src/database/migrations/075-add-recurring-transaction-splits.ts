import type { Migration, MigrationDatabase } from '../migrations.js';
import { createLogger } from '../../logger.js';

const debugLog = createLogger('database:migrations');

export const migration075: Migration = {
  version: 75,
  description: 'Add split lines to recurring transactions',
  // JSON array of RecurringSplitLine; NULL means a single-category template.
  up: (db: MigrationDatabase) => {
    try {
      db.exec(`ALTER TABLE recurring_transactions ADD COLUMN SplitsJSON TEXT DEFAULT NULL`);
    } catch (error) {
      // Only a re-run (the column is there already) is fine; anything else
      // must stop the migration rather than pass as done.
      if (!/duplicate column/i.test(error instanceof Error ? error.message : String(error))) {
        throw error;
      }
      debugLog('[Migration 75] SplitsJSON already exists', { error });
    }
  },
  verify: (db: MigrationDatabase) => {
    try {
      const info = db.exec(`PRAGMA table_info(recurring_transactions)`);
      const columns = info?.[0]?.values?.map((row: unknown[]) => row[1]) ?? [];
      return columns.includes('SplitsJSON');
    } catch (error) {
      debugLog('[Migration 75] verification failed', { error });
      return false;
    }
  },
};
