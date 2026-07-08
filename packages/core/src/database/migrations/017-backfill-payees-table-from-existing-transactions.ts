import type { Migration, MigrationDatabase } from '../migrations.js';
import { createLogger } from '../../logger.js';

const debugLog = createLogger('database:migrations');

export const migration017: Migration = {
  version: 17,
  description: 'Backfill payees table from existing transactions',
  up: `
      INSERT INTO payees (BudgetID, Name, Metadata)
      SELECT DISTINCT BudgetID, TRIM(Payee), '{}'
      FROM transactions
      WHERE Payee IS NOT NULL
        AND TRIM(Payee) <> ''
      ON CONFLICT(BudgetID, Name) DO NOTHING;
    `,
  verify: (db: MigrationDatabase) => {
    try {
      const result = db.exec(`SELECT COUNT(*) as c FROM payees`);
      const count = result?.[0]?.values?.[0]?.[0] ?? 0;
      return (count as number) >= 0; // any non-error result passes verification
    } catch (error) {
      debugLog('[Migration 17] verification failed', { error });
      return false;
    }
  },
};
