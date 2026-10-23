import { afterEach, describe, expect, it, vi } from 'vitest';
import { NodeSqlJsAdapter, ServiceManager } from '../src';

afterEach(() => vi.unstubAllGlobals());

describe('account currency change while offline', () => {
  it('does not retry lookups that already failed in prepare, and undo stays exact', async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    vi.stubGlobal('fetch', fetchMock);
    const adapter = await NodeSqlJsAdapter.create();
    const manager = new ServiceManager();
    await manager.initialize(adapter);
    const s = manager.getServices();
    const budgetId = await s.budgets.createBudget({
      name: 'Offline',
      display_currency: 'USD',
      badge_icon: 'dollar',
      number_format: '123,456.78',
      create_default_categories: true,
    });
    const account = await s.accounts.createAccount('Cash', budgetId, 'checking', 'USD', 10_000);

    const rates = await s.accounts.prepareCurrencyChange(account.ID, 'EUR');
    expect(rates?.length).toBeGreaterThan(0);
    expect(rates!.every(([, , , rate]) => rate === null)).toBe(true);

    const dump = () => JSON.stringify(adapter.prepare('SELECT * FROM transactions').all());
    const before = dump();
    fetchMock.mockClear();
    const { journal } = await s.rowJournal.recordAsync(() =>
      s.accounts.updateAccount(
        account.ID,
        'Cash',
        'checking',
        'EUR',
        undefined,
        true,
        'convert',
        rates
      )
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(journal).not.toBeNull();
    s.rowJournal.restore(journal);
    expect(dump()).toBe(before);
    expect(s.accounts.getAccount(account.ID).Currency).toBe('USD');
  });
});
