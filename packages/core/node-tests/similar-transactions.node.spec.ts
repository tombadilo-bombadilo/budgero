import { describe, it, expect } from 'vitest';
import { NodeSqlJsAdapter, ServiceManager, DatabaseAdapter, asMilli } from '../src';

async function setup() {
  const adapter = await NodeSqlJsAdapter.create();
  const sm = new ServiceManager();
  await sm.initialize(adapter as DatabaseAdapter);
  const services = sm.getServices();
  const budgetId = await services.budgets.createBudget({
    name: 'Similar',
    display_currency: 'USD',
    badge_icon: 'dollar',
    number_format: '123,456.78',
    create_default_categories: false,
  });
  const group = services.categories.addCategoryGroup('G', budgetId);
  const categoryId = services.categories.addCategory(group, budgetId, 'Food');
  const accountId = (
    await services.accounts.createAccount('Checking', budgetId, 'checking', 'USD', 0)
  ).ID;
  const other = (await services.accounts.createAccount('Savings', budgetId, 'savings', 'USD', 0))
    .ID;
  /** Positive `amount` is an outflow; negative is an inflow. */
  const add = (date: string, amount: number, payee: string, account = accountId, transferId = '') =>
    services.transactions.addTransaction(
      asMilli(Math.max(0, -amount)),
      asMilli(Math.max(0, amount)),
      account,
      categoryId,
      budgetId,
      date,
      '',
      transferId,
      payee
    );
  return { adapter, services, accountId, other, categoryId, add };
}

describe('TransactionService.findSimilarTransactions', () => {
  it('finds a pending/settled pair within the window, nearest date first', async () => {
    const { services, accountId, add } = await setup();
    await add('2026-09-20', 12_400, 'Coffee (pending)');
    await add('2026-09-25', 12_450, 'Coffee'); // within 1%
    await add('2026-09-25', 50_000, 'Groceries'); // different amount
    await add('2026-09-10', 12_400, 'Old coffee'); // outside ±7 days

    const matches = services.transactions.findSimilarTransactions({
      accountId,
      date: '2026-09-26',
      amountNative: -12_400,
    });

    expect(matches.map((m) => [m.Date, m.Payee, m.AmountNative])).toEqual([
      ['2026-09-25', 'Coffee', -12_450],
      ['2026-09-20', 'Coffee (pending)', -12_400],
    ]);
  });

  it('includes both window edges and stored dates with a time part', async () => {
    const { services, accountId, add } = await setup();
    await add('2026-09-19', 12_400, 'Lower edge');
    await add('2026-10-03T08:30:00', 12_400, 'Upper edge with time');
    await add('2026-10-04', 12_400, 'Too late');

    const payees = services.transactions
      .findSimilarTransactions({ accountId, date: '2026-09-26', amountNative: -12_400, limit: 10 })
      .map((m) => m.Payee);

    expect(payees.sort()).toEqual(['Lower edge', 'Upper edge with time']);
  });

  it('ignores other accounts, transfer legs, opposite direction, and zero amounts', async () => {
    const { services, accountId, other, add } = await setup();
    await add('2026-09-26', 12_400, 'Other account', other);
    await add('2026-09-26', 12_400, 'Transfer leg', accountId, 'transfer-1');
    await add('2026-09-26', -12_400, 'Refund');

    expect(
      services.transactions.findSimilarTransactions({
        accountId,
        date: '2026-09-26',
        amountNative: -12_400,
      })
    ).toEqual([]);
    expect(
      services.transactions.findSimilarTransactions({
        accountId,
        date: '2026-09-26',
        amountNative: 0,
      })
    ).toEqual([]);
  });

  it('skips reconciled and split rows with plainOnly', async () => {
    const { adapter, services, accountId, categoryId, add } = await setup();
    const plain = await add('2026-09-26', 12_400, 'Plain');
    const reconciled = await add('2026-09-26', 12_400, 'Reconciled');
    const split = await add('2026-09-26', 12_400, 'Split');
    adapter.exec(`UPDATE transactions SET Reconciled = 1, Cleared = 1 WHERE ID = ${reconciled}`);
    await services.transactions.saveSplitTransaction(split, {
      splits: [6_200, 6_200].map((outflow, OrderIndex) => ({
        CategoryID: categoryId,
        Memo: '',
        InflowConverted: asMilli(0),
        OutflowConverted: asMilli(outflow),
        OrderIndex,
      })),
    });
    const query = { accountId, date: '2026-09-26', amountNative: -12_400, limit: 10 };

    expect(
      services.transactions
        .findSimilarTransactions(query)
        .map((m) => m.ID)
        .sort()
    ).toEqual([plain, reconciled, split].sort());
    expect(
      services.transactions.findSimilarTransactions({ ...query, plainOnly: true }).map((m) => m.ID)
    ).toEqual([plain]);
  });

  it('uses the configured amount tolerance, never tighter than 0.01', async () => {
    const { services, accountId, add } = await setup();
    await add('2026-09-26', 25_010, 'Rounded');
    await add('2026-09-26', 25_200, 'Tip added');

    const payees = (toleranceBps: number) =>
      services.transactions
        .findSimilarTransactions({
          accountId,
          date: '2026-09-26',
          amountNative: -25_000,
          toleranceBps,
        })
        .map((m) => m.Payee)
        .sort();

    expect(payees(0)).toEqual(['Rounded']);
    expect(payees(100)).toEqual(['Rounded', 'Tip added']);
  });
});

describe('UserMetaService duplicate hint settings', () => {
  it('defaults to on, 1%, ±7 days and saves partial updates', async () => {
    const { services } = await setup();
    expect(services.userMeta.getDuplicateHintSettings()).toEqual({
      enabled: true,
      toleranceBps: 100,
      dayWindow: 7,
    });

    services.userMeta.setDuplicateHintSettings({ toleranceBps: 0, dayWindow: 3 });
    services.userMeta.setDuplicateHintSettings({ enabled: false });
    expect(services.userMeta.getDuplicateHintSettings()).toEqual({
      enabled: false,
      toleranceBps: 0,
      dayWindow: 3,
    });
  });

  it('upgrades an existing workspace to the defaults, keeping other preferences', async () => {
    const adapter = await NodeSqlJsAdapter.create();
    const sm = new ServiceManager();
    await sm.initialize(adapter as DatabaseAdapter);
    sm.getServices().userMeta.setWeekStartsOn(1);
    for (const column of [
      'DuplicateHintsEnabled',
      'DuplicateAmountToleranceBps',
      'DuplicateDayWindow',
    ]) {
      adapter.exec(`ALTER TABLE user_meta DROP COLUMN ${column}`);
    }
    adapter.exec('DELETE FROM schema_migrations WHERE version >= 65');
    const olderBackup = await adapter.backup();
    adapter.close();

    const upgraded = await NodeSqlJsAdapter.create(olderBackup);
    const upgradedManager = new ServiceManager();
    await upgradedManager.initialize(upgraded as DatabaseAdapter);
    const { userMeta } = upgradedManager.getServices();
    expect(userMeta.getDuplicateHintSettings()).toEqual({
      enabled: true,
      toleranceBps: 100,
      dayWindow: 7,
    });
    expect(userMeta.getWeekStartsOn()).toBe(1);
    upgraded.close();
  });

  it('rejects out-of-range values without saving', async () => {
    const { services } = await setup();
    expect(() => services.userMeta.setDuplicateHintSettings({ toleranceBps: 5_000 })).toThrow();
    expect(() => services.userMeta.setDuplicateHintSettings({ dayWindow: 0 })).toThrow();
    expect(() => services.userMeta.setDuplicateHintSettings({ toleranceBps: 1.5 })).toThrow();
    expect(services.userMeta.getDuplicateHintSettings().toleranceBps).toBe(100);
  });
});
