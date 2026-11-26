import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
// The test runs the Node core build; its adapter stands in for the web one.
// eslint-disable-next-line no-restricted-imports
import { NodeSqlJsAdapter, ServiceManager } from '@budgero/core';
import { AppRuntime } from './app-runtime';

/** A Node core DB (sql.js finds its wasm relative to packages/core). */
async function nodeDb(): Promise<NodeSqlJsAdapter> {
  const cwd = vi.spyOn(process, 'cwd').mockReturnValue(resolve(process.cwd(), '../core'));
  try {
    return await NodeSqlJsAdapter.create();
  } finally {
    cwd.mockRestore();
  }
}

async function backupFromSpace(spaceId: string): Promise<Uint8Array> {
  const db = await nodeDb();
  const manager = new ServiceManager();
  await manager.initialize(db);
  await manager.getServices().budgets.createBudget({
    name: 'Restored',
    display_currency: 'USD',
    badge_icon: 'dollar',
    number_format: '123,456.78',
    create_default_categories: false,
  });
  db.exec(`UPDATE budgets SET SpaceID = '${spaceId}'`);
  return db.backup();
}

function runtimeOn(db: NodeSqlJsAdapter, spaceId: string): AppRuntime {
  const runtime = new AppRuntime();
  (runtime as unknown as { coordinator: object }).coordinator = {
    getDatabase: () => db,
    getActiveSpaceId: () => spaceId,
  };
  return runtime;
}

describe('AppRuntime.restoreBackup', () => {
  it('stamps a backup from another workspace with the active one', async () => {
    const data = await backupFromSpace('space-it-came-from');
    const db = await nodeDb();
    const runtime = runtimeOn(db, 'space-now-open');

    await runtime.restoreBackup(data);

    const manager = new ServiceManager();
    await manager.initialize(db);
    const budgets = manager.getServices().budgets.getAllBudgets('space-now-open');
    expect(budgets.map((b) => b.Name)).toEqual(['Restored']);
  });
});
