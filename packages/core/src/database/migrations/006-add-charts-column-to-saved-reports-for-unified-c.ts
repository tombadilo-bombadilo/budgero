import type { Migration, MigrationDatabase } from '../migrations.js';

export const migration006: Migration = {
  version: 6,
  description: 'Add charts column to saved_reports for unified configurations',
  up: `
      ALTER TABLE saved_reports ADD COLUMN Charts TEXT DEFAULT '[]';
    `,
  verify: (db: MigrationDatabase) => {
    const result = db.exec(`PRAGMA table_info(saved_reports)`);
    if (!result || result.length === 0) return false;
    const columns = result[0].values.map((row: unknown[]) => row[1]);
    return columns.includes('Charts');
  },
};
