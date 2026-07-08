import type { Migration, MigrationDatabase } from '../migrations.js';

export const migration034: Migration = {
  version: 34,
  description: 'Add Recurring column to goals table',
  up: `
      ALTER TABLE goals ADD COLUMN Recurring INTEGER NOT NULL DEFAULT 0;
      UPDATE goals SET Recurring = 1 WHERE Type = 'yearly';
    `,
  verify: (db: MigrationDatabase) => {
    try {
      const info = db.exec(`PRAGMA table_info(goals)`);
      const columns = info?.[0]?.values?.map((row: unknown[]) => row[1]) ?? [];
      return columns.includes('Recurring');
    } catch {
      return false;
    }
  },
};
