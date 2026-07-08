import type { Migration, MigrationDatabase } from '../migrations.js';

export const migration010: Migration = {
  version: 10,
  description: 'Add manual_currency_rates table for offline/manual rates (static per pair)',
  up: `
      CREATE TABLE IF NOT EXISTS manual_currency_rates (
        ID           INTEGER PRIMARY KEY AUTOINCREMENT,
        FromCurrency TEXT NOT NULL,
        ToCurrency   TEXT NOT NULL,
        Rate         REAL NOT NULL,
        CreatedAt    TEXT NOT NULL,
        BudgetID     INTEGER NOT NULL,
        FOREIGN KEY (BudgetID) REFERENCES budgets(ID) ON DELETE CASCADE ON UPDATE CASCADE,
        UNIQUE(FromCurrency, ToCurrency, BudgetID)
      );
    `,
  verify: (db: MigrationDatabase) => {
    const result = db.exec(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='manual_currency_rates'`
    );
    return result && result.length > 0;
  },
};
