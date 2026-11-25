import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
// The integration test needs the Node database adapter; production uses the browser entry.
// eslint-disable-next-line no-restricted-imports
import { asMilli, NodeSqlJsAdapter, ServiceManager, type Services } from '@budgero/core';
import { DEFAULT_BANK_FEED_SETTINGS } from '@budgero/core/browser';
import type {
  EnableBankingSession,
  SimpleFINAccount,
  SimpleFINAccountSet,
} from '@budgero/core/browser';
import { executeMutationOp, prepareMutationArgs } from '@shared/mutations/op-code-registry';
import { BASE_MUTATION_FORMAT_VERSION, mutationFormatVersion } from '@budgero/runtime';
import type { AppRuntime } from '@shared/runtime/app-runtime';
import type { EnableBankingTransaction } from '../lib/enable-banking/client';
import { fromSimpleFINAccount } from '../lib/provider';
import { linkAccounts } from './link-accounts';
import { isSyncDue, runBankSync, syncStart } from './run-bank-sync';

const state = vi.hoisted(() => ({
  services: undefined as Services | undefined,
  applied: new Set<string>(),
  sent: [] as { op: string; payload: Record<string, unknown> }[],
  remote: { errors: [], accounts: [] } as SimpleFINAccountSet,
  fetches: 0,
  failSimpleFIN: false,
  eb: {
    rows: [] as EnableBankingTransaction[],
    balance: '0.00' as string | null,
    calls: [] as { uid: string; dateFrom: string; longest: boolean }[],
  },
}));
vi.mock('@shared/runtime/global', () => ({
  getRuntime: () => ({ services: () => state.services }),
}));
vi.mock('@shared/runtime/mutation-router', () => ({
  executeSpaceMutation: async (
    _runtime: unknown,
    spec: { op: string; payload: Record<string, unknown>; idempotencyKey?: string }
  ) => {
    if (spec.idempotencyKey) state.applied.add(spec.idempotencyKey);
    state.sent.push({ op: spec.op, payload: spec.payload });
    return executeMutationOp(spec.op, spec.payload);
  },
}));
vi.mock('../lib/simplefin-client', () => ({
  fetchTransactions: async () => {
    state.fetches++;
    if (state.failSimpleFIN) throw new Error('SimpleFIN is down');
    return structuredClone(state.remote);
  },
}));

vi.mock('../lib/enable-banking/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/enable-banking/client')>()),
  getBalance: async () =>
    state.eb.balance === null
      ? null
      : {
          amount: Math.round(Number(state.eb.balance) * 1000),
          currency: 'EUR',
          date: '2026-09-10T12:00:00Z',
          day: '2026-09-10',
        },
  getTransactions: async (
    _credentials: unknown,
    uid: string,
    dateFrom: string,
    options: { longest?: boolean } = {}
  ) => {
    state.eb.calls.push({ uid, dateFrom, longest: Boolean(options.longest) });
    return structuredClone(state.eb.rows);
  },
}));

const runtime = {
  services: () => state.services!,
  isMutationApplied: (id: string) => state.applied.has(id),
  save: async () => undefined,
} as unknown as AppRuntime;

const posted = (date: string) => {
  const [y, m, d] = date.split('-').map(Number);
  return Math.floor(new Date(y, m - 1, d, 12).getTime() / 1000);
};
const remoteAccount = (
  transactions: SimpleFINAccount['transactions'],
  balance = '900.00'
): SimpleFINAccount => ({
  org: { 'sfin-url': 'https://bridge.example', name: 'Bank' },
  id: 'ACT-1',
  name: 'Everyday Checking',
  currency: 'USD',
  balance,
  'balance-date': posted('2026-09-10'),
  transactions,
});

describe('bank sync engine', () => {
  let services: Services;
  let budgetId: number;

  beforeEach(async () => {
    const manager = new ServiceManager();
    const cwd = vi.spyOn(process, 'cwd').mockReturnValue(resolve(process.cwd(), '../core'));
    try {
      await manager.initialize(await NodeSqlJsAdapter.create());
    } finally {
      cwd.mockRestore();
    }
    services = manager.getServices();
    state.services = services;
    state.applied.clear();
    state.sent = [];
    state.fetches = 0;
    state.failSimpleFIN = false;
    state.eb = { rows: [], balance: '0.00', calls: [] };
    budgetId = await services.budgets.createBudget({
      name: 'Bank sync',
      display_currency: 'USD',
      badge_icon: 'dollar',
      number_format: '123,456.78',
      create_default_categories: true,
    });
    services.bankSync.saveConnection(budgetId, 'https://u:p@bridge.example/simplefin');
  });

  const link = async (importFrom = '2026-09-01') => {
    const account = await services.accounts.createAccount(
      'Checking',
      budgetId,
      'Checking',
      'USD',
      asMilli(0),
      {},
      true
    );
    services.bankSync.saveLink({
      budgetId,
      accountId: account.ID,
      externalAccountId: 'ACT-1',
      externalName: 'Everyday Checking',
      orgName: 'Bank',
      importFrom,
    });
    return account.ID;
  };

  it('imports cleared rows once and never resurrects ones the user deleted', async () => {
    const accountId = await link();
    state.remote = {
      errors: [],
      accounts: [
        remoteAccount([
          { id: 't1', posted: posted('2026-09-02'), amount: '-25.50', description: 'Grocer' },
          { id: 't2', posted: posted('2026-09-03'), amount: '-4.00', description: 'Coffee' },
          { id: 't3', posted: 0, amount: '-9.00', description: 'Pending', pending: true },
        ]),
      ],
    };
    expect(await runBankSync(runtime, budgetId)).toEqual({ imported: 2, reviews: 0, errors: [] });
    const rows = services.transactions.getTransactionsByAccount(accountId);
    expect(rows.map((row) => [row.Date, row.OutflowNative, Boolean(row.Cleared)])).toEqual(
      expect.arrayContaining([
        ['2026-09-02', 25500, true],
        ['2026-09-03', 4000, true],
      ])
    );
    const [linked] = services.bankSync.listLinks(budgetId);
    expect(linked.LastBalance).toBe(900000);
    expect(services.bankSync.getConnection(budgetId, 'simplefin')?.LastSyncAt).toBeTruthy();

    expect((await runBankSync(runtime, budgetId)).imported).toBe(0);
    const coffee = rows.find((row) => row.OutflowNative === 4000)!;
    services.transactions.deleteTransaction(coffee.ID);
    expect((await runBankSync(runtime, budgetId)).imported).toBe(0);
  });

  it('keeps bank times only while times are shown, and only then needs format 7', async () => {
    const accountId = await link();
    const at = (time: string) => {
      const [h, m, sec] = time.split(':').map(Number);
      return Math.floor(new Date(2026, 8, 2, h, m, sec).getTime() / 1000);
    };
    state.remote = {
      errors: [],
      accounts: [
        remoteAccount([
          { id: 'm', posted: at('08:15:20'), amount: '-25.50', description: 'Grocer' },
          { id: 'e', posted: at('19:42:05'), amount: '-4.00', description: 'Coffee' },
        ]),
      ],
    };
    const imports = async () => {
      const ops = state.sent.filter((call) => call.op === 'transactions.import');
      return Promise.all(
        ops.map(async (call) => ({
          time: call.payload.time,
          format: mutationFormatVersion(call.op, await prepareMutationArgs(call.op, call.payload)),
        }))
      );
    };

    // Times hidden (the default): no time, the old format.
    expect((await runBankSync(runtime, budgetId)).imported).toBe(2);
    expect(await imports()).toEqual([
      { time: undefined, format: BASE_MUTATION_FORMAT_VERSION },
      { time: undefined, format: BASE_MUTATION_FORMAT_VERSION },
    ]);
    expect(services.transactions.getTransactionsByAccount(accountId).map((r) => r.Time)).toEqual([
      null,
      null,
    ]);

    // Times shown: a fresh account's rows come in with their times, format 7.
    for (const row of services.transactions.getTransactionsByAccount(accountId)) {
      services.transactions.deleteTransaction(row.ID);
    }
    services.userMeta.setShowTransactionTime(true);
    state.sent = [];
    state.applied.clear();
    state.remote.accounts[0].transactions = [
      { id: 'm2', posted: at('08:15:20'), amount: '-25.50', description: 'Grocer' },
      { id: 'e2', posted: at('19:42:05'), amount: '-4.00', description: 'Coffee' },
    ];
    expect((await runBankSync(runtime, budgetId)).imported).toBe(2);
    expect(await imports()).toEqual([
      { time: '08:15', format: 7 },
      { time: '19:42', format: 7 },
    ]);
  });

  it('survives a bank that re-issues every transaction ID on each fetch', async () => {
    const accountId = await link();
    const fetchWithIds = (suffix: string) => ({
      errors: [],
      accounts: [
        remoteAccount([
          {
            id: `g${suffix}`,
            posted: posted('2026-09-02'),
            amount: '-25.50',
            description: 'Grocer',
          },
          {
            id: `c${suffix}`,
            posted: posted('2026-09-03'),
            amount: '-4.00',
            description: 'Coffee',
          },
        ]),
      ],
    });
    state.remote = fetchWithIds('1');
    expect((await runBankSync(runtime, budgetId)).imported).toBe(2);
    state.remote = fetchWithIds('2');
    expect((await runBankSync(runtime, budgetId)).imported).toBe(0);
    state.remote = fetchWithIds('3');
    expect((await runBankSync(runtime, budgetId)).imported).toBe(0);
    state.remote = fetchWithIds('2');
    expect((await runBankSync(runtime, budgetId)).imported).toBe(0);
    expect(services.transactions.getTransactionsByAccount(accountId)).toHaveLength(2);
  });

  it('shares one fetch between overlapping sync triggers', async () => {
    await link();
    state.remote = { errors: [], accounts: [remoteAccount([])] };
    await Promise.all([runBankSync(runtime, budgetId), runBankSync(runtime, budgetId)]);
    expect(state.fetches).toBe(1);
  });

  it('queues a hand-entered twin for review instead of importing it', async () => {
    const accountId = await link();
    await services.transactions.addTransaction(
      asMilli(0),
      asMilli(60000),
      accountId,
      0,
      budgetId,
      '2026-09-04',
      '',
      '',
      'Electric'
    );
    state.remote = {
      errors: [],
      accounts: [
        remoteAccount([
          { id: 'e1', posted: posted('2026-09-06'), amount: '-60.00', description: 'POWER CO' },
        ]),
      ],
    };
    expect(await runBankSync(runtime, budgetId)).toMatchObject({ imported: 0, reviews: 1 });
    expect(services.bankSync.listPendingReviews(budgetId, accountId)[0].candidate?.payee).toBe(
      'Electric'
    );
  });

  it('opens a new linked account so it lands on the bank balance', async () => {
    const remote = remoteAccount(
      [
        { id: 'a', posted: posted('2026-09-02'), amount: '-100.00', description: 'Rent' },
        { id: 'b', posted: posted('2026-09-05'), amount: '2000.00', description: 'Salary' },
      ],
      '2500.00'
    );
    state.remote = { errors: [], accounts: [remote] };
    const connection = services.bankSync.getConnection(budgetId, 'simplefin')!;
    const result = await linkAccounts(runtime, connection, [
      {
        remote: fromSimpleFINAccount(remote),
        importFrom: '2026-09-01',
        target: { kind: 'new', name: 'Everyday', type: 'Checking' as never },
      },
    ]);
    expect(result.imported).toBe(2);
    const [linked] = services.bankSync.listLinks(budgetId);
    const rows = services.transactions.getTransactionsByAccount(linked.AccountID);
    const net = rows.reduce(
      (sum, row) => sum + (row.InflowNative ?? 0) - (row.OutflowNative ?? 0),
      0
    );
    expect(net).toBe(2500000);
    expect(rows.every((row) => Boolean(row.Cleared))).toBe(true);
    expect(rows.map((row) => row.Date).sort()[0]).toBe('2026-08-31');
  });

  it('overlaps a week behind the last sync but never before the link start', () => {
    expect(syncStart({ ImportFrom: '2026-09-01', LastSyncAt: null })).toEqual(new Date(2026, 8, 1));
    const last = new Date(2026, 8, 20, 10).toISOString();
    expect(syncStart({ ImportFrom: '2026-09-01', LastSyncAt: last })).toEqual(
      new Date(2026, 8, 13, 10)
    );
    expect(syncStart({ ImportFrom: '2026-09-18', LastSyncAt: last })).toEqual(
      new Date(2026, 8, 18)
    );
    const now = new Date(2026, 8, 20, 15).getTime();
    expect(isSyncDue(last, now)).toBe(false);
    expect(isSyncDue(new Date(2026, 8, 20, 8).toISOString(), now)).toBe(true);
    expect(isSyncDue(null, now)).toBe(true);
  });

  describe('Enable Banking', () => {
    const session = (id: string, uid: string, validUntil = '2099-01-01T00:00:00Z') =>
      ({
        sessionId: id,
        aspsp: { name: 'Nordea', country: 'FI' },
        validUntil,
        createdAt: new Date().toISOString(),
        accounts: [{ uid, hash: 'HASH-1', name: 'Käyttötili', currency: 'EUR' }],
      }) satisfies EnableBankingSession;
    const ebRow = (ref: string, date: string, amount: string, debit = true) =>
      ({
        entry_reference: ref,
        transaction_amount: { amount, currency: 'EUR' },
        credit_debit_indicator: debit ? 'DBIT' : 'CRDT',
        status: 'BOOK',
        booking_date: date,
        creditor: { name: `Shop ${ref}` },
      }) satisfies EnableBankingTransaction;

    // The SimpleFIN connection from beforeEach stays: both providers coexist.
    const linkEnableBanking = async () => {
      services.bankSync.saveEnableBankingConnection(budgetId, {
        appId: 'app',
        privateKeyPem: 'PEM',
      });
      services.bankSync.saveEnableBankingSession(budgetId, session('s1', 'uid-1'));
      const account = await services.accounts.createAccount(
        'Käyttötili',
        budgetId,
        'Checking',
        'EUR',
        asMilli(0),
        {},
        true
      );
      services.bankSync.saveLink({
        budgetId,
        provider: 'enablebanking',
        accountId: account.ID,
        externalAccountId: 'HASH-1',
        externalName: 'Käyttötili',
        orgName: 'Nordea',
        importFrom: '2026-09-01',
      });
      state.eb.calls = [];
      return account.ID;
    };

    it('imports booked rows once, across a re-authorization that changes account IDs', async () => {
      const accountId = await linkEnableBanking();
      state.eb.balance = '470.50';
      state.eb.rows = [
        ebRow('e1', '2026-09-02', '25.50'),
        ebRow('e2', '2026-09-03', '500.00', false),
      ];
      expect(await runBankSync(runtime, budgetId)).toEqual({ imported: 2, reviews: 0, errors: [] });
      expect(state.eb.calls).toEqual([{ uid: 'uid-1', dateFrom: '2026-09-01', longest: true }]);
      expect(services.bankSync.listLinks(budgetId)[0].LastBalance).toBe(470500);

      // The bank's yearly re-consent: a new session with new UIDs, same identification hash.
      services.bankSync.saveEnableBankingSession(budgetId, session('s2', 'uid-2'));
      state.eb.rows.push(ebRow('e3', '2026-09-04', '4.00'));
      expect(await runBankSync(runtime, budgetId)).toMatchObject({ imported: 1, errors: [] });
      expect(state.eb.calls.at(-1)).toMatchObject({ uid: 'uid-2', longest: false });
      expect(services.transactions.getTransactionsByAccount(accountId)).toHaveLength(3);
    });

    it('syncs SimpleFIN and Enable Banking together, and one failing spares the other', async () => {
      const usAccount = await link();
      const euAccount = await linkEnableBanking();
      state.remote = {
        errors: [],
        accounts: [
          remoteAccount([
            { id: 't1', posted: posted('2026-09-02'), amount: '-25.50', description: 'Grocer' },
          ]),
        ],
      };
      state.eb.rows = [ebRow('e1', '2026-09-02', '10.00')];
      expect(await runBankSync(runtime, budgetId)).toMatchObject({ imported: 2, errors: [] });
      expect(services.transactions.getTransactionsByAccount(usAccount)).toHaveLength(1);
      expect(services.transactions.getTransactionsByAccount(euAccount)).toHaveLength(1);

      state.failSimpleFIN = true;
      state.eb.rows.push(ebRow('e2', '2026-09-03', '4.00'));
      const result = await runBankSync(runtime, budgetId);
      expect(result.imported).toBe(1);
      expect(result.errors).toEqual(['SimpleFIN is down']);
      expect(services.bankSync.getConnection(budgetId, 'simplefin')?.LastError).toBe(
        'SimpleFIN is down'
      );
      expect(services.bankSync.getConnection(budgetId, 'enablebanking')?.LastError).toBeNull();
    });

    const newEnableBankingAccount = () => {
      services.bankSync.saveEnableBankingConnection(budgetId, {
        appId: 'app',
        privateKeyPem: 'PEM',
      });
      services.bankSync.saveEnableBankingSession(budgetId, session('s1', 'uid-1'));
      const connection = services.bankSync.getConnection(budgetId, 'enablebanking')!;
      return linkAccounts(runtime, connection, [
        {
          remote: {
            id: 'HASH-1',
            name: 'Käyttötili',
            orgName: 'Nordea',
            currency: 'EUR',
            balance: null,
            balanceDate: null,
          },
          importFrom: '2026-09-01',
          target: { kind: 'new', name: 'Käyttötili', type: 'Checking' as never },
        },
      ]);
    };

    it("opens a new account from the bank's balance day, not the device's timezone", async () => {
      state.eb.balance = '100.00';
      // Booked on the balance day: already in the balance. The day after: not yet.
      state.eb.rows = [ebRow('e1', '2026-09-10', '25.50'), ebRow('e2', '2026-09-11', '4.00')];
      await newEnableBankingAccount();
      const [link] = services.bankSync.listLinks(budgetId, 'enablebanking');
      const rows = services.transactions.getTransactionsByAccount(link.AccountID);
      const opening = rows.find((row) => row.Date === '2026-08-31')!;
      expect(opening.InflowNative).toBe(125500);
      expect(rows.every((row) => Boolean(row.Cleared))).toBe(true);
    });

    it('refuses to open a new account when the bank sends no balance', async () => {
      state.eb.balance = null;
      state.eb.rows = [ebRow('e1', '2026-09-02', '25.50')];
      const before = services.accounts.listAccounts(budgetId).length;
      await expect(newEnableBankingAccount()).rejects.toThrow(/didn't send a balance/);
      expect(services.accounts.listAccounts(budgetId)).toHaveLength(before);
      expect(services.bankSync.listLinks(budgetId, 'enablebanking')).toEqual([]);
    });

    const ebRequest = (id: string, name: string) => ({
      remote: { id, name, orgName: 'Nordea', currency: 'EUR', balance: null, balanceDate: null },
      importFrom: '2026-09-01',
      target: { kind: 'new' as const, name, type: 'Checking' as never },
    });

    it("links the accounts the bank returned and names the one it didn't", async () => {
      services.bankSync.saveEnableBankingConnection(budgetId, {
        appId: 'app',
        privateKeyPem: 'PEM',
      });
      services.bankSync.saveEnableBankingSession(budgetId, session('s1', 'uid-1'));
      state.eb.balance = '100.00';
      state.eb.rows = [ebRow('e1', '2026-09-02', '25.50')];
      const connection = services.bankSync.getConnection(budgetId, 'enablebanking')!;
      const result = await linkAccounts(runtime, connection, [
        ebRequest('HASH-1', 'Käyttötili'),
        ebRequest('HASH-2', 'Säästötili'),
      ]);
      expect(result.imported).toBe(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toMatch(/didn't return Säästötili.*Reconnect Nordea/);
      const links = services.bankSync.listLinks(budgetId, 'enablebanking');
      expect(links.map((link) => link.ExternalAccountID)).toEqual(['HASH-1']);
      expect(services.accounts.listAccounts(budgetId).map((a) => a.Name)).not.toContain(
        'Säästötili'
      );
    });

    it('links nothing and says why when the bank returned none of the accounts', async () => {
      services.bankSync.saveEnableBankingConnection(budgetId, {
        appId: 'app',
        privateKeyPem: 'PEM',
      });
      services.bankSync.saveEnableBankingSession(budgetId, session('s1', 'uid-1'));
      const before = services.accounts.listAccounts(budgetId).length;
      const connection = services.bankSync.getConnection(budgetId, 'enablebanking')!;
      await expect(
        linkAccounts(runtime, connection, [ebRequest('HASH-2', 'Säästötili')])
      ).rejects.toThrow(/didn't return Säästötili, so it wasn't linked/);
      expect(services.accounts.listAccounts(budgetId)).toHaveLength(before);
      expect(services.bankSync.listLinks(budgetId, 'enablebanking')).toEqual([]);
    });

    it('imports pending rows uncleared, then settles or removes them as the bank decides', async () => {
      const accountId = await linkEnableBanking();
      services.bankSync.updateLinkSettings(accountId, {
        ...DEFAULT_BANK_FEED_SETTINGS,
        importPending: true,
      });
      const pending = (ref: string, date: string, amount: string) => ({
        ...ebRow(ref, date, amount),
        status: 'PDNG',
      });
      state.eb.rows = [
        ebRow('e0', '2026-09-02', '5.00'),
        pending('p1', '2026-09-05', '12.00'),
        pending('hold', '2026-09-05', '80.00'),
      ];
      expect(await runBankSync(runtime, budgetId)).toMatchObject({ imported: 3 });
      const byOutflow = () =>
        new Map(
          services.transactions
            .getTransactionsByAccount(accountId)
            .map((row) => [Number(row.OutflowNative), row] as const)
        );
      const coffee = byOutflow().get(12000)!;
      expect(Boolean(coffee.Cleared)).toBe(false);
      expect(Boolean(byOutflow().get(80000)!.Cleared)).toBe(false);
      await services.transactions.updateTransactionColumn(coffee.ID, 'memo', 'with Anna');

      // Booked under a new reference a day later; the hold was released.
      state.eb.rows = [ebRow('e0', '2026-09-02', '5.00'), ebRow('b1', '2026-09-06', '12.00')];
      expect(await runBankSync(runtime, budgetId)).toMatchObject({ imported: 0, errors: [] });
      const after = byOutflow();
      const settled = after.get(12000)!;
      expect(settled.ID).toBe(coffee.ID);
      expect(Boolean(settled.Cleared)).toBe(true);
      expect(settled.Date).toBe('2026-09-06');
      expect(settled.Memo).toBe('with Anna');
      expect(after.has(80000)).toBe(false);

      // Nothing doubles up on the next sync.
      expect(await runBankSync(runtime, budgetId)).toMatchObject({ imported: 0 });
      expect(services.transactions.getTransactionsByAccount(accountId)).toHaveLength(2);
    });

    it('reports an expired consent without calling the bank', async () => {
      await linkEnableBanking();
      services.bankSync.saveEnableBankingSession(
        budgetId,
        session('s1', 'uid-1', '2020-01-01T00:00:00Z')
      );
      const result = await runBankSync(runtime, budgetId);
      expect(result.imported).toBe(0);
      expect(result.errors.join(' ')).toContain('Nordea');
      expect(state.eb.calls).toEqual([]);
    });
  });
});
