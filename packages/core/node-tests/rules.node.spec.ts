import { describe, it, expect, beforeEach, vi } from 'vitest';
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

  it('applies, undoes and redoes label.set actions, and clears labels with null', async () => {
    const coffee = services.labels.addLabel(budgetId, 'Coffee', '#aa5500');
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
      name: 'Label coffee',
      conditions: [{ field: 'memo', operator: 'contains', value: 'coffee' }],
      actions: [{ type: 'label.set', payload: { labelId: coffee } }],
    });
    const execution = await services.rules.executeRule(rule.id, {
      transactionIds: [transactionId],
      trigger: 'manual',
    });
    expect(execution.changes).toEqual([
      expect.objectContaining({ field: 'labelId', oldValue: null, newValue: coffee }),
    ]);
    expect(services.transactions.getTransactionByID(transactionId).LabelID).toBe(coffee);

    await services.rules.undoRun(execution.run.id);
    expect(services.transactions.getTransactionByID(transactionId).LabelID ?? null).toBeNull();
    await services.rules.redoRun(execution.run.id);
    expect(services.transactions.getTransactionByID(transactionId).LabelID).toBe(coffee);

    // A second rule clears the label again.
    const clear = services.rules.createRule({
      budgetId,
      name: 'Clear label',
      conditions: [{ field: 'memo', operator: 'contains', value: 'coffee' }],
      actions: [{ type: 'label.set', payload: { labelId: null } }],
    });
    await services.rules.executeRule(clear.id, { transactionIds: [transactionId] });
    expect(services.transactions.getTransactionByID(transactionId).LabelID ?? null).toBeNull();
  });

  it('skips a label.set whose label was deleted or belongs to another budget', async () => {
    const otherBudget = await services.budgets.createBudget({
      name: 'Other',
      display_currency: 'USD',
      badge_icon: 'bolt',
      number_format: 'dollar',
      create_default_categories: false,
    });
    const foreign = services.labels.addLabel(otherBudget, 'Foreign', '#000000');
    const transactionId = await services.transactions.addTransaction(
      0,
      10,
      accountId,
      categoryId,
      budgetId,
      getLocalDateString(),
      'Snack'
    );
    const rule = services.rules.createRule({
      budgetId,
      name: 'Foreign label',
      conditions: [{ field: 'memo', operator: 'contains', value: 'snack' }],
      actions: [
        { type: 'label.set', payload: { labelId: foreign } },
        { type: 'memo.set', payload: { memo: 'Snack (checked)' } },
      ],
    });
    const execution = await services.rules.executeRule(rule.id, {
      transactionIds: [transactionId],
    });
    expect(execution.changes.map((change) => change.field)).toEqual(['memo']);
    expect(services.transactions.getTransactionByID(transactionId).LabelID ?? null).toBeNull();
  });

  it('batch edit sets and clears labels in one undoable write', async () => {
    const travel = services.labels.addLabel(budgetId, 'Travel', '#3355ff');
    const ids = await Promise.all(
      ['Train', 'Hotel'].map((memo) =>
        services.transactions.addTransaction(
          0,
          10,
          accountId,
          categoryId,
          budgetId,
          getLocalDateString(),
          memo
        )
      )
    );
    await services.transactions.editTransactions(ids.map((id) => ({ id, labelId: travel })));
    expect(ids.map((id) => services.transactions.getTransactionByID(id).LabelID)).toEqual([
      travel,
      travel,
    ]);
    await services.transactions.editTransactions([{ id: ids[0], labelId: null }]);
    expect(services.transactions.getTransactionByID(ids[0]).LabelID ?? null).toBeNull();
    const foreignBudget = await services.budgets.createBudget({
      name: 'Elsewhere',
      display_currency: 'USD',
      badge_icon: 'bolt',
      number_format: 'dollar',
      create_default_categories: false,
    });
    const foreign = services.labels.addLabel(foreignBudget, 'Nope', '#000000');
    await expect(
      services.transactions.editTransactions([{ id: ids[1], labelId: foreign }])
    ).rejects.toThrow();
    // The failed batch changed nothing.
    expect(services.transactions.getTransactionByID(ids[1]).LabelID).toBe(travel);
  });

  it('applies and undoes memo.set actions', async () => {
    const today = getLocalDateString();
    const transactionId = await services.transactions.addTransaction(
      0,
      42,
      accountId,
      categoryId,
      budgetId,
      today,
      'walmart supercenter #123'
    );

    const rule = services.rules.createRule({
      budgetId,
      name: 'Walmart memo',
      conditions: [{ field: 'memo', operator: 'contains', value: 'walmart' }],
      actions: [{ type: 'memo.set', payload: { memo: 'WALMART!' } }],
    });

    const execution = await services.rules.executeRule(rule.id, {
      transactionIds: [transactionId],
      trigger: 'manual',
    });

    expect(execution.matchedCount).toBe(1);
    const memoChange = execution.changes.find((change) => change.field === 'memo');
    expect(memoChange?.oldValue).toBe('walmart supercenter #123');
    expect(memoChange?.newValue).toBe('WALMART!');
    expect(services.transactions.getTransactionByID(transactionId)?.Memo).toBe('WALMART!');

    const undoResult = await services.rules.undoRun(execution.run.id);
    expect(undoResult.restoredTransactions).toBe(1);
    expect(services.transactions.getTransactionByID(transactionId)?.Memo).toBe(
      'walmart supercenter #123'
    );
  });

  it('applies memo.set alongside category.set in the same rule', async () => {
    const today = getLocalDateString();
    const allCategories = services.categories.getAllCategories(budgetId);
    const otherCategoryId = allCategories.find((c: { ID: number }) => c.ID !== categoryId)!.ID;
    const transactionId = await services.transactions.addTransaction(
      0,
      10,
      accountId,
      categoryId,
      budgetId,
      today,
      'walmart groceries'
    );

    const rule = services.rules.createRule({
      budgetId,
      name: 'Walmart memo + category',
      conditions: [{ field: 'memo', operator: 'contains', value: 'walmart' }],
      actions: [
        { type: 'memo.set', payload: { memo: 'Groceries run' } },
        { type: 'category.set', payload: { categoryId: otherCategoryId } },
      ],
    });

    const execution = await services.rules.executeRule(rule.id, {
      transactionIds: [transactionId],
      trigger: 'manual',
    });

    expect(execution.matchedCount).toBe(1);
    expect(execution.changes.map((c) => c.field).sort()).toEqual(['categoryId', 'memo']);
    const updated = services.transactions.getTransactionByID(transactionId);
    expect(updated?.Memo).toBe('Groceries run');
    expect(updated?.CategoryID).toBe(otherCategoryId);
  });

  it('does not rebuild balances for metadata-only rules on plain transactions', async () => {
    const transactionId = await services.transactions.addTransaction(
      0,
      10,
      accountId,
      categoryId,
      budgetId,
      getLocalDateString(),
      'metadata target'
    );
    const rule = services.rules.createRule({
      budgetId,
      name: 'Metadata only',
      conditions: [{ field: 'memo', operator: 'contains', value: 'metadata target' }],
      actions: [{ type: 'memo.set', payload: { memo: 'updated metadata' } }],
    });
    const prepareSpy = vi.spyOn(adapter, 'prepare');

    await services.rules.executeRule(rule.id, { transactionIds: [transactionId] });

    const executedSql = prepareSpy.mock.calls.map(([sql]) => String(sql));
    expect(executedSql.some((sql) => sql.includes('WITH balances AS MATERIALIZED'))).toBe(false);
    expect(services.transactions.getTransactionByID(transactionId).Memo).toBe('updated metadata');
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
