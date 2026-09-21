import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
// The integration test needs the Node database adapter; production uses the browser entry.
// eslint-disable-next-line no-restricted-imports
import { asMilli, NodeSqlJsAdapter, ServiceManager, type Services } from '@budgero/core';
import { withPushIdentity } from '@shared/runtime/push-identity';
import { executeMutationOp } from '@shared/mutations/op-code-registry';

const runtime = vi.hoisted(() => ({ services: undefined as Services | undefined }));
vi.mock('@shared/runtime/global', () => ({
  getRuntime: () => ({ services: () => runtime.services }),
}));

describe('pushed splits with real services', () => {
  let services: Services;
  let budgetId: number;
  let accountId: number;
  let categoryId: number;

  beforeEach(async () => {
    const manager = new ServiceManager();
    const cwd = vi.spyOn(process, 'cwd').mockReturnValue(resolve(process.cwd(), '../core'));
    try {
      await manager.initialize(await NodeSqlJsAdapter.create());
    } finally {
      cwd.mockRestore();
    }
    services = manager.getServices();
    runtime.services = services;
    budgetId = await services.budgets.createBudget({
      name: 'Push splits',
      display_currency: 'USD',
      badge_icon: 'dollar',
      number_format: '123,456.78',
      create_default_categories: true,
    });
    accountId = (
      await services.accounts.createAccount('Euro account', budgetId, 'checking', 'EUR', asMilli(0))
    ).ID;
    categoryId = services.categories
      .getAllCategories(budgetId)
      .find((category) => !['Income', 'Uncategorized', 'Transfers'].includes(category.Name))!.ID;
  });

  it('reconciles foreign-currency splits to the converted parent including rounding', async () => {
    const id = (await executeMutationOp('transactions.add', {
      accountId,
      budgetId,
      date: '2026-09-19',
      outflow: 10001,
      exchangeRateOverride: 1.1234,
      splits: [
        { categoryId, outflow: 7001 },
        { categoryId, outflow: 3000 },
      ],
    })) as number;
    const parent = services.transactions.getTransactionByID(id);
    const splits = services.splits.getSplits(id);
    expect(parent.OutflowConverted).not.toBe(parent.OutflowNative);
    expect(splits.reduce((sum, line) => sum + Number(line.OutflowNative), 0)).toBe(10001);
    expect(splits.reduce((sum, line) => sum + Number(line.OutflowConverted), 0)).toBe(
      parent.OutflowConverted
    );
  });
  it('persists the queue reference for update, replay, and repeated deletion', async () => {
    const args = withPushIdentity(
      {
        accountId,
        budgetId,
        categoryId,
        date: '2026-09-19',
        outflow: 10000,
        exchangeRateOverride: 1.25,
      },
      'original-push'
    );
    const id = (await executeMutationOp('transactions.add', args)) as number;
    await executeMutationOp('transactions.updateByRef', {
      messageId: 'original-push',
      fields: { outflow: 20000, memo: 'corrected' },
    });
    expect(services.transactions.getTransactionByID(id)).toMatchObject({
      OutflowNative: 20000,
      OutflowConverted: 25000,
      Memo: 'corrected',
    });
    expect(await executeMutationOp('transactions.add', args)).toBe(id);
    expect(services.transactions.getTransactionByID(id).OutflowNative).toBe(20000);
    await executeMutationOp('transactions.deleteByRef', { messageId: 'original-push' });
    expect(services.importHistory.duplicates.findOperation('push:original-push')).toBeUndefined();
    await expect(
      executeMutationOp('transactions.deleteByRef', { messageId: 'original-push' })
    ).resolves.toEqual({ deleted: false });
    expect(services.accounts.getAccount(accountId).BalanceNative).toBe(0);
  });

  it('replaying a referenced split add preserves edits to its lines', async () => {
    const args = withPushIdentity(
      {
        accountId,
        budgetId,
        date: '2026-09-19',
        outflow: 10000,
        exchangeRateOverride: 1.25,
        splits: [{ categoryId, outflow: 10000 }],
      },
      'split-push'
    );
    const id = (await executeMutationOp('transactions.add', args)) as number;
    const lines = services.splits.getSplits(id);
    await services.splits.upsertSplits(
      id,
      lines.map((line) => ({ ...line, Memo: 'edited' }))
    );
    expect(await executeMutationOp('transactions.add', args)).toBe(id);
    expect(services.splits.getSplits(id)[0].Memo).toBe('edited');
  });
});
