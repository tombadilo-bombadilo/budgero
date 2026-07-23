import type { Migration, MigrationDatabase } from '../migrations.js';

export const migration041: Migration = {
  version: 41,
  description: 'Add scenarios table for the analytics scenario planner',
  // Payload is a JSON document (versioned via a `version` field inside) so
  // the planner can evolve its knobs without further schema migrations.
  up: `
    CREATE TABLE IF NOT EXISTS scenarios (
      ID        TEXT PRIMARY KEY,
      BudgetID  INTEGER NOT NULL,
      Name      TEXT NOT NULL,
      Payload   TEXT NOT NULL,
      CreatedAt TEXT NOT NULL,
      UpdatedAt TEXT NOT NULL,
      FOREIGN KEY (BudgetID) REFERENCES budgets(ID) ON DELETE CASCADE ON UPDATE CASCADE
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_scenarios_budget_name
    ON scenarios(BudgetID, Name COLLATE NOCASE);
  `,
  verify: (db: MigrationDatabase) => {
    try {
      const info = db.exec(`PRAGMA table_info(scenarios)`);
      const columns = info?.[0]?.values?.map((row: unknown[]) => row[1]) ?? [];
      return columns.includes('Payload') && columns.includes('BudgetID');
    } catch {
      return false;
    }
  },
};
