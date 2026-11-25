import type { Migration, MigrationDatabase } from '../migrations.js';
import { createLogger } from '../../logger.js';

const debugLog = createLogger('database:migrations');

/**
 * Optional currency of a goal's target (ISO code). NULL = the budget
 * currency, which every existing goal keeps: their targets and calculations
 * are unchanged. A goal in another currency stores its target in that
 * currency and is converted to the budget currency when it is read.
 */
export const migration083: Migration = {
  version: 83,
  description: 'Add optional target currency to goals',
  up: (db: MigrationDatabase) => {
    try {
      db.exec(`ALTER TABLE goals ADD COLUMN TargetCurrency TEXT NULL`);
    } catch (error) {
      // Only an existing column is fine (a re-run); anything else fails the migration.
      if (!(error instanceof Error && error.message.includes('duplicate column'))) throw error;
      debugLog('[Migration 83] column already exists');
    }
  },
  verify: (db: MigrationDatabase) => {
    try {
      const info = db.exec(`PRAGMA table_info(goals)`);
      const columns = info?.[0]?.values?.map((row: unknown[]) => row[1]) ?? [];
      return columns.includes('TargetCurrency');
    } catch (error) {
      debugLog('[Migration 83] verification failed', { error });
      return false;
    }
  },
};
