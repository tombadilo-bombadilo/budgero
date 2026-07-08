import { describe, it, expect } from 'vitest';
import { NodeSqlJsAdapter, ServiceManager, DatabaseAdapter } from '../src';

async function setup() {
  const adapter = await NodeSqlJsAdapter.create();
  const sm = new ServiceManager();
  await sm.initialize(adapter as DatabaseAdapter);
  const services = sm.getServices();
  const budgetId = await services.budgets.createBudget({
    name: 'Undo',
    display_currency: 'USD',
    badge_icon: 'dollar',
    number_format: '123,456.78',
    create_default_categories: false,
  });
  const group = services.categories.addCategoryGroup('G', budgetId);
  const categoryId = services.categories.addCategory(group, budgetId, 'Cat');
  return { services, budgetId, categoryId };
}

describe('ImportHistoryService.undoImportRun — balance recalculation', () => {
  it('restores the account balance after undoing an import into a pre-existing account', async () => {
    const { services, budgetId, categoryId } = await setup();
    const acc = await services.accounts.createAccount('Checking', budgetId, 'checking', 'USD', 0);

    // A manual transaction that is NOT part of the import.
    await services.transactions.addTransaction(
      0,
      200,
      acc.ID,
      categoryId,
      budgetId,
      '2026-01-01',
      'rent'
    );
    expect(services.accounts.getAccount(acc.ID).Balance).toBe(-200);

    // Two imported transactions land in the same pre-existing account.
    const imp1 = await services.transactions.addTransaction(
      500,
      0,
      acc.ID,
      categoryId,
      budgetId,
      '2026-01-02',
      'salary'
    );
    const imp2 = await services.transactions.addTransaction(
      0,
      50,
      acc.ID,
      categoryId,
      budgetId,
      '2026-01-03',
      'groceries'
    );
    expect(services.accounts.getAccount(acc.ID).Balance).toBe(250);

    const runId = services.importHistory.recordImportRun({
      budgetId,
      sourceType: 'csv',
      sourceName: 'statement.csv',
      summary: { transactionsImported: 2, accountsCreated: 0, categoriesCreated: 0 },
      transactionIds: [imp1, imp2],
      accountIds: [], // imported into an existing account, none created
      categoryIds: [],
    });

    const result = services.importHistory.undoImportRun(runId);
    expect(result.transactionsRemoved).toBe(2);
    expect(result.accountsRemoved).toBe(0);

    // Balance is recomputed from the surviving manual transaction — not stale
    // at 250, and not blindly zeroed.
    expect(services.accounts.getAccount(acc.ID).Balance).toBe(-200);
  });

  it('keeps the surviving transaction running balance accurate after undo', async () => {
    const { services, budgetId, categoryId } = await setup();
    const acc = await services.accounts.createAccount('Checking', budgetId, 'checking', 'USD', 0);

    const manual = await services.transactions.addTransaction(
      0,
      200,
      acc.ID,
      categoryId,
      budgetId,
      '2026-01-01',
      'rent'
    );
    const imp1 = await services.transactions.addTransaction(
      500,
      0,
      acc.ID,
      categoryId,
      budgetId,
      '2026-01-02',
      'salary'
    );

    const runId = services.importHistory.recordImportRun({
      budgetId,
      sourceType: 'csv',
      sourceName: 'statement.csv',
      summary: { transactionsImported: 1, accountsCreated: 0, categoriesCreated: 0 },
      transactionIds: [imp1],
      accountIds: [],
      categoryIds: [],
    });

    services.importHistory.undoImportRun(runId);

    const survivor = services.transactions.getTransactionByID(manual);
    expect(survivor.RunningBalance).toBe(-200);
  });

  it('removes an empty created account on undo without leaving a stale balance', async () => {
    const { services, budgetId, categoryId } = await setup();
    // Simulate an account created during the import.
    const created = await services.accounts.createAccount(
      'Import Account',
      budgetId,
      'checking',
      'USD',
      0
    );
    const imp1 = await services.transactions.addTransaction(
      0,
      75,
      created.ID,
      categoryId,
      budgetId,
      '2026-02-01',
      'a'
    );
    const imp2 = await services.transactions.addTransaction(
      0,
      25,
      created.ID,
      categoryId,
      budgetId,
      '2026-02-02',
      'b'
    );

    const runId = services.importHistory.recordImportRun({
      budgetId,
      sourceType: 'csv',
      sourceName: 'statement.csv',
      summary: { transactionsImported: 2, accountsCreated: 1, categoriesCreated: 0 },
      transactionIds: [imp1, imp2],
      accountIds: [created.ID],
      categoryIds: [],
    });

    const result = services.importHistory.undoImportRun(runId);
    expect(result.transactionsRemoved).toBe(2);
    expect(result.accountsRemoved).toBe(1);
  });
});
