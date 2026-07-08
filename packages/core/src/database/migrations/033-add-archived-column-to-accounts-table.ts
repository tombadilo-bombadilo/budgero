import type { Migration, MigrationDatabase } from '../migrations.js';

export const migration033: Migration = {
  version: 33,
  description: 'Add Archived column to accounts table',
  up: `ALTER TABLE accounts ADD COLUMN Archived INTEGER NOT NULL DEFAULT 0;`,
  verify: (db: MigrationDatabase) => {
    try {
      const info = db.exec(`PRAGMA table_info(accounts)`);
      const columns = info?.[0]?.values?.map((row: unknown[]) => row[1]) ?? [];
      return columns.includes('Archived');
    } catch {
      return false;
    }
  },
};
