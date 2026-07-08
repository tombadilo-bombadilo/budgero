import type { Migration, MigrationDatabase } from '../migrations.js';

export const migration035: Migration = {
  // Renumbered from 8 — it was a DUPLICATE of the transaction_splits migration
  // (also version 8), so on any DB already at version 8 the runner filtered it out
  // (`version > current`) and it never ran. Renumbered to 35 (next free version) and
  // made idempotent so it runs exactly once on every DB, old or new.
  version: 35,
  description: 'Add ConversionPending flag to transactions',
  up: (db: MigrationDatabase) => {
    const info = db.exec(`PRAGMA table_info(transactions)`);
    const columns = info?.[0]?.values.map((row: unknown[]) => row[1]) ?? [];
    if (!columns.includes('ConversionPending')) {
      db.exec(`ALTER TABLE transactions ADD COLUMN ConversionPending BOOLEAN NOT NULL DEFAULT 0;`);
    }
  },
  verify: (db: MigrationDatabase) => {
    const result = db.exec(`PRAGMA table_info(transactions)`);
    if (!result || result.length === 0) return false;
    const columns = result[0].values.map((row: unknown[]) => row[1]);
    return columns.includes('ConversionPending');
  },
};
