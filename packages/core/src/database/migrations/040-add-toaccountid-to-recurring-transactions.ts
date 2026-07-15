import type { Migration, MigrationDatabase } from '../migrations.js';

export const migration040: Migration = {
  version: 40,
  description: 'Add ToAccountID column to recurring_transactions for recurring transfers',
  // A recurring transfer keeps Direction = 'outflow' (money leaves AccountID)
  // and stores the destination here; NULL means a regular income/bill template.
  up: `ALTER TABLE recurring_transactions ADD COLUMN ToAccountID INTEGER DEFAULT NULL REFERENCES accounts(ID) ON DELETE CASCADE ON UPDATE CASCADE;`,
  verify: (db: MigrationDatabase) => {
    try {
      const info = db.exec(`PRAGMA table_info(recurring_transactions)`);
      const columns = info?.[0]?.values?.map((row: unknown[]) => row[1]) ?? [];
      return columns.includes('ToAccountID');
    } catch {
      return false;
    }
  },
};
