import { describe, expect, it } from 'vitest';
import { asMilli, NodeSqlJsAdapter, ServiceManager, recordRowChanges } from '../src';
import { dumpDb } from './db-dump.helpers';

const M = (v: number) => asMilli(v);

async function setup() {
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
  const dining = s.categories.addCategory(group, budgetId, 'Dining', 'note');
  const food = s.categories.addCategory(group, budgetId, 'Food', '');
  const checking = (
    await s.accounts.createAccount('Checking', budgetId, 'checking', 'USD', M(5_000_000))
  ).ID;
  const savings = (await s.accounts.createAccount('Savings', budgetId, 'savings', 'USD', M(0))).ID;
  return { db, s, budgetId, group, dining, food, checking, savings };
}

type Ctx = Awaited<ReturnType<typeof setup>>;

async function populate(c: Ctx) {
  await c.s.transactions.addTransaction(
    M(0),
    M(12_000),
    c.checking,
    c.dining,
    c.budgetId,
    '2026-01-05',
    'lunch'
  );
  const parent = await c.s.transactions.addTransaction(
    M(0),
    M(50_000),
    c.checking,
    c.food,
    c.budgetId,
    '2026-02-12',
    'shop'
  );
  await c.s.splits.upsertSplits(parent, [
    { CategoryID: c.dining, InflowConverted: M(0), OutflowConverted: M(20_000), OrderIndex: 0 },
    { CategoryID: c.food, InflowConverted: M(0), OutflowConverted: M(30_000), OrderIndex: 1 },
  ]);
  c.s.monthlyBudgets.upsertMonthlyAssignment(c.dining, M(100_000), '2026-01', c.budgetId);
  await c.s.recurring.createRecurringTransaction({
    budgetId: c.budgetId,
    accountId: c.checking,
    categoryId: c.dining,
    name: 'Lunch club',
    amount: 15,
    direction: 'outflow',
    schedule: { startDate: '2026-01-15', intervalUnit: 'month', intervalCount: 1 },
  });
  c.s.recurring.ensureOccurrencesThrough(c.budgetId, '2026-06-30');
}

describe('recordRowChanges', () => {
  it('journals a cascading delete (legacy category delete) so restore is exact', async () => {
    const c = await setup();
    await populate(c);
    const before = dumpDb(c.db);

    const { journal } = c.s.rowJournal.record(() => c.s.categories.deleteCategory(c.dining));
    expect(dumpDb(c.db)).not.toEqual(before);
    expect(journal.deleted.map((entry) => entry.table)).toEqual(
      expect.arrayContaining(['categories', 'transactions', 'assignments'])
    );

    c.s.rowJournal.restore(JSON.parse(JSON.stringify(journal)));
    expect(dumpDb(c.db)).toEqual(before);
    // the TEMP triggers and tables are gone
    expect(
      c.db
        .prepare("SELECT COUNT(*) AS n FROM sqlite_temp_master WHERE name LIKE '_rowjournal%'")
        .get()
    ).toEqual({ n: 0 });
  });

  it('removes inserted rows and puts AUTOINCREMENT counters back', async () => {
    const c = await setup();
    const before = dumpDb(c.db);
    const { journal } = await c.s.rowJournal.recordAsync(() =>
      c.s.accounts.updateAccount(c.savings, 'Visa', 'credit', 'USD', {}, true)
    );
    expect(dumpDb(c.db)).not.toEqual(before);
    c.s.rowJournal.restore(journal);
    expect(dumpDb(c.db)).toEqual(before);
  });

  it('addresses device-local rows by their natural key', async () => {
    const c = await setup();
    await populate(c);
    const template = c.db.prepare('SELECT ID FROM recurring_transactions').get() as { ID: number };
    const occurrences = () =>
      c.db
        .prepare(
          'SELECT RecurringTransactionID, DueDate, Status FROM recurring_transaction_occurrences ORDER BY DueDate'
        )
        .all();
    const before = occurrences();
    const { journal } = c.s.rowJournal.record(() => {
      c.db
        .prepare('DELETE FROM recurring_transaction_occurrences WHERE DueDate > ?')
        .run('2026-03-01');
      c.db
        .prepare(
          "UPDATE recurring_transaction_occurrences SET Status = 'skipped' WHERE DueDate = ?"
        )
        .run('2026-01-15');
      c.db
        .prepare(
          `INSERT INTO recurring_transaction_occurrences (RecurringTransactionID, BudgetID, DueDate, Status)
           VALUES (?, ?, '2026-01-20', 'scheduled')`
        )
        .run(template.ID, c.budgetId);
    });
    expect(journal.keyed?.[0]?.deleted[0]).not.toHaveProperty('ID');
    c.s.rowJournal.restore(journal);
    expect(occurrences()).toEqual(before);
  });

  it('puts back what a failing change already committed, and drops its triggers', async () => {
    const c = await setup();
    const before = dumpDb(c.db);
    expect(() =>
      recordRowChanges(c.db, () => {
        c.s.categories.updateCategoryName(c.dining, 'Eating out');
        c.s.categories.addCategory(c.group, c.budgetId, 'New', '');
        throw new Error('boom');
      })
    ).toThrow('boom');
    expect(dumpDb(c.db)).toEqual(before);
    expect(
      c.db
        .prepare("SELECT COUNT(*) AS n FROM sqlite_temp_master WHERE name LIKE '_rowjournal%'")
        .get()
    ).toEqual({ n: 0 });
  });
});
