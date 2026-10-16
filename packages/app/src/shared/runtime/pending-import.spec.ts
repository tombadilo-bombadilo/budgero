import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
// Real services over the Node adapter; production uses the browser entry.
// eslint-disable-next-line no-restricted-imports
import { NodeSqlJsAdapter, ServiceManager, type Services } from '@budgero/core';
import { clearPendingImport, discardInterruptedImports, markPendingImport } from './pending-import';

async function services(): Promise<Services> {
  const cwd = vi.spyOn(process, 'cwd').mockReturnValue(resolve(process.cwd(), '../core'));
  try {
    const manager = new ServiceManager();
    await manager.initialize(await NodeSqlJsAdapter.create());
    return manager.getServices();
  } finally {
    cwd.mockRestore();
  }
}

const create = (s: Services, name: string) =>
  s.budgets.createBudget({
    name,
    space_id: 'space-1',
    display_currency: 'USD',
    badge_icon: 'dollar',
    number_format: '123,456.78',
    create_default_categories: false,
  });

/** Simulate a page reload: the in-page registry of running imports is gone. */
async function reloadModule() {
  vi.resetModules();
  return import('./pending-import');
}

afterEach(() => localStorage.clear());

describe('interrupted out-of-band import cleanup', () => {
  it('removes the budget an import left behind when the page died', async () => {
    const s = await services();
    const kept = await create(s, 'Everyday');
    const halfImported = await create(s, 'From YNAB');
    markPendingImport({ spaceId: 'space-1', budgetId: halfImported, name: 'From YNAB' });

    const fresh = await reloadModule();
    expect(fresh.discardInterruptedImports('space-1', s.budgets)).toEqual([halfImported]);
    expect(s.budgets.getAllBudgets().map((b) => b.ID)).toEqual([kept]);
    // The marker is gone, so it never runs twice.
    expect(fresh.discardInterruptedImports('space-1', s.budgets)).toEqual([]);
  });

  it('never touches a running import, another workspace, or a budget that reused the ID', async () => {
    const s = await services();
    const running = await create(s, 'Running');
    markPendingImport({ spaceId: 'space-1', budgetId: running, name: 'Running' });
    expect(discardInterruptedImports('space-1', s.budgets)).toEqual([]);

    const other = await create(s, 'Other space import');
    markPendingImport({ spaceId: 'space-2', budgetId: other, name: 'Other space import' });
    const reused = await create(s, 'Created later');
    markPendingImport({ spaceId: 'space-1', budgetId: reused, name: 'Half import' });

    const fresh = await reloadModule();
    expect(fresh.discardInterruptedImports('space-1', s.budgets)).toEqual([running]);
    expect(s.budgets.getAllBudgets().map((b) => b.Name)).toEqual([
      'Other space import',
      'Created later',
    ]);
  });

  it('forgets an import once it was accepted or rolled back', async () => {
    const s = await services();
    const accepted = await create(s, 'Accepted');
    markPendingImport({ spaceId: 'space-1', budgetId: accepted, name: 'Accepted' });
    clearPendingImport('space-1', accepted);
    const fresh = await reloadModule();
    expect(fresh.discardInterruptedImports('space-1', s.budgets)).toEqual([]);
    expect(s.budgets.getAllBudgets().map((b) => b.Name)).toEqual(['Accepted']);
  });
});
