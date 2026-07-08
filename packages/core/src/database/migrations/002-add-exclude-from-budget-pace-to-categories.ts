import type { Migration, MigrationDatabase } from '../migrations.js';

export const migration002: Migration = {
  version: 2,
  description: 'Add exclude_from_budget_pace to categories',
  up: `
      -- Check if column exists before adding (idempotent)
      -- SQLite doesn't have IF NOT EXISTS for columns, so we handle in code
      ALTER TABLE categories ADD COLUMN ExcludeFromBudgetPace BOOLEAN DEFAULT FALSE;
    `,
  verify: (db: MigrationDatabase) => {
    const result = db.exec(`PRAGMA table_info(categories)`);
    if (!result || result.length === 0) return false;
    const columns = result[0].values.map((row: unknown[]) => row[1]);
    return columns.includes('ExcludeFromBudgetPace');
  },
};
