import { describe, it, expect } from 'vitest';
import { NodeSqlJsAdapter } from '../src/index';
import { MigrationRunner } from '../src/database/migrations';

describe('NodeSqlJsAdapter + migrations', () => {
  it('initializes in-memory DB and migrates to latest schema', async () => {
    const adapter = await NodeSqlJsAdapter.create();
    const runner = new MigrationRunner(adapter);

    const version = runner.getCurrentVersion();
    expect(version).toBeGreaterThanOrEqual(1);
    expect(runner.needsMigration()).toBe(false);

    // sanity: budgets table exists
    const row = adapter
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='budgets'")
      .get() as { name?: string } | undefined;
    expect(!!row?.name).toBe(true);
  });
});
