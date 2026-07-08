import type { Migration, MigrationDatabase } from '../migrations.js';
import { createLogger } from '../../logger.js';

const debugLog = createLogger('database:migrations');

export const migration019: Migration = {
  version: 19,
  description:
    'Add Status, ErrorMessage, ErrorCode columns to mutation_history for failed push tracking',
  up: (db: MigrationDatabase) => {
    const safeExec = (sql: string) => {
      try {
        db.exec(sql);
      } catch (error) {
        debugLog('[Migration 19] statement failed (may already exist)', { sql, error });
      }
    };

    // Add Status column with default 'success' for backward compatibility
    safeExec(`ALTER TABLE mutation_history ADD COLUMN Status TEXT NOT NULL DEFAULT 'success'`);

    // Add ErrorMessage column for human-readable error descriptions
    safeExec(`ALTER TABLE mutation_history ADD COLUMN ErrorMessage TEXT`);

    // Add ErrorCode column for machine-readable error codes
    safeExec(`ALTER TABLE mutation_history ADD COLUMN ErrorCode TEXT`);
  },
  verify: (db: MigrationDatabase) => {
    try {
      const info = db.exec(`PRAGMA table_info(mutation_history)`);
      if (!info || info.length === 0) return false;
      const columns = info[0].values.map((row: unknown[]) => row[1]);
      return (
        columns.includes('Status') &&
        columns.includes('ErrorMessage') &&
        columns.includes('ErrorCode')
      );
    } catch (error) {
      debugLog('[Migration 19] verification failed', { error });
      return false;
    }
  },
};
