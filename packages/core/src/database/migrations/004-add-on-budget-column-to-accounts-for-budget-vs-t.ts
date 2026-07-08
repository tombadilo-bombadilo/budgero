import type { Migration, MigrationDatabase } from '../migrations.js';

export const migration004: Migration = {
  version: 4,
  description: 'Add on_budget column to accounts for budget vs tracking distinction',
  up: `
      ALTER TABLE accounts ADD COLUMN OnBudget BOOLEAN NOT NULL DEFAULT TRUE;
      
      -- Set default values based on account type
      -- Off-budget: mortgages, real estate, other assets
      UPDATE accounts 
      SET OnBudget = FALSE 
      WHERE LOWER(Type) IN ('mortgage', 'real estate', 'other asset');
    `,
  verify: (db: MigrationDatabase) => {
    const result = db.exec(`PRAGMA table_info(accounts)`);
    if (!result || result.length === 0) return false;
    const columns = result[0].values.map((row: unknown[]) => row[1]);
    return columns.includes('OnBudget');
  },
};
