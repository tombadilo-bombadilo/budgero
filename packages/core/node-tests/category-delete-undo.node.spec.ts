import { describe, expect, it } from 'vitest';
import {
  asMilli,
  GoalType,
  NodeSqlJsAdapter,
  ServiceManager,
  type DatabaseAdapter,
  type Services,
} from '../src';
import { dumpComparable, dumpDb } from './db-dump.helpers';

interface Ctx {
  db: DatabaseAdapter;
  s: Services;
  budgetId: number;
  checking: number;
  card: number;
  cardCategory: number;
  group: number;
  source: number;
  destination: number;
  other: number;
}

const M = (v: number) => asMilli(v);

async function setup(): Promise<Ctx> {
  const db = await NodeSqlJsAdapter.create();
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
  const source = s.categories.addCategory(group, budgetId, 'Dining', 'note');
  const destination = s.categories.addCategory(group, budgetId, 'Food', '');
  const other = s.categories.addCategory(group, budgetId, 'Fun', '');
  const checking = (
    await s.accounts.createAccount('Checking', budgetId, 'checking', 'USD', M(5_000_000))
  ).ID;
  const cardAccount = await s.accounts.createAccount('Visa', budgetId, 'credit', 'USD', M(0));
  const card = cardAccount.ID;
  const cardCategory = JSON.parse(String(cardAccount.Metadata)).cc_payment_category_id as number;
  return { db, s, budgetId, checking, card, cardCategory, group, source, destination, other };
}

async function spend(c: Ctx, account: number, category: number, amount: number, date: string) {
  return c.s.transactions.addTransaction(
    M(0),
    M(amount),
    account,
    category,
    c.budgetId,
    date,
    'spend'
  );
}

/** Source category with everything a delete touches: rows, splits, schedule, assignments, goal. */
async function populate(c: Ctx) {
  await spend(c, c.checking, c.source, 12_000, '2026-01-05');
  await spend(c, c.card, c.source, 30_000, '2026-02-10');
  const parent = await spend(c, c.checking, c.other, 50_000, '2026-02-12');
  await c.s.splits.upsertSplits(parent, [
    { CategoryID: c.source, InflowConverted: M(0), OutflowConverted: M(20_000), OrderIndex: 0 },
    { CategoryID: c.other, InflowConverted: M(0), OutflowConverted: M(30_000), OrderIndex: 1 },
  ]);
  await spend(c, c.checking, c.destination, 7_000, '2026-01-20');
  c.s.monthlyBudgets.upsertMonthlyAssignment(c.source, M(100_000), '2026-01', c.budgetId);
  c.s.monthlyBudgets.upsertMonthlyAssignment(c.source, M(40_000), '2026-02', c.budgetId);
  c.s.monthlyBudgets.upsertMonthlyAssignment(c.source, M(25_000), '2026-03', c.budgetId);
  c.s.monthlyBudgets.upsertMonthlyAssignment(c.destination, M(60_000), '2026-01', c.budgetId);
  c.s.goals.createGoal(GoalType.MONTHLY, c.source, M(50_000), '2026-01-01', '');
  await c.s.recurring.createRecurringTransaction({
    budgetId: c.budgetId,
    accountId: c.checking,
    categoryId: c.source,
    name: 'Lunch club',
    amount: 15,
    direction: 'outflow',
    schedule: { startDate: '2026-01-15', intervalUnit: 'month', intervalCount: 1 },
  });
}

const months = ['2026-01', '2026-02', '2026-03', '2026-04'];
const budgetView = (c: Ctx) =>
  months.map((month) => ({
    rows: c.s.monthlyBudgets.getMonthlyBudget(month, c.budgetId),
    rta: c.s.monthlyBudgets.getReadyToAssign(c.budgetId, month),
  }));

describe('deleting a category and moving its data (A8, U1)', () => {
  it('validates first: a card payment category is refused before anything moves', async () => {
    const c = await setup();
    await populate(c);
    await spend(c, c.checking, c.cardCategory, 1_000, '2026-01-07');
    const before = dumpDb(c.db);
    expect(() => c.s.categories.deleteCategoryWithUndo(c.cardCategory, c.destination)).toThrow(
      /credit card/
    );
    expect(dumpDb(c.db)).toEqual(before);
    // the legacy three-step flow had already moved the rows when the delete threw
    c.s.transactions.reassignTransactions(c.destination, c.cardCategory);
    expect(() => c.s.categories.deleteCategory(c.cardCategory)).toThrow(/credit card/);
    expect(dumpDb(c.db)).not.toEqual(before);
  });

  it('moves rows and assignments in one step, and undo restores the database exactly', async () => {
    const c = await setup();
    await populate(c);
    const before = dumpDb(c.db);
    const viewBefore = budgetView(c);

    const journal = c.s.categories.deleteCategoryWithUndo(c.source, c.destination);

    expect(c.s.categories.getAllCategories(c.budgetId).some((x) => x.ID === c.source)).toBe(false);
    const leftovers = c.db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM transactions WHERE CategoryID = ?1) +
           (SELECT COUNT(*) FROM transaction_splits WHERE CategoryID = ?1) +
           (SELECT COUNT(*) FROM recurring_transactions WHERE CategoryID = ?1) +
           (SELECT COUNT(*) FROM assignments WHERE CategoryID = ?1) +
           (SELECT COUNT(*) FROM goals WHERE CategoryID = ?1) AS n`
      )
      .get(c.source) as { n: number };
    expect(leftovers.n).toBe(0);
    // January merged into the destination's existing row; other months moved
    expect(c.s.monthlyBudgets.getMonthlyAssignmentValue(c.destination, '2026-01', c.budgetId)).toBe(
      160_000
    );
    expect(c.s.monthlyBudgets.getMonthlyAssignmentValue(c.destination, '2026-03', c.budgetId)).toBe(
      25_000
    );

    // the journal travels as an undo op payload: JSON round trip
    c.s.categories.restoreDeletedCategories(JSON.parse(JSON.stringify(journal)));
    expect(dumpDb(c.db)).toEqual(before);
    expect(budgetView(c)).toEqual(viewBefore);

    // redo (the same op again) and undo again still match
    const again = c.s.categories.deleteCategoryWithUndo(c.source, c.destination);
    c.s.categories.restoreDeletedCategories(again);
    expect(dumpDb(c.db)).toEqual(before);
  });

  it('matches the legacy three-step result when it succeeds', async () => {
    const a = await setup();
    const b = await setup();
    await populate(a);
    await populate(b);
    a.s.transactions.reassignTransactions(a.destination, a.source);
    a.s.monthlyBudgets.reassignAssignment(a.destination, a.source);
    a.s.categories.deleteCategory(a.source);
    b.s.categories.deleteCategoryWithUndo(b.source, b.destination);
    expect(dumpComparable(b.db)).toEqual(dumpComparable(a.db));
  });

  it('refuses a destination in another budget or the category itself', async () => {
    const c = await setup();
    await populate(c);
    const otherBudget = await c.s.budgets.createBudget({
      name: 'B2',
      display_currency: 'USD',
      badge_icon: 'dollar',
      number_format: '123,456.78',
      create_default_categories: false,
    });
    const foreign = c.s.categories.addCategory(
      c.s.categories.addCategoryGroup('G', otherBudget),
      otherBudget,
      'X',
      ''
    );
    const before = dumpDb(c.db);
    expect(() => c.s.categories.deleteCategoryWithUndo(c.source, foreign)).toThrow(/same|budget/);
    expect(() => c.s.categories.deleteCategoryWithUndo(c.source, c.source)).toThrow(/different/);
    expect(dumpDb(c.db)).toEqual(before);
  });

  it('keeps income history in the Income group', async () => {
    const c = await setup();
    const income = c.s.categories.getCategoryGroupByName('Income', c.budgetId)!;
    const salary = c.s.categories.addCategory(income.ID, c.budgetId, 'Salary', '');
    const system = c.s.categories.getCategoryByName('Income', c.budgetId)!;
    expect(() => c.s.categories.deleteCategoryWithUndo(salary, c.destination)).toThrow(/income/);
    expect(() => c.s.categories.deleteCategoryWithUndo(system.ID, salary)).toThrow(/Income/);
    expect(c.s.categories.getDeletionBlock(system.ID)?.reason).toBe('income');
    c.s.categories.deleteCategoryWithUndo(salary, system.ID);
  });
});

describe('deleting a category without moving anything (A6, U1)', () => {
  it('refuses while transactions remain, so it never deletes what undo cannot restore', async () => {
    const c = await setup();
    await populate(c);
    const before = dumpDb(c.db);
    expect(() => c.s.categories.deleteCategoryWithUndo(c.source)).toThrow(/transactions/);
    expect(dumpDb(c.db)).toEqual(before);
  });

  it('reports what it removes and undo brings back assignments, goal and schedule', async () => {
    const c = await setup();
    c.s.monthlyBudgets.upsertMonthlyAssignment(c.other, M(10_000), '2025-11', c.budgetId);
    c.s.monthlyBudgets.upsertMonthlyAssignment(c.other, M(0), '2025-12', c.budgetId);
    c.s.monthlyBudgets.upsertMonthlyAssignment(c.other, M(-4_000), '2026-02', c.budgetId);
    c.s.goals.createGoal(GoalType.MONTHLY, c.other, M(5_000), '2026-01-01', '');
    await c.s.recurring.createRecurringTransaction({
      budgetId: c.budgetId,
      accountId: c.checking,
      categoryId: c.other,
      name: 'Cinema',
      amount: 9,
      direction: 'outflow',
      schedule: { startDate: '2026-01-03', intervalUnit: 'month', intervalCount: 1 },
    });
    expect(c.s.categories.getCategoryDeletionImpact(c.other)).toEqual({
      categories: 1,
      transactions: 0,
      assignedMonths: 2,
      assignedTotal: 6_000,
      goals: 1,
      scheduled: 1,
      blocked: null,
    });
    const before = dumpDb(c.db);
    const journal = c.s.categories.deleteCategoryWithUndo(c.other);
    expect(c.db.prepare('SELECT COUNT(*) n FROM goals').get()).toEqual({ n: 0 });
    c.s.categories.restoreDeletedCategories(journal);
    expect(dumpDb(c.db)).toEqual(before);
  });

  it('reports linked-card categories as blocked until the card is archived', async () => {
    const c = await setup();
    expect(c.s.categories.getDeleteBlocks(c.budgetId)).toEqual(
      expect.arrayContaining([
        { categoryId: c.cardCategory, reason: 'credit_card', accountName: 'Visa' },
      ])
    );
    expect(c.s.categories.getCategoryDeletionImpact(c.cardCategory).blocked?.reason).toBe(
      'credit_card'
    );
    c.s.accounts.setAccountArchived(c.card, true);
    expect(c.s.categories.getDeletionBlock(c.cardCategory)).toBeNull();
  });
});

describe('deleting a category group', () => {
  it('refuses a group holding an active card’s payment category (legacy delete removed it)', async () => {
    const c = await setup();
    const cardGroup = c.s.categories.getCategory(c.cardCategory).CategoryGroupID;
    const before = dumpDb(c.db);
    expect(() => c.s.categories.deleteCategoryGroupWithUndo(cardGroup)).toThrow(/credit card/);
    expect(c.s.categories.getCategoryGroupDeletionImpact(cardGroup).blocked?.reason).toBe(
      'credit_card'
    );
    expect(dumpDb(c.db)).toEqual(before);
    c.s.categories.deleteCategoryGroup(cardGroup);
    expect(c.s.categories.getAllCategories(c.budgetId).some((x) => x.ID === c.cardCategory)).toBe(
      false
    );
  });

  it('deletes a group and its categories in one step; undo restores everything', async () => {
    const c = await setup();
    await populate(c);
    const target = c.s.categories.addCategoryGroup('Keep', c.budgetId);
    const keep = c.s.categories.addCategory(target, c.budgetId, 'Kept', '');
    c.s.monthlyBudgets.upsertMonthlyAssignment(keep, M(1_000), '2026-02', c.budgetId);
    expect(c.s.categories.getCategoryGroupDeletionImpact(c.group)).toMatchObject({
      categories: 3,
      transactions: 6,
      goals: 1,
      scheduled: 1,
      blocked: null,
    });
    const before = dumpDb(c.db);
    const viewBefore = budgetView(c);
    expect(() => c.s.categories.deleteCategoryGroupWithUndo(c.group)).toThrow(/transactions/);
    expect(() => c.s.categories.deleteCategoryGroupWithUndo(c.group, c.source)).toThrow(
      /different/
    );
    expect(dumpDb(c.db)).toEqual(before);

    const journal = c.s.categories.deleteCategoryGroupWithUndo(c.group, keep);
    expect(c.s.categories.getAllCategoryGroups(c.budgetId).some((g) => g.ID === c.group)).toBe(
      false
    );
    expect(c.s.monthlyBudgets.getMonthlyAssignmentValue(keep, '2026-02', c.budgetId)).toBe(41_000);
    c.s.categories.restoreDeletedCategories(JSON.parse(JSON.stringify(journal)));
    expect(dumpDb(c.db)).toEqual(before);
    expect(budgetView(c)).toEqual(viewBefore);
  });

  it('refuses the Income group', async () => {
    const c = await setup();
    const income = c.s.categories.getCategoryGroupByName('Income', c.budgetId)!;
    expect(() => c.s.categories.deleteCategoryGroupWithUndo(income.ID)).toThrow(/Income/);
    expect(c.s.categories.getCategoryGroupDeletionImpact(income.ID).blocked?.reason).toBe(
      'income_group'
    );
  });
});

describe('restoring a category journal', () => {
  it('refuses tables outside the category domain and rolls back on conflicts', async () => {
    const c = await setup();
    const journal = c.s.categories.deleteCategoryWithUndo(c.other);
    const before = dumpDb(c.db);
    expect(() =>
      c.s.categories.restoreDeletedCategories({
        ...journal,
        deleted: [...journal.deleted, { table: 'budgets', rows: [] }],
      })
    ).toThrow(/budgets/);
    c.s.categories.restoreDeletedCategories(journal);
    expect(() => c.s.categories.restoreDeletedCategories(journal)).toThrow();
    expect(dumpDb(c.db)).not.toEqual(before);
  });
});
