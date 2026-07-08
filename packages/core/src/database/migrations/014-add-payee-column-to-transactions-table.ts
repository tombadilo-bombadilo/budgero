import type { Migration, MigrationDatabase } from '../migrations.js';
import { createLogger } from '../../logger.js';

const debugLog = createLogger('database:migrations');

export const migration014: Migration = {
  version: 14,
  description: 'Add Payee column to transactions table',
  up: (db: MigrationDatabase) => {
    try {
      const result = db.exec(`PRAGMA table_info(transactions)`);
      const columns =
        result && result.length > 0 ? result[0].values.map((row: unknown[]) => row[1]) : [];
      if (!columns.includes('Payee')) {
        db.exec(`ALTER TABLE transactions ADD COLUMN Payee TEXT DEFAULT ''`);
      }
    } catch (error) {
      debugLog('[Migration 14] failed to add Payee column', { error });
      throw error;
    }
  },
  verify: (db: MigrationDatabase) => {
    const result = db.exec(`PRAGMA table_info(transactions)`);
    if (!result || result.length === 0) {
      return false;
    }
    const columns = result[0].values.map((row: unknown[]) => row[1]);
    return columns.includes('Payee');
  },
};
