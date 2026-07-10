import { describe, it, expect, beforeEach } from 'vitest';
import { getLocalDateString } from '../src/utils/date';
import { NodeSqlJsAdapter, ServiceManager, DatabaseAdapter } from '../src';

describe('Rules payee actions (Node/sql.js)', () => {
  let adapter: DatabaseAdapter;
  let sm: ServiceManager;
  let services: ReturnType<ServiceManager['getServices']>;
  let budgetId: number;
  let accountId: number;
  let categoryId: number;

  beforeEach(async () => {
    adapter = await NodeSqlJsAdapter.create();
    sm = new ServiceManager();
    await sm.initialize(adapter);
    services = sm.getServices();

    budgetId = await services.budgets.createBudget({
      name: 'Automation Budget',
      display_currency: 'USD',
      badge_icon: 'bolt',
      number_format: 'dollar',
      create_default_categories: true,
    });

    const account = await services.accounts.createAccount(
      'Everyday Checking',
      budgetId,
      'checking',
      'USD',
      1000
    );
    accountId = account.ID;

    const allCategories = services.categories.getAllCategories(budgetId);
    categoryId =
      allCategories.find((c: { Name: string; ID: number }) => c.Name !== 'Income')?.ID ??
      allCategories[0].ID;
  });

  it('applies and undoes payee.set actions', async () => {
    const today = getLocalDateString();
    const transactionId = await services.transactions.addTransaction(
      0,
      25,
      accountId,
      categoryId,
      budgetId,
      today,
      'Morning coffee'
    );

    const rule = services.rules.createRule({
      budgetId,
      name: 'Coffee payee normalisation',
      conditions: [
        {
          field: 'memo',
          operator: 'contains',
          value: 'coffee',
          options: { caseSensitive: false },
        },
      ],
      actions: [
        {
          type: 'payee.set',
          payload: { payee: 'Local Coffee Shop' },
        },
      ],
    });

    const execution = await services.rules.executeRule(rule.id, {
      transactionIds: [transactionId],
      trigger: 'manual',
    });

    expect(execution.matchedCount).toBe(1);
    const payeeChange = execution.changes.find((change) => change.field === 'payee');
    expect(payeeChange?.newValue).toBe('Local Coffee Shop');
    expect(payeeChange?.oldValue ?? '').toBe('');

    const updated = services.transactions.getTransactionByID(transactionId);
    expect(updated?.Payee).toBe('Local Coffee Shop');

    const undoResult = await services.rules.undoRun(execution.run.id);
    expect(undoResult.restoredTransactions).toBe(1);

    const restored = services.transactions.getTransactionByID(transactionId);
    expect(restored?.Payee ?? '').toBe('');
  });

  it('supports account conditions with is/is_not operators', async () => {
    const otherAccount = await services.accounts.createAccount(
      'High Yield Savings',
      budgetId,
      'savings',
      'USD',
      500000 // $500 in milliunits
    );

    const today = getLocalDateString();
    const checkingTxId = await services.transactions.addTransaction(
      0,
      12500, // $12.50 in milliunits
      accountId,
      categoryId,
      budgetId,
      today,
      'Snacks'
    );
    const savingsTxId = await services.transactions.addTransaction(
      0,
      20000, // $20 in milliunits
      otherAccount.ID,
      categoryId,
      budgetId,
      today,
      'Coffee subscription'
    );

    const accountRule = services.rules.createRule({
      budgetId,
      name: 'Checking payee label',
      conditions: [
        {
          field: 'account',
          operator: 'is',
          value: accountId,
        },
      ],
      actions: [
        {
          type: 'payee.set',
          payload: { payee: 'Checking Account Spend' },
        },
      ],
    });

    const accountExecution = await services.rules.executeRule(accountRule.id, {
      trigger: 'manual',
    });

    expect(accountExecution.matchedCount).toBeGreaterThanOrEqual(1);
    const checkingChangeFromIs = accountExecution.changes.find(
      (change) => change.transactionId === checkingTxId && change.field === 'payee'
    );
    expect(checkingChangeFromIs).toBeDefined();

    const updatedChecking = services.transactions.getTransactionByID(checkingTxId);
    const updatedSavings = services.transactions.getTransactionByID(savingsTxId);
    expect(updatedChecking?.Payee).toBe('Checking Account Spend');
    expect(updatedSavings?.Payee ?? '').toBe('');

    const inverseRule = services.rules.createRule({
      budgetId,
      name: 'Non-checking payee label',
      conditions: [
        {
          field: 'account',
          operator: 'is_not',
          value: accountId,
        },
      ],
      actions: [
        {
          type: 'payee.set',
          payload: { payee: 'Other Accounts Spend' },
        },
      ],
    });

    const inverseExecution = await services.rules.executeRule(inverseRule.id, {
      trigger: 'manual',
    });

    expect(inverseExecution.matchedCount).toBeGreaterThanOrEqual(1);
    const savingsChange = inverseExecution.changes.find(
      (change) => change.transactionId === savingsTxId && change.field === 'payee'
    );
    expect(savingsChange).toBeDefined();
    const checkingChange = inverseExecution.changes.find(
      (change) => change.transactionId === checkingTxId && change.field === 'payee'
    );
    expect(checkingChange).toBeUndefined();

    const savingsAfter = services.transactions.getTransactionByID(savingsTxId);
    expect(savingsAfter?.Payee).toBe('Other Accounts Spend');
    const checkingAfter = services.transactions.getTransactionByID(checkingTxId);
    expect(checkingAfter?.Payee).toBe('Checking Account Spend');
  });
});
