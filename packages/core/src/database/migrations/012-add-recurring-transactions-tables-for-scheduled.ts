import type { Migration, MigrationDatabase } from '../migrations.js';

export const migration012: Migration = {
  version: 12,
  description: 'Add recurring transactions tables for scheduled items',
  up: `
      CREATE TABLE IF NOT EXISTS recurring_transactions (
        ID                INTEGER PRIMARY KEY AUTOINCREMENT,
        BudgetID          INTEGER NOT NULL,
        AccountID         INTEGER NOT NULL,
        CategoryID        INTEGER,
        Name              TEXT NOT NULL,
        Memo              TEXT NOT NULL DEFAULT '',
        Amount            REAL NOT NULL,
        Direction         TEXT NOT NULL CHECK(Direction IN ('inflow','outflow')),
        ScheduleJSON      TEXT NOT NULL,
        NotifyDaysBefore  INTEGER NOT NULL DEFAULT 0,
        LastOccurrenceDate TEXT DEFAULT NULL,
        Active            BOOLEAN NOT NULL DEFAULT 1,
        CreatedAt         TEXT NOT NULL DEFAULT (datetime('now')),
        UpdatedAt         TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (BudgetID) REFERENCES budgets(ID) ON DELETE CASCADE ON UPDATE CASCADE,
        FOREIGN KEY (AccountID) REFERENCES accounts(ID) ON DELETE CASCADE ON UPDATE CASCADE,
        FOREIGN KEY (CategoryID) REFERENCES categories(ID) ON DELETE SET NULL ON UPDATE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_recurring_transactions_budget ON recurring_transactions(BudgetID);
      CREATE INDEX IF NOT EXISTS idx_recurring_transactions_active ON recurring_transactions(BudgetID, Active);

      CREATE TABLE IF NOT EXISTS recurring_transaction_occurrences (
        ID                     INTEGER PRIMARY KEY AUTOINCREMENT,
        RecurringTransactionID INTEGER NOT NULL,
        BudgetID               INTEGER NOT NULL,
        DueDate                TEXT NOT NULL,
        Status                 TEXT NOT NULL DEFAULT 'scheduled',
        TransactionID          INTEGER DEFAULT NULL,
        NotifiedAt             TEXT DEFAULT NULL,
        ReadyAt                TEXT DEFAULT NULL,
        CreatedAt              TEXT NOT NULL DEFAULT (datetime('now')),
        UpdatedAt              TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (RecurringTransactionID) REFERENCES recurring_transactions(ID) ON DELETE CASCADE ON UPDATE CASCADE,
        FOREIGN KEY (BudgetID) REFERENCES budgets(ID) ON DELETE CASCADE ON UPDATE CASCADE,
        FOREIGN KEY (TransactionID) REFERENCES transactions(ID) ON DELETE SET NULL ON UPDATE CASCADE,
        UNIQUE(RecurringTransactionID, DueDate)
      );

      CREATE INDEX IF NOT EXISTS idx_recurring_occurrences_budget_due ON recurring_transaction_occurrences(BudgetID, DueDate);
      CREATE INDEX IF NOT EXISTS idx_recurring_occurrences_status ON recurring_transaction_occurrences(Status, DueDate);
    `,
  verify: (db: MigrationDatabase) => {
    const recurring = db.exec(`PRAGMA table_info(recurring_transactions)`);
    const occurrences = db.exec(`PRAGMA table_info(recurring_transaction_occurrences)`);
    return Boolean(recurring && recurring.length && occurrences && occurrences.length);
  },
};
