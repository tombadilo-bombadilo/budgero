import { describe, expect, it } from 'vitest';
import { asMilli, GoalType, NodeSqlJsAdapter, ServiceManager, type DatabaseAdapter } from '../src';
import { ACCOUNT_UNDO_ROW_LIMIT } from '../src/services/accounts/index.js';
import { dumpDb } from './db-dump.helpers';

const M = (v: number) => asMilli(v);

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
  const checking = (
    await s.accounts.createAccount('Checking', budgetId, 'checking', 'USD', M(10_000_000))
  ).ID;
  return { db, s, budgetId, food, checking };
}

type Ctx = Awaited<ReturnType<typeof setup>>;

async function transfer(
  c: Ctx,
  from: number,
  to: number,
  amount: number,
  date: string,
  id: string
) {
  const transfers = c.s.categories.getCategoryByName('Transfers', c.budgetId)!.ID;
  await c.s.transactions.addTransaction(
    M(0),
    M(amount),
    from,
    transfers,
    c.budgetId,
    date,
    'pay',
    id
  );
  await c.s.transactions.addTransaction(
    M(amount),
    M(0),
    to,
    transfers,
    c.budgetId,
    date,
    'pay',
    id
  );
}

/** A loan with history everywhere an account delete reaches. */
async function loanWithHistory(c: Ctx) {
  const loan = await c.s.accounts.createAccount('Car loan', c.budgetId, 'loan', 'USD', M(0), {
    debt_total: 8_000_000,
  });
  const linked = JSON.parse(String(loan.Metadata)).linked_category_id as number;
  await transfer(c, c.checking, loan.ID, 1_000_000, '2026-02-01', 'p1');
  await transfer(c, c.checking, loan.ID, 500_000, '2026-03-01', 'p2');
  c.s.monthlyBudgets.upsertMonthlyAssignment(linked, M(1_000_000), '2026-02', c.budgetId);
  c.s.goals.createGoal(GoalType.MONTHLY, linked, M(500_000), '2026-01-01', '');
  const split = await c.s.transactions.addTransaction(
    M(0),
    M(90_000),
    c.checking,
    c.food,
    c.budgetId,
    '2026-03-04',
    'mixed'
  );
  await c.s.splits.upsertSplits(split, [
    { CategoryID: c.food, InflowConverted: M(0), OutflowConverted: M(40_000), OrderIndex: 0 },
    {
      TransferAccountID: loan.ID,
      InflowConverted: M(0),
      OutflowConverted: M(50_000),
      OrderIndex: 1,
    },
  ]);
  await c.s.recurring.createRecurringTransaction({
    budgetId: c.budgetId,
    accountId: c.checking,
    toAccountId: loan.ID,
    categoryId: linked,
    name: 'Loan payment',
    amount: 400,
    direction: 'outflow',
    schedule: { startDate: '2026-04-01', intervalUnit: 'month', intervalCount: 1 },
  });
  c.s.bankSync.saveLink({
    budgetId: c.budgetId,
    provider: 'simplefin',
    accountId: loan.ID,
    externalAccountId: 'LOAN-1',
    externalName: 'Car loan',
    orgName: 'Bank',
    importFrom: '2026-01-01',
  });
  return { loan: loan.ID, linked };
}

describe('accounts.delete undo', () => {
  it('restores a deleted loan, its history, linked category and other accounts’ legs exactly', async () => {
    const c = await setup();
    const { loan, linked } = await loanWithHistory(c);
    const before = dumpDb(c.db);
    const balances = c.s.accounts.listAccounts(c.budgetId).map((a) => [a.ID, a.BalanceNative]);

    const journal = c.s.accounts.deleteAccountWithUndo(loan);
    expect(journal).not.toBeNull();
    expect(c.s.accounts.listAccounts(c.budgetId).some((a) => a.ID === loan)).toBe(false);
    expect(c.s.categories.getAllCategories(c.budgetId).some((x) => x.ID === linked)).toBe(false);

    c.s.accounts.restoreDeletedAccount(JSON.parse(JSON.stringify(journal)));
    expect(dumpDb(c.db)).toEqual(before);
    expect(c.s.accounts.listAccounts(c.budgetId).map((a) => [a.ID, a.BalanceNative])).toEqual(
      balances
    );
  });

  it('removes an Uncategorized category the delete had to create, and its ID counter', async () => {
    const c = await setup();
    const uncategorized = c.s.categories.getCategoryByName('Uncategorized', c.budgetId)!;
    c.s.categories.deleteCategory(uncategorized.ID);
    const { loan } = await loanWithHistory(c);
    const before = dumpDb(c.db);
    const journal = c.s.accounts.deleteAccountWithUndo(loan)!;
    expect(c.s.categories.getCategoryByName('Uncategorized', c.budgetId)).not.toBeNull();
    c.s.accounts.restoreDeletedAccount(journal);
    expect(dumpDb(c.db)).toEqual(before);
  });

  it('restores a credit card and its payment category', async () => {
    const c = await setup();
    const card = await c.s.accounts.createAccount('Visa', c.budgetId, 'credit', 'USD', M(-200_000));
    await c.s.transactions.addTransaction(
      M(0),
      M(30_000),
      card.ID,
      c.food,
      c.budgetId,
      '2026-02-02',
      'x'
    );
    await transfer(c, c.checking, card.ID, 100_000, '2026-02-20', 'cc1');
    const before = dumpDb(c.db);
    const journal = c.s.accounts.deleteAccountWithUndo(card.ID)!;
    c.s.accounts.restoreDeletedAccount(journal);
    expect(dumpDb(c.db)).toEqual(before);
  });

  it('keeps no undo data for very large deletes, and replays of a finished delete are no-ops', async () => {
    const c = await setup();
    const big = await c.s.accounts.createAccount('Big', c.budgetId, 'checking', 'USD', M(0));
    c.db.exec('BEGIN');
    const insert = c.db.prepare(
      `INSERT INTO transactions (CategoryID, AccountID, Date, InflowConverted, OutflowConverted,
         InflowNative, OutflowNative, BudgetID) VALUES (?, ?, '2026-01-01', 0, 1, 0, 1, ?)`
    );
    for (let i = 0; i <= ACCOUNT_UNDO_ROW_LIMIT; i++) insert.run(c.food, big.ID, c.budgetId);
    c.db.exec('COMMIT');
    expect(c.s.accounts.deleteAccountWithUndo(big.ID)).toBeNull();
    expect(c.s.accounts.listAccounts(c.budgetId).some((a) => a.ID === big.ID)).toBe(false);
    expect(c.s.accounts.deleteAccountWithUndo(big.ID)).toBeNull();
  });
});
