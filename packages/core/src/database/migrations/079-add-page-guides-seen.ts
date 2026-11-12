import type { Migration, MigrationDatabase } from '../migrations.js';
import { createLogger } from '../../logger.js';

const debugLog = createLogger('database:migrations');

/**
 * Which page guides each member of the workspace has seen, so a guide seen on
 * one device doesn't open again on another. One row per (user, guide); rows
 * are only ever added (INSERT OR IGNORE), so concurrent marks merge.
 */
export const migration079: Migration = {
  version: 79,
  description: 'Add page guides seen per user',
  up: (db: MigrationDatabase) => {
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS page_guides_seen (
          UserID  TEXT NOT NULL,
          GuideID TEXT NOT NULL,
          PRIMARY KEY (UserID, GuideID)
        )
      `);
    } catch (error) {
      debugLog('[Migration 79] statement failed (may already exist)', { error });
    }
  },
  verify: (db: MigrationDatabase) => {
    try {
      const info = db.exec(`PRAGMA table_info(page_guides_seen)`);
      const columns = info?.[0]?.values?.map((row: unknown[]) => row[1]) ?? [];
      return columns.includes('UserID') && columns.includes('GuideID');
    } catch (error) {
      debugLog('[Migration 79] verification failed', { error });
      return false;
    }
  },
};
