import type { Migration, MigrationDatabase } from '../migrations.js';
import { createLogger } from '../../logger.js';

const debugLog = createLogger('database:migrations');

export const migration075: Migration = {
  version: 75,
  description: 'Add dashboard-level filters to custom dashboards',
  up: (db: MigrationDatabase) => {
    try {
      db.exec(`ALTER TABLE custom_dashboards ADD COLUMN Filters TEXT NULL`);
    } catch (error) {
      debugLog('[Migration 75] statement failed (may already exist)', { error });
    }
  },
  verify: (db: MigrationDatabase) => {
    try {
      const info = db.exec(`PRAGMA table_info(custom_dashboards)`);
      const columns = info?.[0]?.values?.map((row: unknown[]) => row[1]) ?? [];
      return columns.includes('Filters');
    } catch (error) {
      debugLog('[Migration 75] verification failed', { error });
      return false;
    }
  },
};
