import type { Migration, MigrationDatabase } from '../migrations.js';
import { createLogger } from '../../logger.js';

const debugLog = createLogger('database:migrations');

export const migration029: Migration = {
  version: 29,
  description: 'Add labels table and transaction label support',
  up: (db: MigrationDatabase) => {
    const safeExec = (sql: string) => {
      try {
        db.exec(sql);
      } catch (error) {
        debugLog('[Migration 29] statement failed (may already exist)', { sql, error });
      }
    };

    safeExec(`
        CREATE TABLE IF NOT EXISTS labels (
          ID         INTEGER PRIMARY KEY AUTOINCREMENT,
          BudgetID   INTEGER NOT NULL,
          Name       TEXT NOT NULL,
          Color      TEXT NOT NULL,
          CreatedAt  TEXT NOT NULL DEFAULT (datetime('now')),
          UpdatedAt  TEXT DEFAULT (datetime('now')),
          FOREIGN KEY (BudgetID) REFERENCES budgets(ID) ON DELETE CASCADE ON UPDATE CASCADE
        )
      `);

    safeExec(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_labels_budget_name
        ON labels(BudgetID, Name COLLATE NOCASE)
      `);

    safeExec(`
        CREATE INDEX IF NOT EXISTS idx_labels_budget_name_lookup
        ON labels(BudgetID, Name)
      `);

    const hasLabelColumn = (() => {
      try {
        const txInfo = db.exec(`PRAGMA table_info(transactions)`);
        return txInfo?.[0]?.values?.some((row: unknown[]) => row[1] === 'LabelID') ?? false;
      } catch {
        return false;
      }
    })();

    if (!hasLabelColumn) {
      safeExec(`ALTER TABLE transactions ADD COLUMN LabelID INTEGER DEFAULT NULL`);
    }

    safeExec(`
        CREATE INDEX IF NOT EXISTS idx_transactions_label_id
        ON transactions(LabelID)
      `);

    // Clear any label references that point to missing labels.
    safeExec(`
        UPDATE transactions
        SET LabelID = NULL
        WHERE LabelID IS NOT NULL
          AND LabelID NOT IN (SELECT ID FROM labels)
      `);

    // Ensure transaction labels always belong to the same budget.
    safeExec(`
        UPDATE transactions
        SET LabelID = NULL
        WHERE LabelID IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
            FROM labels l
            WHERE l.ID = transactions.LabelID
              AND l.BudgetID = transactions.BudgetID
          )
      `);

    // Remove orphan labels that reference deleted budgets.
    safeExec(`
        DELETE FROM labels
        WHERE BudgetID NOT IN (SELECT ID FROM budgets)
      `);
  },
  verify: (db: MigrationDatabase) => {
    try {
      const labelsTable = db.exec(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='labels'`
      );
      if (!labelsTable || labelsTable.length === 0) {
        return false;
      }

      const labelsInfo = db.exec(`PRAGMA table_info(labels)`);
      const labelsColumns = labelsInfo?.[0]?.values?.map((row: unknown[]) => row[1]) ?? [];
      if (
        !labelsColumns.includes('BudgetID') ||
        !labelsColumns.includes('Name') ||
        !labelsColumns.includes('Color')
      ) {
        return false;
      }

      const txInfo = db.exec(`PRAGMA table_info(transactions)`);
      const txColumns = txInfo?.[0]?.values?.map((row: unknown[]) => row[1]) ?? [];
      return txColumns.includes('LabelID');
    } catch (error) {
      debugLog('[Migration 29] verification failed', { error });
      return false;
    }
  },
};
