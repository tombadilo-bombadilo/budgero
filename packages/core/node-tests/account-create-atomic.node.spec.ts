import { afterEach, describe, expect, it, vi } from 'vitest';
import { asMilli, NodeSqlJsAdapter, ServiceManager, type DatabaseAdapter } from '../src';
import { getLocalDateString } from '../src/utils/date';
import { dumpDb } from './db-dump.helpers';

async function setup() {
  const db: DatabaseAdapter = await NodeSqlJsAdapter.create();
  const manager = new ServiceManager();
  await manager.initialize(db);
  const s = manager.getServices();
  const budgetId = await s.budgets.createBudget({
    name: 'B',
    display_currency: 'USD',
    badge_icon: 'dollar',
    number_format: '123,456.78',
    create_default_categories: false,
  });
  return { db, s, budgetId };
}

const today = getLocalDateString();

describe('createAccount is atomic (A9)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('offline crypto account without a rate writes nothing; a retry creates exactly one', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const { db, s, budgetId } = await setup();
    // The failed attempt used to leave the account and the Transfers/Income
    // system categories behind (local only: the op never synced).
    const before = dumpDb(db);
    await expect(
      s.accounts.createAccount('Wallet', budgetId, 'crypto', 'BTC', asMilli(100_000_000))
    ).rejects.toThrow(/No exchange rate/);
    expect(dumpDb(db)).toEqual(before);

    await s.currency.saveRate('BTC', 'USD', 50_000, today, budgetId);
    const account = await s.accounts.createAccount(
      'Wallet',
      budgetId,
      'crypto',
      'BTC',
      asMilli(100_000_000)
    );
    expect(s.accounts.listAccounts(budgetId).map((a) => a.Name)).toEqual(['Wallet']);
    expect(s.transactions.getTransactionsByAccount(account.ID)).toHaveLength(1);
  });

  it('a failure after the first insert rolls back the account, its categories and rows', async () => {
    const { db, s, budgetId } = await setup();
    const before = dumpDb(db);
    await expect(
      s.accounts.createAccount(
        'Mortgage',
        budgetId,
        'mortgage',
        'USD',
        asMilli(0),
        { debt_total: 200_000_000 },
        false,
        'Initial Balance',
        undefined,
        undefined,
        {
          bankLink: {
            provider: 'simplefin',
            externalAccountId: 'X',
            externalName: 'Mortgage',
            orgName: 'Bank',
            importFrom: null as unknown as string,
          },
        }
      )
    ).rejects.toThrow();
    expect(dumpDb(db)).toEqual(before);
  });

  it('opens a bank-linked account, its cleared opening row and the link together', async () => {
    const { s, budgetId } = await setup();
    const account = await s.accounts.createAccount(
      'Everyday',
      budgetId,
      'checking',
      'USD',
      asMilli(2_500_000),
      {},
      true,
      'Initial Balance',
      '2026-08-31',
      undefined,
      {
        openingCleared: true,
        bankLink: {
          provider: 'simplefin',
          externalAccountId: 'ACT-1',
          externalName: 'Everyday Checking',
          orgName: 'Bank',
          importFrom: '2026-09-01',
        },
      }
    );
    const [link] = s.bankSync.listLinks(budgetId);
    expect(link).toMatchObject({ AccountID: account.ID, ExternalAccountID: 'ACT-1' });
    const rows = s.transactions.getTransactionsByAccount(account.ID);
    expect(rows).toHaveLength(1);
    expect(Boolean(rows[0].Cleared)).toBe(true);
    expect(rows[0].Date).toBe('2026-08-31');
  });
});
