import type { Migration, MigrationDatabase } from '../migrations.js';

export const migration009: Migration = {
  version: 9,
  description: 'Add purpose column to goals table for savings goals support',
  up: `
      -- Add purpose column to distinguish between spending and savings goals
      ALTER TABLE goals ADD COLUMN Purpose TEXT NOT NULL DEFAULT 'spending';
      
      -- Update existing goals to be spending goals (they all are currently)
      UPDATE goals SET Purpose = 'spending' WHERE Purpose IS NULL;
    `,
  verify: (db: MigrationDatabase) => {
    const result = db.exec(`PRAGMA table_info(goals)`);
    if (!result || result.length === 0) return false;
    const columns = result[0].values.map((row: unknown[]) => row[1]);
    return columns.includes('Purpose');
  },
};
