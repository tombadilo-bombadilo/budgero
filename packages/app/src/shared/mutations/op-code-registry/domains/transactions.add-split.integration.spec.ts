import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
// The integration test needs the Node database adapter; production uses the browser entry.
// eslint-disable-next-line no-restricted-imports
import { asMilli, NodeSqlJsAdapter, ServiceManager, type Services } from '@budgero/core';
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
});
