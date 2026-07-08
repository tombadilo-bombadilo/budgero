import type { Migration, MigrationDatabase } from '../migrations.js';

export const migration031: Migration = {
  version: 31,
  description: 'Add warranties table for product warranty tracking',
  up: `
      CREATE TABLE IF NOT EXISTS warranties (
        ID            INTEGER PRIMARY KEY AUTOINCREMENT,
        BudgetID      INTEGER NOT NULL,
        Name          TEXT NOT NULL,
        ExpiresAt     TEXT NOT NULL,
        TransactionID INTEGER DEFAULT NULL,
        ReceiptImage  BLOB DEFAULT NULL,
        Notes         TEXT NOT NULL DEFAULT '',
        CreatedAt     TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (BudgetID) REFERENCES budgets(ID) ON DELETE CASCADE ON UPDATE CASCADE,
        FOREIGN KEY (TransactionID) REFERENCES transactions(ID) ON DELETE SET NULL ON UPDATE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_warranties_budget ON warranties(BudgetID);
      CREATE INDEX IF NOT EXISTS idx_warranties_expires ON warranties(BudgetID, ExpiresAt);
    `,
  verify: (db: MigrationDatabase) => {
    try {
      const table = db.exec(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='warranties'`
      );
      if (!table || table.length === 0) return false;
      const info = db.exec(`PRAGMA table_info(warranties)`);
      const columns = info?.[0]?.values?.map((row: unknown[]) => row[1]) ?? [];
      return (
        columns.includes('BudgetID') &&
        columns.includes('Name') &&
        columns.includes('ExpiresAt') &&
        columns.includes('TransactionID') &&
        columns.includes('ReceiptImage')
      );
    } catch {
      return false;
    }
  },
};
