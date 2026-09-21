import { beforeEach, describe, expect, it } from 'vitest';
import { asMilli, NodeSqlJsAdapter, ServiceManager, type Services } from '../src';

describe('atomic pushed transaction updates', () => {
  let services: Services;
  let budgetId: number;
  let accountId: number;
  let categoryId: number;
  let id: number;

  beforeEach(async () => {
    const manager = new ServiceManager();
    await manager.initialize(await NodeSqlJsAdapter.create());
    services = manager.getServices();
    budgetId = await services.budgets.createBudget({
      name: 'Push updates',
      display_currency: 'USD',
      badge_icon: 'dollar',
      number_format: '123,456.78',
      create_default_categories: true,
    });
    accountId = (
      await services.accounts.createAccount('Checking', budgetId, 'checking', 'USD', asMilli(0))
    ).ID;
    categoryId = services.categories.getAllCategories(budgetId)[0].ID;
    id = await services.transactions.addTransaction(
      asMilli(0),
      asMilli(10000),
      accountId,
      categoryId,
      budgetId,
      '2026-09-19',
      'original'
    );
  });

  it.each([
    { memo: 'changed', outflow: 1.5 },
    { memo: 'changed', date: '2026-02-30' },
    { memo: 'changed', accountId: 999999 },
    { memo: 'changed', categoryId: 999999 },
    { memo: 'changed', inflow: 1000 },
    { memo: 'changed', outflow: -1 },
    { memo: 'changed', unknown: 1 },
  ])('rejects the entire invalid patch %j', async (fields) => {
    const before = services.transactions.getTransactionByID(id);
    const account = services.accounts.getAccount(accountId);
    await expect(services.transactions.updatePushedTransaction(id, fields)).rejects.toThrow();
    expect(services.transactions.getTransactionByID(id)).toEqual(before);
    expect(services.accounts.getAccount(accountId)).toEqual(account);
  });

  it('moves between accounts and changes direction without leaving old balances behind', async () => {
    const target = (
      await services.accounts.createAccount('Savings', budgetId, 'savings', 'USD', asMilli(0))
    ).ID;
    await services.transactions.updatePushedTransaction(id, {
      accountId: target,
      inflow: 5000,
      outflow: 0,
      memo: 'corrected',
      payee: ' Store ',
    });
    expect(services.accounts.getAccount(accountId).BalanceNative).toBe(0);
    expect(services.accounts.getAccount(target).BalanceNative).toBe(5000);
    expect(services.transactions.getTransactionByID(id)).toMatchObject({
      AccountID: target,
      InflowNative: 5000,
      OutflowNative: 0,
      Payee: 'Store',
      Memo: 'corrected',
    });
  });

  it('updates native amounts and preserves a pinned foreign-currency rate', async () => {
    const foreign = (
      await services.accounts.createAccount('Euros', budgetId, 'checking', 'EUR', asMilli(0))
    ).ID;
    const foreignId = await services.transactions.addTransaction(
      asMilli(0),
      asMilli(10000),
      foreign,
      categoryId,
      budgetId,
      '2026-09-19',
      '',
      '',
      '',
      null,
      1.25
    );
    await services.transactions.updatePushedTransaction(foreignId, { outflow: 20000 });
    expect(services.transactions.getTransactionByID(foreignId)).toMatchObject({
      OutflowNative: 20000,
      OutflowConverted: 25000,
      ExchangeRate: 1.25,
    });
    expect(services.accounts.getAccount(foreign).BalanceNative).toBe(-20000);
  });

  it('does not allow a parent amount update to unbalance existing splits', async () => {
    await services.splits.upsertSplits(id, [
      {
        CategoryID: categoryId,
        InflowConverted: asMilli(0),
        OutflowConverted: asMilli(10000),
        InflowNative: asMilli(0),
        OutflowNative: asMilli(10000),
      },
    ]);
    await expect(
      services.transactions.updatePushedTransaction(id, { outflow: 20000 })
    ).rejects.toThrow(/split/);
    expect(services.transactions.getTransactionByID(id).OutflowNative).toBe(10000);
    await services.transactions.updatePushedTransaction(id, { memo: 'updated' });
    expect(services.transactions.getTransactionByID(id).Memo).toBe('updated');
  });
  it('deleting a split parent also removes mirrored transfers and restores both balances', async () => {
    const target = (
      await services.accounts.createAccount('Savings', budgetId, 'savings', 'USD', asMilli(0))
    ).ID;
    await services.splits.upsertSplits(id, [
      {
        TransferAccountID: target,
        InflowConverted: asMilli(0),
        OutflowConverted: asMilli(10000),
        InflowNative: asMilli(0),
        OutflowNative: asMilli(10000),
      },
    ]);
    expect(services.accounts.getAccount(target).BalanceNative).toBe(10000);
    expect(services.transactions.getTransactionsForDelete([id])).toHaveLength(2);
    services.transactions.deleteTransaction(id);
    expect(services.accounts.getAccount(accountId).BalanceNative).toBe(0);
    expect(services.accounts.getAccount(target).BalanceNative).toBe(0);
    expect(
      services.transactions.getTransactionsByTransferID(`split_transfer_${id}_2026-09-19`)
    ).toEqual([]);
  });
});
