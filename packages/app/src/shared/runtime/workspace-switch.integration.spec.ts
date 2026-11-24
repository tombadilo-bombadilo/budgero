import { describe, expect, it, vi } from 'vitest';
import { QueryCache, QueryClient } from '@tanstack/react-query';
import type { ServiceManager } from '@budgero/core/browser';
import { queryRetry, queryRetryDelay } from '@shared/api/query-retry';
import { openServices } from '@shared/mutations/fuzz/harness';
import { AppRuntime } from './app-runtime';

// Triage #4 / #14 / #15: a workspace switch disposes the old session (and
// closes its sql.js DB) before AppRuntime rebinds services to the new one.
// Queries in that window used the closed DB and failed ("Database closed",
// reported as db_error). This drives the real AppRuntime rebind and the app's
// query retry policy over real databases; only the coordinator is a stub.

async function workspace(name: string) {
  const { adapter, manager } = await openServices();
  await manager.getServices().budgets.createBudget({
    name,
    display_currency: 'USD',
    badge_icon: 'wallet',
    number_format: 'en-US',
    create_default_categories: false,
  });
  return { adapter, manager };
}

function runtimeOn(manager: ServiceManager, adapter: unknown) {
  const runtime = new AppRuntime();
  let active: unknown = adapter;
  const internals = runtime as unknown as {
    coordinator: { getDatabase(): unknown; getActiveSpaceId(): string | null };
    serviceManager: ServiceManager;
    initializeServices(): Promise<void>;
  };
  internals.coordinator = { getDatabase: () => active, getActiveSpaceId: () => null };
  internals.serviceManager = manager;
  return {
    runtime,
    setActiveDatabase: (db: unknown) => {
      active = db;
    },
    rebindServices: () => internals.initializeServices(),
  };
}

function appQueryClient(onError: (error: unknown) => void) {
  return new QueryClient({
    queryCache: new QueryCache({ onError }),
    defaultOptions: { queries: { retry: queryRetry, retryDelay: queryRetryDelay } },
  });
}

const budgetNames = (runtime: AppRuntime) =>
  runtime
    .services()
    .budgets.getAllBudgets()
    .map((b) => b.Name);

describe('queries during a workspace switch', () => {
  it('the bug: services left on the closed database fail every query', async () => {
    const a = await workspace('Old');
    a.adapter.close();
    expect(() => a.manager.getServices().budgets.getAllBudgets()).toThrow();
  });

  it('wait for the new workspace instead of failing, and read its data', async () => {
    const a = await workspace('Old');
    const b = await workspace('New');
    const { runtime, setActiveDatabase, rebindServices } = runtimeOn(a.manager, a.adapter);
    const onError = vi.fn();
    const client = appQueryClient(onError);
    expect(budgetNames(runtime)).toEqual(['Old']);

    // Switch starts: the old session is disposed and its DB closed.
    a.adapter.close();
    setActiveDatabase(null);
    expect(runtime.servicesReady()).toBe(false);

    const query = client.fetchQuery({ queryKey: ['budgets'], queryFn: () => budgetNames(runtime) });

    // Snapshot download etc. takes longer than the old single 1 s retry.
    await new Promise((resolve) => setTimeout(resolve, 1600));
    setActiveDatabase(b.adapter);
    expect(runtime.servicesReady()).toBe(false); // new DB active, services not rebound yet
    await rebindServices();
    expect(runtime.servicesReady()).toBe(true);

    await expect(query).resolves.toEqual(['New']);
    expect(onError).not.toHaveBeenCalled();
  });

  it('still reports a query that stays broken after services are ready', async () => {
    const a = await workspace('Only');
    const { runtime } = runtimeOn(a.manager, a.adapter);
    const onError = vi.fn();
    const client = appQueryClient(onError);
    const query = client.fetchQuery({
      queryKey: ['broken'],
      queryFn: () => {
        runtime.services();
        throw new Error('real bug');
      },
      retryDelay: 1,
    });
    await expect(query).rejects.toThrow('real bug');
    expect(onError).toHaveBeenCalledTimes(1);
  });
});
