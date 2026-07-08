import type { Migration, MigrationDatabase } from '../migrations.js';

export const migration032: Migration = {
  version: 32,
  description: 'Add Amount column to warranties table',
  up: `ALTER TABLE warranties ADD COLUMN Amount REAL NOT NULL DEFAULT 0;`,
  verify: (db: MigrationDatabase) => {
    try {
      const info = db.exec(`PRAGMA table_info(warranties)`);
      const columns = info?.[0]?.values?.map((row: unknown[]) => row[1]) ?? [];
      return columns.includes('Amount');
    } catch {
      return false;
    }
  },
};
