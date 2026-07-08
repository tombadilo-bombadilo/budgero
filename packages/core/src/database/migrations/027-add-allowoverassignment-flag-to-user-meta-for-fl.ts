import type { Migration, MigrationDatabase } from '../migrations.js';
import { createLogger } from '../../logger.js';

const debugLog = createLogger('database:migrations');

export const migration027: Migration = {
  version: 27,
  description: 'Add AllowOverAssignment flag to user_meta for flexible budgeting',
  up: (db: MigrationDatabase) => {
    const safeExec = (sql: string) => {
      try {
        db.exec(sql);
      } catch (error) {
        debugLog('[Migration 27] statement failed (may already exist)', { sql, error });
      }
    };

    // Ensure user_meta table exists
    safeExec(`
        CREATE TABLE IF NOT EXISTS user_meta (
          ID INTEGER PRIMARY KEY,
          LastUserBackup TEXT DEFAULT NULL,
          BackupReminderDays INTEGER NOT NULL DEFAULT 7,
          AllowOverAssignment BOOLEAN NOT NULL DEFAULT 0
        )
      `);

    // Add AllowOverAssignment column if it doesn't exist
    safeExec(`ALTER TABLE user_meta ADD COLUMN AllowOverAssignment BOOLEAN NOT NULL DEFAULT 0`);

    // Ensure default row exists
    safeExec(
      `INSERT OR IGNORE INTO user_meta (ID, BackupReminderDays, AllowOverAssignment) VALUES (1, 7, 0)`
    );
  },
  verify: (db: MigrationDatabase) => {
    try {
      const tableCheck = db.exec(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='user_meta'`
      );
      if (!tableCheck || tableCheck.length === 0) {
        return false;
      }

      const info = db.exec(`PRAGMA table_info(user_meta)`);
      if (!info || info.length === 0) return false;

      const columns = info[0].values.map((row: unknown[]) => row[1]);
      return columns.includes('AllowOverAssignment');
    } catch (error) {
      debugLog('[Migration 27] verification failed', { error });
      return false;
    }
  },
};
