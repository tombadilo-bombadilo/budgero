import { describe, expect, it } from 'vitest';
import { NodeSqlJsAdapter, ServiceManager, type DatabaseAdapter } from '../src';

async function createFixture() {
  const adapter: DatabaseAdapter = await NodeSqlJsAdapter.create();
  const manager = new ServiceManager();
  await manager.initialize(adapter);
  const services = manager.getServices();
  const budgetId = await services.budgets.createBudget({
    name: 'Links',
    display_currency: 'USD',
    badge_icon: 'dollar',
    number_format: '123,456.78',
    create_default_categories: true,
  });
  const checking = await services.accounts.createAccount(
    'Checking',
    budgetId,
    'checking',
    'USD',
    0,
    undefined,
    true
  );
  const savings = await services.accounts.createAccount(
    'Savings',
    budgetId,
    'savings',
    'USD',
    0,
    undefined,
    true
  );
  const addExpense = (accountId: number) =>
    services.transactions.addTransaction(0, 10_000, accountId, 0, budgetId, '2026-09-02', 'Memo');

  const linkWarranty = (transactionId: number) =>
    adapter.exec(
      `INSERT INTO warranties (BudgetID, Name, ExpiresAt, TransactionID)
       VALUES (${budgetId}, 'Laptop', '2028-01-01', ${transactionId})`
    );
  const linkOccurrence = (transactionId: number) => {
    adapter.exec(
      `INSERT INTO recurring_transactions
         (BudgetID, AccountID, Name, Amount, Direction, ScheduleJSON)
       VALUES (${budgetId}, ${checking.ID}, 'Rent', 10, 'outflow', '{}')`
    );
    adapter.exec(
      `INSERT INTO recurring_transaction_occurrences
         (RecurringTransactionID, BudgetID, DueDate, Status, TransactionID)
       VALUES ((SELECT MAX(ID) FROM recurring_transactions), ${budgetId}, '2026-09-02',
               'posted', ${transactionId})`
    );
  };
  const linkReview = (transactionId: number, status = 'pending') =>
    adapter.exec(
      `INSERT INTO bank_reviews
         (BudgetID, AccountID, OperationID, IdentityJSON, CandidateTransactionID, Status)
       VALUES (${budgetId}, ${checking.ID}, 'op-${transactionId}-${status}', '{}',
               ${transactionId}, '${status}')`
    );

  return {
    services,
    budgetId,
    checking,
    savings,
    addExpense,
    linkWarranty,
    linkOccurrence,
    linkReview,
  };
}

const NONE = { warranty: false, recurringOccurrence: false, bankReview: false };

describe('getTransactionLinks', () => {
  it('reports no links for a plain transaction', async () => {
    const { services, checking, addExpense } = await createFixture();
    const txId = await addExpense(checking.ID);

    expect(services.transactions.getTransactionLinks(txId)).toEqual(NONE);
  });

  it('reports a warranty link', async () => {
    const { services, checking, addExpense, linkWarranty } = await createFixture();
    const txId = await addExpense(checking.ID);
    linkWarranty(txId);

    expect(services.transactions.getTransactionLinks(txId)).toEqual({ ...NONE, warranty: true });
  });

  it('reports a recurring occurrence link', async () => {
    const { services, checking, addExpense, linkOccurrence } = await createFixture();
    const txId = await addExpense(checking.ID);
    linkOccurrence(txId);

    expect(services.transactions.getTransactionLinks(txId)).toEqual({
      ...NONE,
      recurringOccurrence: true,
    });
  });

  it('reports only pending bank reviews', async () => {
    const { services, checking, addExpense, linkReview } = await createFixture();
    const resolved = await addExpense(checking.ID);
    linkReview(resolved, 'resolved');
    const pending = await addExpense(checking.ID);
    linkReview(pending, 'pending');

    expect(services.transactions.getTransactionLinks(resolved)).toEqual(NONE);
    expect(services.transactions.getTransactionLinks(pending)).toEqual({
      ...NONE,
      bankReview: true,
    });
  });

  it('reports every kind at once', async () => {
    const { services, checking, addExpense, linkWarranty, linkOccurrence, linkReview } =
      await createFixture();
    const txId = await addExpense(checking.ID);
    linkWarranty(txId);
    linkOccurrence(txId);
    linkReview(txId);

    expect(services.transactions.getTransactionLinks(txId)).toEqual({
      warranty: true,
      recurringOccurrence: true,
      bankReview: true,
    });
  });

  it('includes the other leg of a transfer, since reverting deletes it too', async () => {
    const { services, budgetId, checking, savings, linkWarranty } = await createFixture();
    const { sourceId, destinationId } = await (async () => {
      const sourceId = await services.transactions.addTransaction(
        0,
        5_000,
        checking.ID,
        0,
        budgetId,
        '2026-09-02',
        'Move',
        'tr-1'
      );
      const destinationId = await services.transactions.addTransaction(
        5_000,
        0,
        savings.ID,
        0,
        budgetId,
        '2026-09-02',
        'Move',
        'tr-1'
      );
      return { sourceId, destinationId };
    })();
    linkWarranty(destinationId);

    expect(services.transactions.getTransactionLinks(sourceId).warranty).toBe(true);
    expect(services.transactions.getTransactionLinks(destinationId).warranty).toBe(true);
  });

  it('ignores split-transfer mirrors from other rows', async () => {
    const { services, budgetId, checking, savings, linkWarranty } = await createFixture();
    const own = await services.transactions.addTransaction(
      0,
      5_000,
      checking.ID,
      0,
      budgetId,
      '2026-09-02',
      'Split mirror',
      'split_transfer_9_x'
    );
    const other = await services.transactions.addTransaction(
      5_000,
      0,
      savings.ID,
      0,
      budgetId,
      '2026-09-02',
      'Other leg',
      'split_transfer_9_x'
    );
    linkWarranty(other);

    expect(services.transactions.getTransactionLinks(own)).toEqual(NONE);
  });
});
