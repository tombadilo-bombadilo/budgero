import initSqlJs from 'sql.js';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { NodeSqlJsAdapter } from '../src/database/node-sqljs-adapter.js';
import { migrations } from '../src/database/migrations.js';
import { createMigrationDatabase } from '../src/database/migration-database-factory.js';

/** Builds a v38 (pre-milliunit) database blob with a float-money transaction. */
async function buildV38Blob(): Promise<Uint8Array> {
  const SQL = await initSqlJs({
    locateFile: (file: string) => path.join(process.cwd(), 'node_modules', 'sql.js', 'dist', file),
  });
  const raw = new SQL.Database();
  const db = createMigrationDatabase(raw);
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY, applied_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  for (const m of migrations.filter((x) => x.version <= 38)) {
    try {
      if (typeof m.up === 'function') m.up(db);
      else db.exec(m.up);
    } catch (error) {
      if (!(error instanceof Error && error.message.includes('duplicate column'))) throw error;
    }
    db.exec(`INSERT OR REPLACE INTO schema_migrations (version) VALUES (${m.version})`);
  }
  // Same-currency transactions always store *Original == the converted value
  // (that's what addTransaction persists); the migration recomputes Balance
  // from the originals, so seed them the way real data has them.
  db.exec(`
    INSERT INTO accounts (ID, Name, Currency, Type, Balance, BudgetID)
    VALUES (1, 'Checking', 'USD', 'checking', 149.79, 1);
    INSERT INTO transactions (ID, CategoryID, AccountID, Date, Inflow, Outflow,
      InflowOriginal, OutflowOriginal, RunningBalance, RunningBalanceOriginal, BudgetID)
    VALUES (1, 1, 1, '2026-01-01', 100.10, 0, 100.10, 0, 100.10, 100.10, 1);
  `);
  return raw.export();
}

describe('restoreAndMigrate', () => {
  it('brings an older (v38 float) backup up to the current milliunit schema', async () => {
    const blob = await buildV38Blob();

    // A live adapter starts at the current schema version.
    const adapter = await NodeSqlJsAdapter.create();
    adapter.restoreAndMigrate(blob);

    const version = adapter.exec('SELECT MAX(version) AS v FROM schema_migrations');
    expect(version[0].values[0][0]).toBe(Math.max(...migrations.map((m) => m.version)));

    // Float dollars are now integer milliunits.
    const tx = adapter.exec('SELECT Inflow, RunningBalance, typeof(Inflow) AS t FROM transactions');
    expect(tx[0].values[0][0]).toBe(100100);
    expect(tx[0].values[0][1]).toBe(100100);
    expect(tx[0].values[0][2]).toBe('integer');

    // Balance is recomputed from transaction history (one +$100.10 row),
    // not copied from the stored account value.
    const acct = adapter.exec('SELECT Balance FROM accounts WHERE ID = 1');
    expect(acct[0].values[0][0]).toBe(100100);
  });

  it('plain restore does NOT migrate (documents the old bug the UI hit)', async () => {
    const blob = await buildV38Blob();
    const adapter = await NodeSqlJsAdapter.create();
    adapter.restore(blob);
    // Left at v38: money still float — this is why the manual restore path
    // must call restoreAndMigrate, not restore.
    const tx = adapter.exec('SELECT typeof(Inflow) AS t FROM transactions');
    expect(tx[0].values[0][0]).toBe('real');
  });
});
