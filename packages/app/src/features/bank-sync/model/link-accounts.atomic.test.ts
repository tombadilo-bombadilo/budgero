import type { BankConnection } from '@budgero/core/browser';
import type { AppRuntime } from '@shared/runtime/app-runtime';
import { linkAccounts } from './link-accounts';

const mocks = vi.hoisted(() => ({
  ops: [] as { op: string; payload: Record<string, unknown> }[],
}));
vi.mock('@shared/runtime/mutation-router', () => ({
  executeSpaceMutation: async (
    _runtime: unknown,
    spec: { op: string; payload: Record<string, unknown> }
  ) => {
    mocks.ops.push(spec);
    return { ID: 41 };
  },
}));
vi.mock('../lib/provider', () => ({
  linkedExternalIds: () => new Set<string>(),
  fetchRemoteTransactions: async () => ({
    errors: [],
    accounts: [
      {
        id: 'ACT-1',
        name: 'Everyday',
        orgName: 'Bank',
        currency: 'USD',
        balance: 250_000,
        balanceDate: null,
        transactions: [],
      },
    ],
  }),
}));
vi.mock('./run-bank-sync', () => ({
  syncStart: () => new Date(2026, 8, 1),
  runBankSync: async () => ({ imported: 0, reviews: 0, errors: [] }),
}));

const runtime = {
  services: () => ({ bankSync: { listLinks: () => [] } }),
} as unknown as AppRuntime;
const connection = { BudgetID: 3, Provider: 'simplefin' } as unknown as BankConnection;
const remote = {
  id: 'ACT-1',
  name: 'Everyday',
  orgName: 'Bank',
  currency: 'USD',
  balance: 250_000,
  balanceDate: null,
};

describe('linking a bank account to a new account (A9)', () => {
  beforeEach(() => {
    mocks.ops = [];
  });

  it('creates the account, its cleared opening balance and the link in one op', async () => {
    await linkAccounts(runtime, connection, [
      {
        remote,
        importFrom: '2026-09-01',
        target: { kind: 'new', name: 'Everyday', type: 'Checking' as never },
      },
    ]);
    expect(mocks.ops.map((spec) => spec.op)).toEqual(['accounts.createLinked']);
    expect(mocks.ops[0].payload).toMatchObject({
      budgetId: 3,
      currency: 'USD',
      balance: 250_000,
      initialBalanceDate: '2026-08-31',
      link: {
        provider: 'simplefin',
        externalAccountId: 'ACT-1',
        externalName: 'Everyday',
        orgName: 'Bank',
        importFrom: '2026-09-01',
      },
    });
  });

  it('links an existing account with one saveLink op', async () => {
    await linkAccounts(runtime, connection, [
      { remote, importFrom: '2026-09-01', target: { kind: 'existing', accountId: 12 } },
    ]);
    expect(mocks.ops.map((spec) => spec.op)).toEqual(['bankSync.saveLink']);
    expect(mocks.ops[0].payload).toMatchObject({ input: { accountId: 12, budgetId: 3 } });
  });
});
