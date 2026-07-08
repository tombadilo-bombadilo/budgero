import type { Migration, MigrationDatabase } from '../migrations.js';
import { createLogger } from '../../logger.js';

const debugLog = createLogger('database:migrations');

export const migration038: Migration = {
  version: 38,
  description: 'Add transactions(BudgetID, AccountID, Date) index for analytics balance queries',
  up: (db: MigrationDatabase) => {
    // Previously created lazily inside AnalyticsService getters; owned by a
    // migration now so query methods stay DDL-free.
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_transactions_budget_account_date
      ON transactions(BudgetID, AccountID, Date)
    `);
  },
  verify: (db: MigrationDatabase) => {
    try {
      const result = db.exec(
        `SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_transactions_budget_account_date'`
      );
      return Boolean(result?.[0]?.values?.length);
    } catch (error) {
      debugLog('[Migration 38] verification failed', { error });
      return false;
    }
  },
};
