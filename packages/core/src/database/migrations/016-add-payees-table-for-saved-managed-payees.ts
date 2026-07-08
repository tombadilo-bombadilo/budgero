import type { Migration, MigrationDatabase } from '../migrations.js';
import { createLogger } from '../../logger.js';

const debugLog = createLogger('database:migrations');

export const migration016: Migration = {
  version: 16,
  description: 'Add payees table for saved/managed payees',
  up: `
      CREATE TABLE IF NOT EXISTS payees (
        ID         INTEGER PRIMARY KEY AUTOINCREMENT,
        BudgetID   INTEGER NOT NULL,
        Name       TEXT NOT NULL,
        Metadata   TEXT DEFAULT NULL,
        CreatedAt  TEXT NOT NULL DEFAULT (datetime('now')),
        UpdatedAt  TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (BudgetID) REFERENCES budgets(ID) ON DELETE CASCADE ON UPDATE CASCADE
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_payees_budget_name ON payees(BudgetID, Name COLLATE NOCASE);
    `,
  verify: (db: MigrationDatabase) => {
    try {
      const table = db.exec(`SELECT name FROM sqlite_master WHERE type='table' AND name='payees'`);
      if (!table || table.length === 0) return false;
      const info = db.exec(`PRAGMA table_info(payees)`);
      if (!info || info.length === 0) return false;
      const columns = info[0].values.map((row: unknown[]) => row[1]);
      return columns.includes('BudgetID') && columns.includes('Name');
    } catch (error) {
      debugLog('[Migration 16] verification failed', { error });
      return false;
    }
  },
};
