import { describe, expect, it } from 'vitest';
import { DatabaseAdapter, NodeSqlJsAdapter, ServiceManager } from '../src';

describe('user_meta compact budget rows preference', () => {
  it('defaults to normal rows and round-trips through the service', async () => {
    const adapter = await NodeSqlJsAdapter.create();
    const serviceManager = new ServiceManager();
    await serviceManager.initialize(adapter as DatabaseAdapter);
    const { userMeta } = serviceManager.getServices();

    expect(userMeta.getCompactBudgetRows()).toBe(false);
    userMeta.setCompactBudgetRows(true);
    expect(userMeta.getCompactBudgetRows()).toBe(true);
    // Independent of the register setting.
    expect(userMeta.getCompactTransactionRows()).toBe(false);
    userMeta.setCompactBudgetRows(false);
    expect(userMeta.getCompactBudgetRows()).toBe(false);
  });
});
