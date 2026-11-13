import { describe, it, expect } from 'vitest';
import { NodeSqlJsAdapter, ServiceManager, DatabaseAdapter } from '../src';

const COMPACT_WARNING = {
  status: 'warning',
  accounts: { checked: 1, matched: 1 },
  categories: { checked: 3, matched: 3 },
  readyToAssign: { checked: 1, matched: 0, mismatchCount: 1 },
};

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
  return { adapter, services, budgetId, categoryId };
}

describe('ImportHistoryService.undoImportRun — balance recalculation', () => {
  it('persists only verification counts for an accepted YNAB warning', async () => {
    const { adapter, services, budgetId } = await setup();
    const verification = {
      status: 'warning' as const,
      source: { transactions: 1, subtransactions: 0, registerRows: 1 },
      accounts: { checked: 1, matched: 1, debtBalanceAdjustments: [] },
      categories: { checked: 3, matched: 3, mismatches: [], omittedMismatches: 0 },
      readyToAssign: {
        checked: 1,
        matched: 0,
        mismatches: [
          {
            month: '2026-01',
            expectedReadyToAssign: 10_000,
            computedReadyToAssign: 9_000,
            difference: -1_000,
            breakdown: {
              income: 10_000,
              assignments: 1_000,
              offBudgetTransfers: 0,
              inBudgetTransfers: 0,
              revaluations: 0,
              priorCashOverspend: 0,
            },
          },
        ],
      },
    };

    services.importHistory.recordImportRun({
      budgetId,
      sourceType: 'ynab-api',
      sourceName: 'Test plan',
      summary: {
        transactionsImported: 1,
        accountsCreated: 1,
        categoriesCreated: 1,
        verification,
        acceptedWithWarnings: true,
      },
      transactionIds: [],
      accountIds: [],
      categoryIds: [],
      status: 'completed_with_warnings',
    });

    expect(services.importHistory.listImportRuns(budgetId)[0]).toMatchObject({
      sourceType: 'ynab-api',
      status: 'completed_with_warnings',
      summary: { acceptedWithWarnings: true, verification: COMPACT_WARNING },
    });
    // History rows ship in every synced snapshot: no per-month detail.
    const { SummaryJSON } = adapter
      .prepare('SELECT SummaryJSON FROM import_runs WHERE BudgetID = ?')
      .get(budgetId) as { SummaryJSON: string };
    expect(JSON.parse(SummaryJSON).verification).toEqual(COMPACT_WARNING);
  });

  it('compacts full verification reports saved by older builds when read', async () => {
    const { adapter, services, budgetId } = await setup();
    adapter
      .prepare(
        `INSERT INTO import_runs (BudgetID, SourceType, SourceName, SummaryJSON, TransactionIDs,
           AccountIDs, CategoryIDs, Status, CreatedAt)
         VALUES (?, 'ynab-api', 'Old plan', ?, '[]', '[]', '[]', 'completed_with_warnings',
           datetime('now'))`
      )
      .run(
        budgetId,
        JSON.stringify({
          transactionsImported: 1,
          accountsCreated: 1,
          categoriesCreated: 1,
          acceptedWithWarnings: true,
          verification: {
            status: 'warning',
            accounts: { checked: 1, matched: 1, debtBalanceAdjustments: [] },
            categories: { checked: 3, matched: 3, mismatches: [], omittedMismatches: 0 },
            readyToAssign: { checked: 1, matched: 0, mismatches: [{ month: '2026-01' }] },
          },
        })
      );

    expect(services.importHistory.listImportRuns(budgetId)[0].summary.verification).toEqual(
      COMPACT_WARNING
    );
  });

  it('removes both legs of a one-sided transfer and the account it created', async () => {
    const { services, budgetId } = await setup();
    const checking = await services.accounts.createAccount(
      'Checking',
      budgetId,
      'checking',
      'USD',
      0
    );
    // Created by the import: only named by the file (QIF L[Card]).
    const card = await services.accounts.createAccount('Card', budgetId, 'credit', 'USD', 0);
    const own = await services.transactions.addTransaction(
      0,
      200,
      checking.ID,
      0,
      budgetId,
      '2026-01-02',
      'card payment',
      'import_r_0'
    );
    const mirror = await services.transactions.addTransaction(
      200,
      0,
      card.ID,
      0,
      budgetId,
      '2026-01-02',
      'card payment',
      'import_r_0'
    );
    const runId = services.importHistory.recordImportRun({
      runKey: 'r',
      budgetId,
      sourceType: 'qif',
      sourceName: 'quicken.qif',
      summary: {
        transactionsImported: 2,
        mirrorTransactions: 1,
        accountsCreated: 1,
        categoriesCreated: 0,
      },
      transactionIds: [own, mirror],
      accountIds: [card.ID],
      categoryIds: [],
    });
    // One file row was imported; the mirror leg is not shown as one.
    expect(services.importHistory.listImportRuns(budgetId)[0].summary).toMatchObject({
      transactionsImported: 1,
      mirrorTransactions: 1,
    });

    const result = services.importHistory.undoImportRun(runId);
    expect(result).toMatchObject({ transactionsRemoved: 2, accountsRemoved: 1 });
    expect(services.transactions.getTransactionsByTransferID('import_r_0')).toHaveLength(0);
    expect(services.accounts.getAccount(checking.ID).BalanceNative).toBe(0);
  });

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
    expect(services.accounts.getAccount(acc.ID).BalanceNative).toBe(-200);

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
    expect(services.accounts.getAccount(acc.ID).BalanceNative).toBe(250);

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
    expect(services.accounts.getAccount(acc.ID).BalanceNative).toBe(-200);
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
    expect(survivor.RunningBalanceConverted).toBe(-200);
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
