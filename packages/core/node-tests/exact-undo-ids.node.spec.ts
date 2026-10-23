import { describe, expect, it } from 'vitest';
import { asMilli, GoalType, NodeSqlJsAdapter, ServiceManager, type DatabaseAdapter } from '../src';
import { allRows, getRow, run } from '../src/database/sql.js';

async function setup() {
  const db: DatabaseAdapter = await NodeSqlJsAdapter.create();
  const manager = new ServiceManager();
  await manager.initialize(db);
  const s = manager.getServices();
  const budgetId = await s.budgets.createBudget({
    name: 'B',
    display_currency: 'USD',
    badge_icon: 'dollar',
    number_format: '123,456.78',
    create_default_categories: false,
  });
  const group = s.categories.addCategoryGroup('Spending', budgetId);
  const food = s.categories.addCategory(group, budgetId, 'Food', '');
  return { db, s, budgetId, food };
}

const ids = (db: DatabaseAdapter, table: string) =>
  allRows<{ ID: number }>(db, `SELECT ID FROM ${table} ORDER BY ID`).map((row) => row.ID);

describe('redo under the IDs of the first run', () => {
  it('allocates the same IDs again after an undo removed the rows', async () => {
    const { db, s, budgetId } = await setup();
    const history = s.mutationHistory;
    const before = history.idCounters();
    const account = await s.accounts.createAccount(
      'Wallet',
      budgetId,
      'checking',
      'USD',
      asMilli(5000)
    );
    const range = history.allocatedIds(before);
    expect(range.accounts).toBeDefined();
    const firstRows = ids(db, 'transactions');

    // Undo: the rows go, the counters stay.
    run(db, 'DELETE FROM transactions WHERE AccountID = ?', account.ID);
    s.accounts.deleteAccount(account.ID);

    const again = await history.withReusedIds(range, () =>
      s.accounts.createAccount('Wallet', budgetId, 'checking', 'USD', asMilli(5000))
    );
    expect(again.ID).toBe(account.ID);
    expect(ids(db, 'transactions')).toEqual(firstRows);
  });

  it('never moves a counter below where it was, and ignores garbled ranges', async () => {
    const { db, s, budgetId } = await setup();
    const seq = () =>
      getRow<{ seq: number }>(db, "SELECT seq FROM sqlite_sequence WHERE name = 'payees'")?.seq;
    s.payees.addPayee(budgetId, 'A');
    s.payees.addPayee(budgetId, 'B');
    const high = seq();
    await s.mutationHistory.withReusedIds({ payees: [0, 1] }, () => undefined);
    expect(seq()).toBe(high);
    await s.mutationHistory.withReusedIds({ payees: ['x', 9], nope: 3 }, () => undefined);
    expect(seq()).toBe(high);
    // A pinned counter never collides with a live row.
    await s.mutationHistory.withReusedIds({ payees: [0, high!] }, () =>
      s.payees.addPayee(budgetId, 'C')
    );
    expect(ids(db, 'payees')).toEqual([1, 2, 3]);
  });
});

describe('payee entries an undone op added', () => {
  it('removes only the listed entries no row uses', async () => {
    const { db, s, budgetId } = await setup();
    const account = await s.accounts.createAccount(
      'Cash',
      budgetId,
      'checking',
      'USD',
      asMilli(1000)
    );
    const used = s.payees.addPayee(budgetId, 'Shop');
    const unused = s.payees.addPayee(budgetId, 'Cafe');
    const other = s.payees.addPayee(budgetId, 'Bakery');
    run(db, "UPDATE transactions SET Payee = 'shop' WHERE AccountID = ?", account.ID);

    expect(s.payees.removeUnusedPayees(budgetId, [used, unused, -1])).toEqual({ removed: 1 });
    const left = ids(db, 'payees');
    expect([used, unused, other].filter((id) => left.includes(id))).toEqual([used, other]);
    expect(s.payees.removeUnusedPayees(budgetId, [])).toEqual({ removed: 0 });
  });
});

describe('goal restore', () => {
  it('puts the deleted goal back under its own ID', async () => {
    const { s, food } = await setup();
    s.goals.createGoal(GoalType.MONTHLY, food, asMilli(100_000), '2026-01-01', '');
    const goal = s.goals.getGoalsByCategoryIDs([food])[0]!;
    s.goals.deleteGoal(goal.ID);
    s.goals.restoreGoal(goal as unknown as Parameters<typeof s.goals.restoreGoal>[0]);
    expect(s.goals.getGoalsByCategoryIDs([food])[0]).toEqual(goal);
    expect(() => s.goals.restoreGoal({ CategoryID: food })).toThrow();
  });
});
