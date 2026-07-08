import type { Migration, MigrationDatabase } from '../migrations.js';
import { createLogger } from '../../logger.js';

const debugLog = createLogger('database:migrations');

export const migration011: Migration = {
  version: 11,
  description: 'Add transaction rules tables for automation engine',
  up: `
      CREATE TABLE IF NOT EXISTS transaction_rules (
        ID               INTEGER PRIMARY KEY AUTOINCREMENT,
        BudgetID         INTEGER NOT NULL,
        Name             TEXT NOT NULL,
        Description      TEXT NOT NULL DEFAULT '',
        ConditionsJSON   TEXT NOT NULL,
        ActionsJSON      TEXT NOT NULL,
        Mode             TEXT NOT NULL DEFAULT 'continuous',
        Enabled          BOOLEAN NOT NULL DEFAULT 1,
        OneTimeConsumed  BOOLEAN NOT NULL DEFAULT 0,
        RunOrder         INTEGER NOT NULL DEFAULT 0,
        LastRunAt        TEXT DEFAULT NULL,
        CreatedAt        TEXT NOT NULL DEFAULT (datetime('now')),
        UpdatedAt        TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (BudgetID) REFERENCES budgets(ID) ON DELETE CASCADE ON UPDATE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_transaction_rules_budget ON transaction_rules(BudgetID);
      CREATE INDEX IF NOT EXISTS idx_transaction_rules_enabled ON transaction_rules(BudgetID, Enabled);

      CREATE TABLE IF NOT EXISTS transaction_rule_runs (
        ID               INTEGER PRIMARY KEY AUTOINCREMENT,
        RuleID           INTEGER NOT NULL,
        Trigger          TEXT NOT NULL,
        StartedAt        TEXT NOT NULL DEFAULT (datetime('now')),
        CompletedAt      TEXT DEFAULT NULL,
        Status           TEXT NOT NULL DEFAULT 'pending',
        TransactionCount INTEGER NOT NULL DEFAULT 0,
        Notes            TEXT DEFAULT '',
        FOREIGN KEY (RuleID) REFERENCES transaction_rules(ID) ON DELETE CASCADE ON UPDATE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_transaction_rule_runs_rule ON transaction_rule_runs(RuleID);
      CREATE INDEX IF NOT EXISTS idx_transaction_rule_runs_started ON transaction_rule_runs(RuleID, StartedAt DESC);

      CREATE TABLE IF NOT EXISTS transaction_rule_run_changes (
        ID              INTEGER PRIMARY KEY AUTOINCREMENT,
        RunID           INTEGER NOT NULL,
        RuleID          INTEGER NOT NULL,
        TransactionID   INTEGER NOT NULL,
        ActionType      TEXT NOT NULL,
        Field           TEXT DEFAULT NULL,
        OldValue        TEXT DEFAULT NULL,
        NewValue        TEXT DEFAULT NULL,
        Metadata        TEXT DEFAULT NULL,
        FOREIGN KEY (RunID) REFERENCES transaction_rule_runs(ID) ON DELETE CASCADE ON UPDATE CASCADE,
        FOREIGN KEY (RuleID) REFERENCES transaction_rules(ID) ON DELETE CASCADE ON UPDATE CASCADE,
        FOREIGN KEY (TransactionID) REFERENCES transactions(ID) ON DELETE CASCADE ON UPDATE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_rule_run_changes_run ON transaction_rule_run_changes(RunID);
      CREATE INDEX IF NOT EXISTS idx_rule_run_changes_rule ON transaction_rule_run_changes(RuleID);
      CREATE INDEX IF NOT EXISTS idx_rule_run_changes_tx ON transaction_rule_run_changes(TransactionID);
    `,
  verify: (db: MigrationDatabase) => {
    const rules = db.exec(`PRAGMA table_info(transaction_rules)`);
    const runs = db.exec(`PRAGMA table_info(transaction_rule_runs)`);
    const changes = db.exec(`PRAGMA table_info(transaction_rule_run_changes)`);
    try {
      debugLog('[Migration 11 verify] PRAGMA transaction_rules', rules);
      debugLog('[Migration 11 verify] PRAGMA transaction_rule_runs', runs);
      debugLog('[Migration 11 verify] PRAGMA transaction_rule_run_changes', changes);
    } catch {
      /* noop logging */
    }
    return (
      !!rules?.length &&
      !!runs?.length &&
      !!changes?.length &&
      rules[0].values.some((row: unknown[]) => row[1] === 'ConditionsJSON') &&
      runs[0].values.some((row: unknown[]) => row[1] === 'Status') &&
      changes[0].values.some((row: unknown[]) => row[1] === 'TransactionID')
    );
  },
};
