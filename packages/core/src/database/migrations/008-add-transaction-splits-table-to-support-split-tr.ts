import type { Migration, MigrationDatabase } from '../migrations.js';

export const migration008: Migration = {
  version: 8,
  description: 'Add transaction_splits table to support split transactions',
  up: `
      CREATE TABLE IF NOT EXISTS transaction_splits (
        ID                  INTEGER PRIMARY KEY AUTOINCREMENT,
        TransactionID       INTEGER NOT NULL,
        CategoryID          INTEGER,
        TransferAccountID   INTEGER,
        Memo                TEXT NOT NULL DEFAULT '',
        Inflow              REAL NOT NULL DEFAULT 0.0,
        Outflow             REAL NOT NULL DEFAULT 0.0,
        InflowOriginal      REAL DEFAULT NULL,
        OutflowOriginal     REAL DEFAULT NULL,
        PairID              TEXT DEFAULT NULL,
        OrderIndex          INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (TransactionID) REFERENCES transactions(ID) ON DELETE CASCADE ON UPDATE CASCADE,
        FOREIGN KEY (CategoryID) REFERENCES categories(ID) ON DELETE SET NULL ON UPDATE CASCADE,
        FOREIGN KEY (TransferAccountID) REFERENCES accounts(ID) ON DELETE SET NULL ON UPDATE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_transaction_splits_transaction_id ON transaction_splits(TransactionID);
      CREATE INDEX IF NOT EXISTS idx_transaction_splits_category_id ON transaction_splits(CategoryID);
    `,
  verify: (db: MigrationDatabase) => {
    const result = db.exec(`PRAGMA table_info(transaction_splits)`);
    return result && result.length > 0;
  },
};
