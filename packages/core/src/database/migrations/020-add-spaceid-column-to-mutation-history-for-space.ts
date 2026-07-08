import type { Migration, MigrationDatabase } from '../migrations.js';
import { createLogger } from '../../logger.js';

const debugLog = createLogger('database:migrations');

export const migration020: Migration = {
  version: 20,
  description: 'Add SpaceID column to mutation_history for space-based filtering',
  up: (db: MigrationDatabase) => {
    try {
      db.exec(`ALTER TABLE mutation_history ADD COLUMN SpaceID TEXT`);
    } catch (error) {
      debugLog('[Migration 20] statement failed (may already exist)', { error });
    }
  },
  verify: (db: MigrationDatabase) => {
    try {
      const info = db.exec(`PRAGMA table_info(mutation_history)`);
      if (!info || info.length === 0) return false;
      const columns = info[0].values.map((row: unknown[]) => row[1]);
      return columns.includes('SpaceID');
    } catch (error) {
      debugLog('[Migration 20] verification failed', { error });
      return false;
    }
  },
};
