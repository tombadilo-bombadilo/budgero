import type { Migration, MigrationDatabase } from '../migrations.js';
import { createLogger } from '../../logger.js';

const debugLog = createLogger('database:migrations');

/**
 * Home page dashboards: IsHome marks the dashboard the home page shows (at
 * most one per budget, kept by the service); Origin records where a dashboard
 * came from ('home_default': made from the default home layout on its first
 * edit, so "Reset to default" removes it).
 */
export const migration077: Migration = {
  version: 77,
  description: 'Add home page flag and origin to custom dashboards',
  up: (db: MigrationDatabase) => {
    for (const statement of [
      `ALTER TABLE custom_dashboards ADD COLUMN IsHome INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE custom_dashboards ADD COLUMN Origin TEXT NULL`,
    ]) {
      try {
        db.exec(statement);
      } catch (error) {
        debugLog('[Migration 77] statement failed (may already exist)', { error });
      }
    }
  },
  verify: (db: MigrationDatabase) => {
    try {
      const info = db.exec(`PRAGMA table_info(custom_dashboards)`);
      const columns = info?.[0]?.values?.map((row: unknown[]) => row[1]) ?? [];
      return columns.includes('IsHome') && columns.includes('Origin');
    } catch (error) {
      debugLog('[Migration 77] verification failed', { error });
      return false;
    }
  },
};
