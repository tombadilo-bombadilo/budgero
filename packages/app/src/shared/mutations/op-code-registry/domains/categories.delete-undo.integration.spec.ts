import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
// The integration test needs the Node database adapter; production uses the browser entry.
// eslint-disable-next-line no-restricted-imports
import { asMilli, GoalType, NodeSqlJsAdapter, ServiceManager, type Services } from '@budgero/core';
import { executeMutationOp, getUndoSpec } from '@shared/mutations/op-code-registry';
import type { OpCall } from '@shared/mutations/op-code-registry/shared';

const runtime = vi.hoisted(() => ({ services: undefined as Services | undefined }));
vi.mock('@shared/runtime/global', () => ({
  getRuntime: () => ({ services: () => runtime.services }),
}));

type Db = Awaited<ReturnType<typeof NodeSqlJsAdapter.create>>;

function dump(db: Db) {
  const tables = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name <> 'sqlite_stat1' ORDER BY name"
    )
    .all() as { name: string }[];
  return Object.fromEntries(
    tables.map(({ name }) => [name, db.prepare(`SELECT * FROM "${name}" ORDER BY 1`).all()])
  );
}

/** Runs an op the way MutationExecutor does and returns its (JSON round-tripped) undo ops. */
async function run(op: string, args: Record<string, unknown>) {
  const spec = getUndoSpec(op);
  const before = spec?.capture ? await spec.capture(args) : undefined;
  const result = await executeMutationOp(op, args);
  const undo = spec?.build(args, result, before) ?? [];
  return JSON.parse(JSON.stringify(undo)) as OpCall[];
}

async function replay(calls: OpCall[]) {
  for (const call of calls) await executeMutationOp(call.op, call.args);
}

describe('category delete ops with real services', () => {
  let db: Db;
  let services: Services;
  let budgetId: number;
  let group: number;
  let source: number;
  let destination: number;
  let checking: number;
  let cardCategory: number;

  beforeEach(async () => {
    const manager = new ServiceManager();
    const cwd = vi.spyOn(process, 'cwd').mockReturnValue(resolve(process.cwd(), '../core'));
    try {
      db = await NodeSqlJsAdapter.create();
      await manager.initialize(db);
    } finally {
      cwd.mockRestore();
    }
    services = manager.getServices();
    runtime.services = services;
    budgetId = await services.budgets.createBudget({
      name: 'Deletes',
      display_currency: 'USD',
      badge_icon: 'dollar',
      number_format: '123,456.78',
      create_default_categories: false,
    });
    group = services.categories.addCategoryGroup('Spending', budgetId);
    source = services.categories.addCategory(group, budgetId, 'Dining', '');
    destination = services.categories.addCategory(group, budgetId, 'Food', '');
    checking = (
      await services.accounts.createAccount(
        'Checking',
        budgetId,
        'checking',
        'USD',
        asMilli(900_000)
      )
    ).ID;
    const card = await services.accounts.createAccount(
      'Visa',
      budgetId,
      'credit',
      'USD',
      asMilli(0)
    );
    cardCategory = JSON.parse(String(card.Metadata)).cc_payment_category_id;
    for (const [category, amount, date] of [
      [source, 12_000, '2026-01-04'],
      [source, 8_000, '2026-02-04'],
      [destination, 5_000, '2026-01-09'],
      [cardCategory, 1_000, '2026-01-11'],
    ] as const) {
      await services.transactions.addTransaction(
        asMilli(0),
        asMilli(amount),
        checking,
        category,
        budgetId,
        date,
        'x'
      );
    }
    services.monthlyBudgets.upsertMonthlyAssignment(source, asMilli(30_000), '2026-01', budgetId);
    services.monthlyBudgets.upsertMonthlyAssignment(source, asMilli(10_000), '2026-03', budgetId);
    services.monthlyBudgets.upsertMonthlyAssignment(
      destination,
      asMilli(4_000),
      '2026-01',
      budgetId
    );
    services.goals.createGoal(GoalType.MONTHLY, source, asMilli(20_000), '2026-01-01', '');
  });

  it('delete-and-move is one op; its undo puts every table back exactly, and redo works', async () => {
    const before = dump(db);
    const args = { id: source, budgetId, reassignTo: destination };
    const undo = await run('categories.deleteAndReassign', args);
    expect(undo.map((call) => call.op)).toEqual(['categories.restoreDeleted']);
    expect(services.categories.getAllCategories(budgetId).some((c) => c.ID === source)).toBe(false);
    await replay(undo);
    expect(dump(db)).toEqual(before);

    // redo = the same op again; the same undo still applies
    await executeMutationOp('categories.deleteAndReassign', args);
    await replay(undo);
    expect(dump(db)).toEqual(before);
  });

  it('a card payment category fails before anything moves (legacy ops moved rows first)', async () => {
    const before = dump(db);
    await expect(
      run('categories.deleteAndReassign', { id: cardCategory, budgetId, reassignTo: destination })
    ).rejects.toThrow(/credit card/);
    expect(dump(db)).toEqual(before);
  });

  it('plain delete keeps the goal and every month of assignments for undo', async () => {
    const empty = services.categories.addCategory(group, budgetId, 'Gifts', '');
    services.monthlyBudgets.upsertMonthlyAssignment(empty, asMilli(7_000), '2025-12', budgetId);
    services.goals.createGoal(GoalType.MONTHLY, empty, asMilli(1_000), '2026-01-01', '');
    const before = dump(db);
    const undo = await run('categories.deleteAndReassign', { id: empty, budgetId });
    await replay(undo);
    expect(dump(db)).toEqual(before);
    await expect(run('categories.deleteAndReassign', { id: source, budgetId })).rejects.toThrow(
      /transactions/
    );
  });

  it('group delete is one op with full undo', async () => {
    const empty = services.categories.addCategoryGroup('Later', budgetId);
    const before = dump(db);
    const undo = await run('categoryGroups.deleteAndReassign', { id: empty, budgetId });
    await replay(undo);
    expect(dump(db)).toEqual(before);

    const target = services.categories.addCategory(
      services.categories.addCategoryGroup('Keep', budgetId),
      budgetId,
      'Kept',
      ''
    );
    const withTarget = dump(db);
    const moved = await run('categoryGroups.deleteAndReassign', {
      id: group,
      budgetId,
      reassignTo: target,
    });
    expect(services.categories.getAllCategoryGroups(budgetId).some((g) => g.ID === group)).toBe(
      false
    );
    await replay(moved);
    expect(dump(db)).toEqual(withTarget);
  });

  it('legacy ops still replay (queued ops from older clients)', async () => {
    await executeMutationOp('transactions.reassign', {
      newCategoryId: destination,
      oldCategoryId: source,
    });
    await executeMutationOp('monthlyBudgets.reassignAssignment', {
      newCategoryId: destination,
      oldCategoryId: source,
    });
    await executeMutationOp('categories.delete', { id: source });
    expect(services.categories.getAllCategories(budgetId).some((c) => c.ID === source)).toBe(false);
  });
});
