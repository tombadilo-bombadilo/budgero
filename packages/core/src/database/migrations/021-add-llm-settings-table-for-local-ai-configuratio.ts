import type { Migration, MigrationDatabase } from '../migrations.js';
import { createLogger } from '../../logger.js';

const debugLog = createLogger('database:migrations');

export const migration021: Migration = {
  version: 21,
  description: 'Add llm_settings table for local AI configuration',
  up: `
      CREATE TABLE IF NOT EXISTS llm_settings (
        ID              INTEGER PRIMARY KEY AUTOINCREMENT,
        BudgetID        INTEGER NOT NULL UNIQUE,
        Enabled         BOOLEAN NOT NULL DEFAULT 0,
        Provider        TEXT NOT NULL DEFAULT 'ollama',
        EndpointURL     TEXT NOT NULL DEFAULT 'http://localhost:11434',
        TextModel       TEXT NOT NULL DEFAULT 'llama3.2',
        VisionModel     TEXT NOT NULL DEFAULT 'llava',
        CreatedAt       TEXT NOT NULL DEFAULT (datetime('now')),
        UpdatedAt       TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (BudgetID) REFERENCES budgets(ID) ON DELETE CASCADE ON UPDATE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_llm_settings_budget ON llm_settings(BudgetID);
    `,
  verify: (db: MigrationDatabase) => {
    try {
      const table = db.exec(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='llm_settings'`
      );
      if (!table || table.length === 0) return false;
      const info = db.exec(`PRAGMA table_info(llm_settings)`);
      if (!info || info.length === 0) return false;
      const columns = info[0].values.map((row: unknown[]) => row[1]);
      return (
        columns.includes('Provider') &&
        columns.includes('EndpointURL') &&
        columns.includes('TextModel') &&
        columns.includes('VisionModel')
      );
    } catch (error) {
      debugLog('[Migration 21] verification failed', { error });
      return false;
    }
  },
};
