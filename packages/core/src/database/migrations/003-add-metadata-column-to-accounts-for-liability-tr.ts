import type { Migration, MigrationDatabase } from '../migrations.js';

export const migration003: Migration = {
  version: 3,
  description: 'Add metadata column to accounts for liability tracking',
  up: `
      -- Add metadata column for storing JSON data about liabilities
      ALTER TABLE accounts ADD COLUMN Metadata TEXT;
    `,
  verify: (db: MigrationDatabase) => {
    const result = db.exec(`PRAGMA table_info(accounts)`);
    if (!result || result.length === 0) return false;
    const columns = result[0].values.map((row: unknown[]) => row[1]);
    return columns.includes('Metadata');
  },
};
