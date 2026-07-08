import type { Migration, MigrationDatabase } from '../migrations.js';

export const migration015: Migration = {
  version: 15,
  description: 'Create import_runs table for import history tracking',
  up: `
      CREATE TABLE IF NOT EXISTS import_runs (
        ID               INTEGER PRIMARY KEY AUTOINCREMENT,
        BudgetID         INTEGER NOT NULL,
        SourceType       TEXT NOT NULL,
        SourceName       TEXT NOT NULL,
        SummaryJSON      TEXT NOT NULL,
        TransactionIDs   TEXT NOT NULL,
        AccountIDs       TEXT NOT NULL,
        CategoryIDs      TEXT NOT NULL,
        Status           TEXT NOT NULL DEFAULT 'completed',
        CreatedAt        TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (BudgetID) REFERENCES budgets(ID) ON DELETE CASCADE ON UPDATE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_import_runs_budget ON import_runs(BudgetID, CreatedAt DESC);
    `,
  verify: (db: MigrationDatabase) => {
    const table = db.exec(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='import_runs'`
    );
    if (!table || table.length === 0) {
      return false;
    }
    const info = db.exec(`PRAGMA table_info(import_runs)`);
    if (!info || info.length === 0) {
      return false;
    }
    const columns = info[0].values.map((row: unknown[]) => row[1]);
    return (
      columns.includes('SummaryJSON') &&
      columns.includes('TransactionIDs') &&
      columns.includes('Status')
    );
  },
};
