import type { Migration, MigrationDatabase } from '../migrations.js';
import { createLogger } from '../../logger.js';

const debugLog = createLogger('database:migrations');

export const migration018: Migration = {
  version: 18,
  description: 'Add mutation_history table for tracking all mutations with undo support',
  up: `
      CREATE TABLE IF NOT EXISTS mutation_history (
        ID              INTEGER PRIMARY KEY AUTOINCREMENT,
        BudgetID        INTEGER NOT NULL,
        MutationID      TEXT NOT NULL UNIQUE,
        Timestamp       TEXT NOT NULL DEFAULT (datetime('now')),
        UserID          TEXT,
        Op              TEXT NOT NULL,
        Payload         TEXT NOT NULL,
        Origin          TEXT NOT NULL CHECK(Origin IN ('local', 'remote')),
        UndoOps         TEXT,
        RedoOps         TEXT,
        UndoneAt        TEXT,
        FOREIGN KEY (BudgetID) REFERENCES budgets(ID) ON DELETE CASCADE ON UPDATE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_mutation_history_budget_ts ON mutation_history(BudgetID, Timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_mutation_history_mutation_id ON mutation_history(MutationID);
    `,
  verify: (db: MigrationDatabase) => {
    try {
      const table = db.exec(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='mutation_history'`
      );
      if (!table || table.length === 0) return false;
      const info = db.exec(`PRAGMA table_info(mutation_history)`);
      if (!info || info.length === 0) return false;
      const columns = info[0].values.map((row: unknown[]) => row[1]);
      return (
        columns.includes('MutationID') &&
        columns.includes('Op') &&
        columns.includes('Payload') &&
        columns.includes('Origin') &&
        columns.includes('UndoOps')
      );
    } catch (error) {
      debugLog('[Migration 18] verification failed', { error });
      return false;
    }
  },
};
