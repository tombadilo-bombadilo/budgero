import { describe, expect, it } from 'vitest';
import { DatabaseAdapter, NodeSqlJsAdapter, ServiceManager } from '../src';

describe('user_meta InlineTransactionEntry preference', () => {
  it('defaults to off and round-trips through the service', async () => {
    const adapter = await NodeSqlJsAdapter.create();
    const serviceManager = new ServiceManager();
    await serviceManager.initialize(adapter as DatabaseAdapter);
    const { userMeta } = serviceManager.getServices();

    expect(userMeta.getInlineTransactionEntry()).toBe(false);
    userMeta.setInlineTransactionEntry(true);
    expect(userMeta.getInlineTransactionEntry()).toBe(true);
    userMeta.setInlineTransactionEntry(false);
    expect(userMeta.getInlineTransactionEntry()).toBe(false);
  });
});
