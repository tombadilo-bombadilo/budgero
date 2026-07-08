import type { Migration, MigrationDatabase } from '../migrations.js';
import { createLogger } from '../../logger.js';

const debugLog = createLogger('database:migrations');

export const migration036: Migration = {
  version: 36,
  description: 'Add Position column to accounts for custom sidebar/nav ordering',
  up: (db: MigrationDatabase) => {
    try {
      db.exec(`ALTER TABLE accounts ADD COLUMN Position INTEGER`);
    } catch (error) {
      debugLog('[Migration 36] Position column may already exist on accounts', { error });
    }

    // Seed positions by existing creation order (ID) within each budget so the
    // current ordering is preserved until the user customizes it.
    db.exec(`
      UPDATE accounts
      SET Position = (
        SELECT COUNT(*)
        FROM accounts a2
        WHERE a2.BudgetID = accounts.BudgetID
          AND a2.ID < accounts.ID
      )
      WHERE Position IS NULL
    `);
  },
  verify: (db: MigrationDatabase) => {
    try {
      const info = db.exec(`PRAGMA table_info(accounts)`);
      const columns = info?.[0]?.values?.map((row: unknown[]) => row[1]) ?? [];
      return columns.includes('Position');
    } catch (error) {
      debugLog('[Migration 36] verification failed', { error });
      return false;
    }
  },
};
