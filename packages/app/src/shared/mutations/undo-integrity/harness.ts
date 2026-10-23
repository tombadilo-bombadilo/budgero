/**
 * Test harness for undo/redo integrity specs: real core services on an
 * in-memory sql.js database, the real MutationExecutor and the real UndoStore.
 * Specs mock '@shared/runtime/global' to return `harness.runtime`.
 */
import { resolve } from 'node:path';
import { vi } from 'vitest';
// The harness needs the Node database adapter; production uses the browser entry.
// eslint-disable-next-line no-restricted-imports
import { asMilli, NodeSqlJsAdapter, ServiceManager, type Services } from '@budgero/core';
import { MutationExecutor, type MutationSpec, type UndoEntry } from '@budgero/runtime';
import {
  executeMutationOp,
  getInvalidatesForOp,
  getUndoSpec,
} from '@shared/mutations/op-code-registry';
import { useUndoStore } from '@shared/mutations/UndoStore';

export const SPACE_ID = 'space-1';

export type Row = Record<string, unknown>;

export interface UndoHarness {
  services: Services;
  adapter: NodeSqlJsAdapter;
  budgetId: number;
  accountId: number;
  categoryId: number;
  /** What getRuntime() returns. */
  runtime: {
    services: () => Services;
    mutationsRouter: () => { execute: (spec: MutationSpec) => Promise<unknown> };
    getActiveSpaceId: () => string;
  };
  /** Every spec the router executed (undo/redo replays included). */
  executed: MutationSpec[];
  /** Run an op as a local user action, like a hook does. */
  run: <T = unknown>(op: string, payload: Record<string, unknown>) => Promise<T>;
  /** `SELECT *` of a table, ordered by ID. */
  rows: (table: string) => Row[];
  /** Rows of several tables, keyed by table. */
  dump: (tables: string[]) => Record<string, Row[]>;
}

export async function createUndoHarness(): Promise<UndoHarness> {
  const manager = new ServiceManager();
  const cwd = vi.spyOn(process, 'cwd').mockReturnValue(resolve(process.cwd(), '../core'));
  let adapter: NodeSqlJsAdapter;
  try {
    adapter = await NodeSqlJsAdapter.create();
    await manager.initialize(adapter);
  } finally {
    cwd.mockRestore();
  }
  const services = manager.getServices();
  const budgetId = await services.budgets.createBudget({
    name: 'Undo integrity',
    display_currency: 'USD',
    badge_icon: 'dollar',
    number_format: '123,456.78',
    create_default_categories: true,
  });
  const accountId = (
    await services.accounts.createAccount('Checking', budgetId, 'checking', 'USD', asMilli(0))
  ).ID;
  const categoryId = services.categories
    .getAllCategories(budgetId)
    .find((category) => !['Income', 'Uncategorized', 'Transfers'].includes(category.Name))!.ID;

  const executed: MutationSpec[] = [];
  const executor = new MutationExecutor({
    executeOp: executeMutationOp,
    getUndoSpec,
    getInvalidatesForOp,
    getInvalidatesForCall: (op: string, args: Record<string, unknown>) =>
      getInvalidatesForOp(op, args),
    getQueryClient: () => undefined,
    pushUndo: (entry: UndoEntry) => useUndoStore.getState().push(entry),
    recordHistory: (entry) =>
      services.mutationHistory.record({
        ...entry,
        status: entry.status as 'success' | 'failed' | undefined,
        errorCode: null,
        errorMessage: null,
      }),
    getActiveSpaceId: () => SPACE_ID,
    getSpaceRole: () => 'owner',
  } as ConstructorParameters<typeof MutationExecutor>[0]);

  const router = {
    execute: async (spec: MutationSpec) => {
      executed.push(spec);
      return executor.execute({ ...spec, spaceId: spec.spaceId ?? SPACE_ID });
    },
  };

  const rows = (table: string): Row[] => {
    const stmt = adapter.prepare(`SELECT * FROM ${table} ORDER BY ID`);
    const result = stmt.all() as Row[];
    stmt.finalize();
    return result;
  };

  return {
    services,
    adapter,
    budgetId,
    accountId,
    categoryId,
    runtime: {
      services: () => services,
      mutationsRouter: () => router,
      getActiveSpaceId: () => SPACE_ID,
    },
    executed,
    run: async <T>(op: string, payload: Record<string, unknown>) =>
      ((await router.execute({ op, payload })) as { result: T }).result,
    rows,
    dump: (tables) => Object.fromEntries(tables.map((table) => [table, rows(table)])),
  };
}

/** Drop columns that only record wall-clock time of a write. */
export function withoutTimestamps(rows: Row[], columns = ['CreatedAt', 'UpdatedAt']): Row[] {
  return rows.map((row) =>
    Object.fromEntries(Object.entries(row).filter(([key]) => !columns.includes(key)))
  );
}

export function resetUndoStore(): void {
  useUndoStore.setState({
    past: [],
    future: [],
    isReplaying: false,
    failed: null,
    groupDepth: 0,
    groupItemId: null,
  });
}
