import type { Migration, MigrationDatabase } from '../migrations.js';
import { createLogger } from '../../logger.js';

const debugLog = createLogger('database:migrations');

export const migration028: Migration = {
  version: 28,
  description: 'Add exchange rate tracking to transactions and custom currency rates table',
  up: (db: MigrationDatabase) => {
    const safeExec = (sql: string) => {
      try {
        db.exec(sql);
      } catch (error) {
        debugLog('[Migration 28] statement failed (may already exist)', { sql, error });
      }
    };

    // 1a. Add ExchangeRate and ExchangeRateOverride columns to transactions
    safeExec(`ALTER TABLE transactions ADD COLUMN ExchangeRate REAL DEFAULT NULL`);
    safeExec(`ALTER TABLE transactions ADD COLUMN ExchangeRateOverride BOOLEAN NOT NULL DEFAULT 0`);

    // 1b. Backfill existing transactions with calculated exchange rates
    safeExec(`
        UPDATE transactions
        SET ExchangeRate = CASE
          WHEN OutflowOriginal IS NOT NULL AND OutflowOriginal != 0 AND Outflow != OutflowOriginal
            THEN Outflow / OutflowOriginal
          WHEN InflowOriginal IS NOT NULL AND InflowOriginal != 0 AND Inflow != InflowOriginal
            THEN Inflow / InflowOriginal
          ELSE NULL
        END
        WHERE ExchangeRate IS NULL
      `);

    // 1c. Create custom_currency_rates table
    safeExec(`
        CREATE TABLE IF NOT EXISTS custom_currency_rates (
          ID           INTEGER PRIMARY KEY AUTOINCREMENT,
          FromCurrency TEXT NOT NULL,
          ToCurrency   TEXT NOT NULL,
          Rate         REAL NOT NULL,
          StartDate    TEXT NOT NULL,
          EndDate      TEXT DEFAULT NULL,
          BudgetID     INTEGER NOT NULL,
          CreatedAt    TEXT NOT NULL DEFAULT (datetime('now')),
          UpdatedAt    TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (BudgetID) REFERENCES budgets(ID) ON DELETE CASCADE
        )
      `);
    safeExec(`
        CREATE INDEX IF NOT EXISTS idx_custom_currency_rates_lookup
        ON custom_currency_rates(FromCurrency, ToCurrency, BudgetID, StartDate)
      `);
  },
  verify: (db: MigrationDatabase) => {
    try {
      const txInfo = db.exec(`PRAGMA table_info(transactions)`);
      if (!txInfo || txInfo.length === 0) return false;
      const txColumns = txInfo[0].values.map((row: unknown[]) => row[1]);
      if (!txColumns.includes('ExchangeRate') || !txColumns.includes('ExchangeRateOverride')) {
        return false;
      }

      const tableCheck = db.exec(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='custom_currency_rates'`
      );
      if (!tableCheck || tableCheck.length === 0) return false;

      return true;
    } catch (error) {
      debugLog('[Migration 28] verification failed', { error });
      return false;
    }
  },
};
