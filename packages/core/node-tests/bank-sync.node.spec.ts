import { describe, it, expect } from 'vitest';
import { NodeSqlJsAdapter, ServiceManager, asMilli } from '../src';
import {
  applyBankFeedSettings,
  bankOperationId,
  DEFAULT_BANK_FEED_SETTINGS,
  fromSimpleFINTransaction,
  parseBankFeedSettings,
  parseEnableBankingConfig,
  tidyPayeeName,
} from '../src/services/bank-sync';
import type {
  BankTransaction,
  EnableBankingSession,
  SimpleFINTransaction,
} from '../src/services/bank-sync/types';

const at = (date: string) => {
  const [y, m, d] = date.split('-').map(Number);
  return Math.floor(new Date(y, m - 1, d, 12).getTime() / 1000);
};
const tx = (
  id: string,
  date: string,
  amount: string,
  extra: Partial<SimpleFINTransaction> = {}
) => ({
  id,
  posted: at(date),
  amount,
  description: `Shop ${id}`,
  ...extra,
});

async function setup() {
  const db = await NodeSqlJsAdapter.create();
  const manager = new ServiceManager();
  await manager.initialize(db);
  const services = manager.getServices();
  const budgetId = await services.budgets.createBudget({
    name: 'Bank',
    display_currency: 'USD',
    badge_icon: 'dollar',
    number_format: '123,456.78',
    create_default_categories: false,
  });
  const account = await services.accounts.createAccount(
    'Checking',
    budgetId,
    'Checking',
    'USD',
    asMilli(0),
    {},
    true
  );
  services.bankSync.saveConnection(budgetId, 'https://user:pass@bridge.example/simplefin');
  services.bankSync.saveLink({
    budgetId,
    accountId: account.ID,
    externalAccountId: 'ACT-1',
    externalName: 'Everyday',
    orgName: 'Bank',
    importFrom: '2026-09-01',
  });
  const link = services.bankSync.listLinks(budgetId)[0];
  const plan = (
    transactions: SimpleFINTransaction[],
    wasImported: (row: { operationId: string }) => boolean = () => false
  ) =>
    services.bankSync.planImport({
      budgetId,
      accountId: account.ID,
      currency: 'USD',
      link,
      transactions: transactions.map(fromSimpleFINTransaction),
      wasImported,
    });
  const importRow = (identity: ReturnType<typeof plan>['imports'][number]) =>
    services.transactions.addTransaction(
      asMilli(identity.inflow),
      asMilli(identity.outflow),
      account.ID,
      0,
      budgetId,
      identity.date,
      identity.memo,
      '',
      identity.payee,
      null,
      null,
      false,
      [identity],
      true
    );
  return { services, budgetId, account, plan, importRow };
}

describe('SimpleFIN import planning', () => {
  it('imports posted rows from the link start date and skips pending ones', async () => {
    const { plan } = await setup();
    const result = plan([
      tx('a', '2026-09-05', '-12.34'),
      tx('b', '2026-09-06', '1500.00', { payee: 'Employer', memo: 'Salary' }),
      tx('old', '2026-08-20', '-5.00'),
      tx('p', '2026-09-07', '-3.00', { pending: true }),
      tx('z', '2026-09-07', '-3.00', { posted: 0 }),
    ]);
    expect(result.imports.map((row) => [row.payee, row.memo, row.inflow, row.outflow])).toEqual([
      ['Shop a', '', 0, 12340],
      ['Employer', 'Salary', 1500000, 0],
    ]);
    expect(result.reviews).toEqual([]);
  });

  it('skips rows already imported, even after the ledger copy was deleted', async () => {
    const { plan, importRow, services } = await setup();
    const first = plan([tx('a', '2026-09-05', '-12.34'), tx('b', '2026-09-06', '-4.00')]);
    const id = await importRow(first.imports[0]);
    await importRow(first.imports[1]);
    expect(plan([tx('a', '2026-09-05', '-12.34')]).imports).toEqual([]);
    services.transactions.deleteTransaction(id);
    const imported = new Set([first.imports[0].operationId]);
    const again = plan([tx('a', '2026-09-05', '-12.34')], (row) => imported.has(row.operationId));
    expect(again).toMatchObject({ imports: [], skipped: 1 });
  });

  it('keeps same-day identical purchases as separate bank rows', async () => {
    const { plan, importRow } = await setup();
    const first = plan([tx('a', '2026-09-05', '-5.00')]);
    await importRow(first.imports[0]);
    const second = plan([tx('a', '2026-09-05', '-5.00'), tx('b', '2026-09-05', '-5.00')]);
    expect(second.imports.map((row) => row.sourceKey)).toEqual([
      JSON.stringify(['simplefin-v1', 'ACT-1', 'b']),
    ]);
  });

  it('re-keys a row the bank re-issued under a new ID instead of importing it twice', async () => {
    const { plan, importRow } = await setup();
    const first = plan([tx('a', '2026-09-05', '-5.00'), tx('b', '2026-09-05', '-5.00')]);
    await importRow(first.imports[0]);
    await importRow(first.imports[1]);
    const rotated = plan([
      tx('a2', '2026-09-05', '-5.00', { description: 'Shop a' }),
      tx('b2', '2026-09-05', '-5.00', { description: 'Shop b' }),
      tx('c', '2026-09-05', '-5.00', { description: 'Shop a' }),
    ]);
    expect(rotated.rekeys.map((r) => r.identity.sourceKey)).toEqual([
      JSON.stringify(['simplefin-v1', 'ACT-1', 'a2']),
      JSON.stringify(['simplefin-v1', 'ACT-1', 'b2']),
    ]);
    expect(rotated.imports.map((r) => r.sourceKey)).toEqual([
      JSON.stringify(['simplefin-v1', 'ACT-1', 'c']),
    ]);
  });

  it('follows a re-issued row whose date also moved, and skips zero-amount rows', async () => {
    const { plan, importRow } = await setup();
    const first = plan([
      tx('pay1', '2026-09-10', '2564.48', { payee: 'You' }),
      tx('z', '2026-09-10', '0.00'),
    ]);
    expect(first.imports).toHaveLength(1);
    await importRow(first.imports[0]);
    const moved = plan([
      tx('old', '2026-09-08', '-1.00'),
      tx('pay2', '2026-09-09', '2564.48', { payee: 'You' }),
    ]);
    expect(moved.rekeys).toHaveLength(1);
    expect(moved.imports.map((r) => r.payee)).toEqual(['Shop old']);
    const later = plan([tx('pay3', '2026-09-20', '2564.48', { payee: 'You' })]);
    expect(later.rekeys).toEqual([]);
    expect(later.imports).toHaveLength(1);
  });

  it('matches hand entries with the duplicate settings: amount % and ± days', async () => {
    const { plan, services, account, budgetId } = await setup();
    const add = (date: string, outflow: number, payee: string) =>
      services.transactions.addTransaction(
        asMilli(0),
        asMilli(outflow),
        account.ID,
        0,
        budgetId,
        date,
        '',
        '',
        payee
      );
    const tip = await add('2026-09-01', 42000, 'Diner'); // bank books 42.30 (tip), 6 days later
    const far = await add('2026-08-20', 15000, 'Gym'); // 12 days off
    let result = plan([tx('a', '2026-09-07', '-42.30'), tx('b', '2026-09-01', '-15.00')]);
    expect(result.reviews.map((r) => r.candidateTransactionId)).toEqual([tip]);
    expect(result.imports).toHaveLength(1);
    // A wider window picks up the Gym entry; a tighter one drops the Diner match.
    services.userMeta.setDuplicateHintSettings({ dayWindow: 14 });
    result = plan([tx('b', '2026-09-01', '-15.00')]);
    expect(result.reviews.map((r) => r.candidateTransactionId)).toEqual([far]);
    services.userMeta.setDuplicateHintSettings({ dayWindow: 3, toleranceBps: 0 });
    expect(plan([tx('a', '2026-09-07', '-42.30')]).reviews).toEqual([]);
  });

  it('turns a pushed transaction matching a hand entry into a review, once', async () => {
    const { services, account, budgetId } = await setup();
    const manualId = await services.transactions.addTransaction(
      asMilli(0),
      asMilli(12500),
      account.ID,
      0,
      budgetId,
      '2026-09-01',
      '',
      '',
      'Coffee'
    );
    const identity = {
      operationId: 'push:m1',
      fileRowKey: 'push:m1',
      sourceKey: 'push-api',
      date: '2026-09-03',
      inflow: 0,
      outflow: 12500,
      payee: 'COFFEE #12',
      memo: '',
      currency: '',
      pushArgs: { categoryId: 7 },
    };
    const review = services.bankSync.reviewForPushed({ budgetId, accountId: account.ID, identity });
    expect(review).toMatchObject({
      candidateTransactionId: manualId,
      identity: { pushArgs: { categoryId: 7 } },
    });
    services.bankSync.addReviews([review!]);
    // The candidate is claimed by the pending review; another push for it is added as usual.
    expect(
      services.bankSync.reviewForPushed({
        budgetId,
        accountId: account.ID,
        identity: { ...identity, operationId: 'push:m2', fileRowKey: 'push:m2' },
      })
    ).toBeNull();
    // Nothing to match: add as usual.
    expect(
      services.bankSync.reviewForPushed({
        budgetId,
        accountId: account.ID,
        identity: { ...identity, operationId: 'push:m3', outflow: 99000 },
      })
    ).toBeNull();
  });

  it('queues a manual entry a few days off as a match review instead of importing', async () => {
    const { plan, services, account, budgetId } = await setup();
    const manualId = await services.transactions.addTransaction(
      asMilli(0),
      asMilli(42000),
      account.ID,
      0,
      budgetId,
      '2026-09-03',
      '',
      '',
      'Groceries'
    );
    const result = plan([tx('a', '2026-09-06', '-42.00'), tx('b', '2026-09-06', '-42.00')]);
    expect(result.reviews).toHaveLength(1);
    expect(result.reviews[0].candidateTransactionId).toBe(manualId);
    expect(result.imports).toHaveLength(1);

    services.bankSync.addReviews(result.reviews);
    const [review] = services.bankSync.listPendingReviews(budgetId);
    expect(review.candidate).toMatchObject({ id: manualId, payee: 'Groceries', outflow: 42000 });
    services.bankSync.setReviewStatus(review.ID, 'dismissed');
    expect(services.bankSync.listPendingReviews(budgetId)).toEqual([]);
    expect(plan([tx('a', '2026-09-06', '-42.00')])).toMatchObject({ reviews: [], skipped: 1 });
  });

  it('dates the opening balance when asked', async () => {
    const { services, budgetId } = await setup();
    const account = await services.accounts.createAccount(
      'Savings',
      budgetId,
      'Savings',
      'USD',
      asMilli(100000),
      {},
      true,
      'Initial Balance',
      '2026-08-31'
    );
    const rows = services.transactions.getTransactionsByAccount(account.ID);
    expect(rows.map((row) => row.Date)).toEqual(['2026-08-31']);
  });

  it('drops links and pending reviews with the connection', async () => {
    const { services, budgetId } = await setup();
    services.bankSync.deleteConnection(budgetId, 'simplefin');
    expect(services.bankSync.getConnection(budgetId, 'simplefin')).toBeNull();
    expect(services.bankSync.listLinks(budgetId)).toEqual([]);
  });
});

const session = (id: string, bank: string, hash = 'HASH-1'): EnableBankingSession => ({
  sessionId: id,
  aspsp: { name: bank, country: 'FI' },
  validUntil: '2027-03-31T00:00:00Z',
  createdAt: '2026-10-02T00:00:00Z',
  accounts: [{ uid: `uid-${id}`, hash, name: 'Current', currency: 'EUR' }],
});

describe('Enable Banking connections', () => {
  it('stores credentials, replaces a re-authorized bank and keeps sessions on key changes', async () => {
    const { services, budgetId } = await setup();
    services.bankSync.deleteConnection(budgetId, 'simplefin');
    services.bankSync.saveEnableBankingConnection(budgetId, {
      appId: 'app-1',
      privateKeyPem: 'PEM',
    });
    services.bankSync.saveEnableBankingSession(budgetId, session('s1', 'Nordea', 'HASH-1'));
    services.bankSync.saveEnableBankingSession(budgetId, session('s2', 'OP', 'HASH-2'));
    // Re-authorizing the Nordea login (same account) replaces s1.
    services.bankSync.saveEnableBankingSession(budgetId, session('s3', 'Nordea', 'HASH-1'));

    const connection = services.bankSync.getConnection(budgetId, 'enablebanking')!;
    expect(connection.Provider).toBe('enablebanking');
    let config = parseEnableBankingConfig(connection)!;
    expect(config.sessions.map((s) => s.sessionId)).toEqual(['s2', 's3']);

    services.bankSync.saveEnableBankingConnection(budgetId, {
      appId: 'app-1',
      privateKeyPem: 'NEW PEM',
    });
    config = parseEnableBankingConfig(services.bankSync.getConnection(budgetId, 'enablebanking'))!;
    expect(config.privateKeyPem).toBe('NEW PEM');
    expect(config.sessions).toHaveLength(2);

    services.bankSync.removeEnableBankingSession(budgetId, 's2');
    config = parseEnableBankingConfig(services.bankSync.getConnection(budgetId, 'enablebanking'))!;
    expect(config.sessions.map((s) => s.sessionId)).toEqual(['s3']);

    // A second login at the same bank (another person's accounts) keeps both.
    services.bankSync.saveEnableBankingSession(budgetId, session('s4', 'Nordea', 'HASH-9'));
    config = parseEnableBankingConfig(services.bankSync.getConnection(budgetId, 'enablebanking'))!;
    expect(config.sessions.map((s) => s.sessionId)).toEqual(['s3', 's4']);

    // A different application can't use the old app's sessions.
    services.bankSync.saveEnableBankingConnection(budgetId, {
      appId: 'other-app',
      privateKeyPem: 'PEM',
    });
    config = parseEnableBankingConfig(services.bankSync.getConnection(budgetId, 'enablebanking'))!;
    expect(config.sessions).toEqual([]);
  });

  it('keeps SimpleFIN and Enable Banking side by side, each with its own links', async () => {
    const { services, budgetId, account } = await setup();
    services.bankSync.saveEnableBankingConnection(budgetId, { appId: 'app', privateKeyPem: 'PEM' });
    const euAccount = await services.accounts.createAccount(
      'EU',
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
      accountId: euAccount.ID,
      externalAccountId: 'HASH-1',
      externalName: 'Current',
      orgName: 'Nordea',
      importFrom: '2026-09-01',
    });
    services.bankSync.recordSync({
      budgetId,
      provider: 'enablebanking',
      at: '2026-10-02T10:00:00Z',
      error: null,
      links: [],
    });

    expect(services.bankSync.listConnections(budgetId).map((c) => c.Provider)).toEqual([
      'simplefin',
      'enablebanking',
    ]);
    expect(services.bankSync.listLinks(budgetId, 'simplefin').map((l) => l.AccountID)).toEqual([
      account.ID,
    ]);
    expect(services.bankSync.getConnection(budgetId, 'simplefin')?.LastSyncAt).toBeNull();
    expect(services.bankSync.getConnection(budgetId, 'enablebanking')?.LastSyncAt).toBe(
      '2026-10-02T10:00:00Z'
    );

    services.bankSync.deleteConnection(budgetId, 'enablebanking');
    expect(services.bankSync.listConnections(budgetId).map((c) => c.Provider)).toEqual([
      'simplefin',
    ]);
    expect(services.bankSync.listLinks(budgetId).map((l) => l.Provider)).toEqual(['simplefin']);
  });

  it('ignores SimpleFIN connections and broken config', () => {
    expect(parseEnableBankingConfig({ Provider: 'simplefin', ConfigJSON: '{}' })).toBeNull();
    expect(parseEnableBankingConfig({ Provider: 'enablebanking', ConfigJSON: 'nope' })).toBeNull();
  });

  it('plans Enable Banking rows under their own namespace, never colliding with SimpleFIN', async () => {
    const { services, budgetId, account } = await setup();
    const row = (id: string, amount: number, pending = false): BankTransaction => ({
      id,
      date: '2026-09-05',
      amount,
      payee: 'Cafe',
      memo: '',
      pending,
    });
    const result = services.bankSync.planImport({
      budgetId,
      accountId: account.ID,
      currency: 'EUR',
      provider: 'enablebanking',
      link: { ExternalAccountID: 'HASH-1', ImportFrom: '2026-09-01' },
      transactions: [row('e1', -3500), row('e2', 120000), row('p', -1000, true)],
      wasImported: () => false,
    });
    expect(result.imports.map((r) => [r.sourceKey, r.inflow, r.outflow])).toEqual([
      [JSON.stringify(['enablebanking-v1', 'HASH-1', 'e1']), 0, 3500],
      [JSON.stringify(['enablebanking-v1', 'HASH-1', 'e2']), 120000, 0],
    ]);
    expect(result.imports[0].operationId).toBe(
      bankOperationId(budgetId, account.ID, 'HASH-1', 'e1', 'enablebanking')
    );
    expect(bankOperationId(budgetId, account.ID, 'HASH-1', 'e1')).toContain('simplefin-v1');
  });
});

describe('Bank feed settings', () => {
  it('title-cases only ALL-CAPS payees', () => {
    expect(tidyPayeeName('K-MARKET KAMPPI')).toBe('K-Market Kamppi');
    expect(tidyPayeeName("MCDONALD'S 7-ELEVEN")).toBe("Mcdonald's 7-Eleven");
    expect(tidyPayeeName('ÅHLÉNS CITY')).toBe('Åhléns City');
    expect(tidyPayeeName("McDonald's")).toBe("McDonald's");
    expect(tidyPayeeName('1234 5678')).toBe('1234 5678');
  });

  it('maps the chosen bank fields to date, payee and memo, falling back when missing', () => {
    const row: BankTransaction = {
      id: 'x',
      date: '2026-09-05',
      amount: -1000,
      payee: 'SHOP',
      memo: 'Card 1234',
      pending: false,
      fields: {
        counterparty: 'SHOP',
        description: 'Card 1234',
        bookingDate: '2026-09-07',
        transactionDate: '2026-09-05',
      },
    };
    const defaults = parseBankFeedSettings({ SettingsJSON: '{}' });
    expect(applyBankFeedSettings(row, defaults)).toMatchObject({
      date: '2026-09-05',
      payee: 'Shop',
      memo: 'Card 1234',
    });
    expect(
      applyBankFeedSettings(row, {
        ...defaults,
        date: 'booking',
        payee: 'description',
        memo: 'counterparty',
        tidyPayees: false,
      })
    ).toMatchObject({ date: '2026-09-07', payee: 'Card 1234', memo: 'SHOP' });
    // No value date from this bank: keep the default date.
    expect(applyBankFeedSettings(row, { ...defaults, date: 'value' }).date).toBe('2026-09-05');
    expect(applyBankFeedSettings(row, { ...defaults, memo: 'none' }).memo).toBe('');
  });

  it('stores settings per linked account', async () => {
    const { services, budgetId, account } = await setup();
    services.bankSync.updateLinkSettings(account.ID, {
      ...DEFAULT_BANK_FEED_SETTINGS,
      importPending: true,
    });
    const [link] = services.bankSync.listLinks(budgetId);
    expect(parseBankFeedSettings(link)).toMatchObject({ importPending: true, tidyPayees: true });
    // Re-linking the account keeps its settings.
    services.bankSync.saveLink({
      budgetId,
      accountId: account.ID,
      externalAccountId: 'ACT-1',
      externalName: 'Everyday',
      orgName: 'Bank',
      importFrom: '2026-09-01',
    });
    expect(parseBankFeedSettings(services.bankSync.listLinks(budgetId)[0]).importPending).toBe(
      true
    );
  });
});

describe('Pending transactions', () => {
  const row = (id: string, date: string, amount: number, pending: boolean, payee = 'Cafe') =>
    ({ id, date, amount, payee, memo: '', pending }) satisfies BankTransaction;

  async function pendingSetup(importPending = true) {
    const ctx = await setup();
    const link = ctx.services.bankSync.listLinks(ctx.budgetId)[0];
    const settings = { ...DEFAULT_BANK_FEED_SETTINGS, importPending };
    const applied = new Set<string>();
    const plan = (transactions: BankTransaction[]) =>
      ctx.services.bankSync.planImport({
        budgetId: ctx.budgetId,
        accountId: ctx.account.ID,
        currency: 'USD',
        provider: 'enablebanking',
        link,
        settings,
        transactions,
        wasImported: (r) => applied.has(r.operationId),
      });
    const importRow = async (identity: ReturnType<typeof plan>['imports'][number]) => {
      applied.add(identity.operationId);
      return ctx.importRow(identity);
    };
    return { ...ctx, plan, importRow, applied };
  }

  it('skips pending rows unless the account imports them', async () => {
    const off = await pendingSetup(false);
    expect(off.plan([row('p1', '2026-09-05', -4500, true)]).imports).toEqual([]);
    const on = await pendingSetup(true);
    const [identity] = on.plan([row('p1', '2026-09-05', -4500, true)]).imports;
    expect(identity).toMatchObject({ pending: true, outflow: 4500 });
    expect(identity.operationId.endsWith('#pending')).toBe(true);
  });

  it('settles a pending row booked under the same ID', async () => {
    const { plan, importRow } = await pendingSetup();
    const [pending] = plan([row('p1', '2026-09-05', -4500, true)]).imports;
    const id = await importRow(pending);
    expect(plan([row('p1', '2026-09-05', -4500, true)])).toMatchObject({ imports: [], skipped: 1 });
    const booked = plan([row('p1', '2026-09-06', -4500, false)]);
    expect(booked.imports).toEqual([]);
    expect(booked.settles).toMatchObject([
      { transactionId: id, identity: { date: '2026-09-06' }, previous: { pending: true } },
    ]);
  });

  it('settles a pending row the bank books under a new ID, preferring the same payee', async () => {
    const { plan, importRow } = await pendingSetup();
    const first = plan([
      row('p1', '2026-09-05', -4500, true, 'Cafe'),
      row('p2', '2026-09-05', -4500, true, 'Bar'),
    ]);
    const cafe = await importRow(first.imports[0]);
    const bar = await importRow(first.imports[1]);
    // The bank's answer covers the whole window, starting before both rows.
    const booked = plan([
      row('b0', '2026-09-01', -100, false, 'Kiosk'),
      row('b9', '2026-09-07', -4500, false, 'Bar'),
    ]);
    expect(booked.settles.map((s) => s.transactionId)).toEqual([bar]);
    expect(booked.imports.map((i) => i.payee)).toEqual(['Kiosk']);
    // The other pending row vanished without being booked: it's removed.
    expect(booked.removals).toEqual([cafe]);
  });

  it('keeps pending rows when the bank returned nothing at all', async () => {
    const { plan, importRow } = await pendingSetup();
    await importRow(plan([row('p1', '2026-09-05', -4500, true)]).imports[0]);
    expect(plan([]).removals).toEqual([]);
  });

  it("doesn't import a pending row that matches an entry typed by hand", async () => {
    const { plan, services, account, budgetId } = await pendingSetup();
    await services.transactions.addTransaction(
      asMilli(0),
      asMilli(4500),
      account.ID,
      0,
      budgetId,
      '2026-09-04',
      '',
      '',
      'Coffee'
    );
    const result = plan([row('p1', '2026-09-05', -4500, true)]);
    expect(result).toMatchObject({ imports: [], reviews: [], skipped: 1 });
  });

  it("doesn't bring back a pending row the user deleted once it's booked", async () => {
    const { plan, importRow, services } = await pendingSetup();
    const id = await importRow(plan([row('p1', '2026-09-05', -4500, true)]).imports[0]);
    services.transactions.deleteTransaction(id);
    const booked = plan([row('p1', '2026-09-06', -4500, false)]);
    expect(booked).toMatchObject({ imports: [], settles: [], skipped: 1 });
  });
});
