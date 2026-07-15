import { describe, it, expect } from 'vitest';
import { NodeSqlJsAdapter, ServiceManager, DatabaseAdapter } from '../src';

function isoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
}

async function setup() {
  const adapter = await NodeSqlJsAdapter.create();
  const sm = new ServiceManager();
  await sm.initialize(adapter as DatabaseAdapter);
  const services = sm.getServices();

  const budgetId = await services.budgets.createBudget({
    name: 'Projections',
    display_currency: 'USD',
    badge_icon: 'dollar',
    number_format: '123,456.78',
    create_default_categories: true,
  });

  const account = await services.accounts.createAccount(
    'Checking',
    budgetId,
    'checking',
    'USD',
    0,
    {},
    true
  );

  const groupId = services.categories.addCategoryGroup('Bills Group', budgetId);
  const categoryId = services.categories.addCategory(groupId, budgetId, 'Utilities');

  return { adapter, services, budgetId, account, categoryId };
}

describe('RecurringTransactionService.listProjectedTransactions', () => {
  it('projects scheduled occurrences as transaction-like rows', async () => {
    const { services, budgetId, account, categoryId } = await setup();
    const today = new Date();

    await services.recurring.createRecurringTransaction({
      budgetId,
      accountId: account.ID,
      categoryId,
      name: 'Electricity',
      amount: 100,
      direction: 'outflow',
      schedule: { startDate: isoDate(today), intervalUnit: 'month', intervalCount: 1 },
    });

    const projected = services.recurring.listProjectedTransactions(budgetId, {
      toDate: isoDate(addMonths(today, 3)),
    });

    expect(projected.length).toBeGreaterThanOrEqual(3);
    for (const row of projected) {
      expect(row.IsProjected).toBe(true);
      expect(row.ID).toBeLessThan(0);
      expect(row.Outflow).toBe(100);
      expect(row.Inflow).toBe(0);
      expect(row.OutflowOriginal).toBe(100);
      expect(row.AccountID).toBe(account.ID);
      expect(row.Account).toBe('Checking');
      expect(row.Category).toBe('Utilities');
      expect(row.Payee).toBe('Electricity');
    }

    // accountId filter excludes other accounts
    const filtered = services.recurring.listProjectedTransactions(budgetId, {
      accountId: account.ID + 999,
    });
    expect(filtered).toHaveLength(0);

    // date window filter
    const nextMonth = isoDate(addMonths(today, 1));
    const windowed = services.recurring.listProjectedTransactions(budgetId, {
      fromDate: nextMonth,
      toDate: nextMonth,
    });
    for (const row of windowed) {
      expect(row.Date).toBe(nextMonth);
    }
  });

  it('excludes skipped and ready occurrences from projections', async () => {
    const { services, budgetId, account, categoryId } = await setup();
    const today = new Date();

    await services.recurring.createRecurringTransaction({
      budgetId,
      accountId: account.ID,
      categoryId,
      name: 'Rent',
      amount: 500,
      direction: 'outflow',
      schedule: { startDate: isoDate(today), intervalUnit: 'month', intervalCount: 1 },
    });

    const occurrences = services.recurring.listOccurrences(budgetId, { status: 'scheduled' });
    expect(occurrences.length).toBeGreaterThanOrEqual(2);

    await services.recurring.skipOccurrence(occurrences[0].id);
    await services.recurring.markOccurrenceReady({ occurrenceId: occurrences[1].id });

    const projected = services.recurring.listProjectedTransactions(budgetId, {});
    const projectedOccurrenceIds = new Set(projected.map((row) => row.OccurrenceID));
    expect(projectedOccurrenceIds.has(occurrences[0].id)).toBe(false);
    expect(projectedOccurrenceIds.has(occurrences[1].id)).toBe(false);
  });

  it('materializes occurrences past the default horizon when toDate requires it', async () => {
    const { services, budgetId, account, categoryId } = await setup();
    const today = new Date();

    await services.recurring.createRecurringTransaction({
      budgetId,
      accountId: account.ID,
      categoryId,
      name: 'Insurance',
      amount: 50,
      direction: 'outflow',
      schedule: { startDate: isoDate(today), intervalUnit: 'month', intervalCount: 1 },
    });

    const farOut = isoDate(addMonths(today, 12));
    const projected = services.recurring.listProjectedTransactions(budgetId, { toDate: farOut });

    const beyondDefaultHorizon = isoDate(addMonths(today, 8));
    expect(projected.some((row) => row.Date >= beyondDefaultHorizon)).toBe(true);
  });

  it('deleting a template removes unposted occurrences but keeps posted transactions', async () => {
    const { services, budgetId, account, categoryId } = await setup();
    const today = new Date();

    const template = await services.recurring.createRecurringTransaction({
      budgetId,
      accountId: account.ID,
      categoryId,
      name: 'Gym',
      amount: 30,
      direction: 'outflow',
      schedule: { startDate: isoDate(today), intervalUnit: 'month', intervalCount: 1 },
    });

    const occurrences = services.recurring.listOccurrences(budgetId, { status: 'scheduled' });
    const ready = await services.recurring.markOccurrenceReady({
      occurrenceId: occurrences[0].id,
    });

    await services.recurring.deleteRecurringTransaction(template.id);

    // All occurrences are gone (cascade), so nothing is projected anymore
    expect(services.recurring.listProjectedTransactions(budgetId, {})).toHaveLength(0);
    expect(services.recurring.listOccurrences(budgetId, {})).toHaveLength(0);

    // The posted transaction survives
    const transactions = services.transactions.getTransactionsByAccount(account.ID);
    expect(transactions.some((tx) => tx.ID === ready.transactionId)).toBe(true);
  });
});

describe('Recurring transfers', () => {
  async function setupWithSavings() {
    const base = await setup();
    const savings = await base.services.accounts.createAccount(
      'Savings',
      base.budgetId,
      'savings',
      'USD',
      0,
      {},
      true
    );
    return { ...base, savings };
  }

  it('normalizes transfer templates to outflow + Transfers category', async () => {
    const { services, budgetId, account, categoryId, savings } = await setupWithSavings();
    const today = new Date();

    // direction and category are pinned no matter what the caller passes
    const template = await services.recurring.createRecurringTransaction({
      budgetId,
      accountId: account.ID,
      toAccountId: savings.ID,
      categoryId,
      name: 'Monthly savings',
      amount: 200,
      direction: 'inflow',
      schedule: { startDate: isoDate(today), intervalUnit: 'month', intervalCount: 1 },
    });

    expect(template.toAccountId).toBe(savings.ID);
    expect(template.direction).toBe('outflow');
    const transfersCategory = services.categories.getCategoryByName('Transfers', budgetId);
    expect(template.categoryId).toBe(transfersCategory?.ID);

    await expect(
      services.recurring.createRecurringTransaction({
        budgetId,
        accountId: account.ID,
        toAccountId: account.ID,
        name: 'Self transfer',
        amount: 10,
        direction: 'outflow',
        schedule: { startDate: isoDate(today), intervalUnit: 'month', intervalCount: 1 },
      })
    ).rejects.toThrow(/destination/i);
  });

  it('updating a template into and out of a transfer re-normalizes it', async () => {
    const { services, budgetId, account, categoryId, savings } = await setupWithSavings();
    const today = new Date();

    const template = await services.recurring.createRecurringTransaction({
      budgetId,
      accountId: account.ID,
      categoryId,
      name: 'Bill',
      amount: 50,
      direction: 'outflow',
      schedule: { startDate: isoDate(today), intervalUnit: 'month', intervalCount: 1 },
    });

    const asTransfer = await services.recurring.updateRecurringTransaction(template.id, {
      toAccountId: savings.ID,
    });
    const transfersCategory = services.categories.getCategoryByName('Transfers', budgetId);
    expect(asTransfer.toAccountId).toBe(savings.ID);
    expect(asTransfer.categoryId).toBe(transfersCategory?.ID);

    const backToBill = await services.recurring.updateRecurringTransaction(template.id, {
      toAccountId: null,
      categoryId,
      direction: 'outflow',
    });
    expect(backToBill.toAccountId).toBeNull();
    expect(backToBill.categoryId).toBe(categoryId);
  });

  it('marks a transfer occurrence ready by posting two linked legs', async () => {
    const { services, budgetId, account, savings } = await setupWithSavings();
    const today = new Date();

    await services.recurring.createRecurringTransaction({
      budgetId,
      accountId: account.ID,
      toAccountId: savings.ID,
      name: 'Monthly savings',
      amount: 200,
      direction: 'outflow',
      schedule: { startDate: isoDate(today), intervalUnit: 'month', intervalCount: 1 },
    });

    const occurrences = services.recurring.listOccurrences(budgetId, { status: 'scheduled' });
    const result = await services.recurring.markOccurrenceReady({
      occurrenceId: occurrences[0].id,
    });

    const sourceRows = services.transactions.getTransactionsByAccount(account.ID);
    const sourceLeg = sourceRows.find((tx) => tx.ID === result.transactionId);
    expect(sourceLeg).toBeDefined();
    expect(sourceLeg?.Outflow).toBe(200);
    expect(sourceLeg?.Inflow).toBe(0);
    expect(sourceLeg?.TransferID).toBeTruthy();
    expect(sourceLeg?.Payee).toBe('Savings');
    expect(sourceLeg?.Category).toBe('Transfers');

    const destRows = services.transactions.getTransactionsByAccount(savings.ID);
    const destLeg = destRows.find((tx) => tx.TransferID === sourceLeg?.TransferID);
    expect(destLeg).toBeDefined();
    expect(destLeg?.Inflow).toBe(200);
    expect(destLeg?.Outflow).toBe(0);
    expect(destLeg?.Payee).toBe('Checking');

    const occurrence = services.recurring.getOccurrenceWithTemplate(occurrences[0].id);
    expect(occurrence.status).toBe('ready');
    expect(occurrence.transactionId).toBe(result.transactionId);
  });

  it('projects both legs of a recurring transfer', async () => {
    const { services, budgetId, account, savings } = await setupWithSavings();
    const today = new Date();

    await services.recurring.createRecurringTransaction({
      budgetId,
      accountId: account.ID,
      toAccountId: savings.ID,
      name: 'Monthly savings',
      amount: 200,
      direction: 'outflow',
      schedule: { startDate: isoDate(today), intervalUnit: 'month', intervalCount: 1 },
    });

    const sourceProjected = services.recurring.listProjectedTransactions(budgetId, {
      accountId: account.ID,
    });
    expect(sourceProjected.length).toBeGreaterThan(0);
    for (const row of sourceProjected) {
      expect(row.Outflow).toBe(200);
      expect(row.Inflow).toBe(0);
      expect(row.AccountID).toBe(account.ID);
    }

    const destProjected = services.recurring.listProjectedTransactions(budgetId, {
      accountId: savings.ID,
    });
    expect(destProjected.length).toBe(sourceProjected.length);
    for (const row of destProjected) {
      expect(row.Inflow).toBe(200);
      expect(row.Outflow).toBe(0);
      expect(row.AccountID).toBe(savings.ID);
      expect(row.Account).toBe('Savings');
    }

    // Both legs of the same occurrence carry distinct synthetic IDs
    const all = services.recurring.listProjectedTransactions(budgetId, {});
    const ids = all.map((row) => row.ID);
    expect(new Set(ids).size).toBe(ids.length);
    expect(all.length).toBe(sourceProjected.length + destProjected.length);
  });

  it('rolls back the source leg when the destination leg fails to post', async () => {
    const { services, budgetId, account, savings } = await setupWithSavings();
    const today = new Date();

    await services.recurring.createRecurringTransaction({
      budgetId,
      accountId: account.ID,
      toAccountId: savings.ID,
      name: 'Monthly savings',
      amount: 200,
      direction: 'outflow',
      schedule: { startDate: isoDate(today), intervalUnit: 'month', intervalCount: 1 },
    });
    const occurrence = services.recurring.listOccurrences(budgetId, { status: 'scheduled' })[0];

    // Make the destination (second) addTransaction call blow up.
    const txService = (
      services.recurring as unknown as {
        transactions: { addTransaction: (...args: unknown[]) => Promise<number> };
      }
    ).transactions;
    const originalAdd = txService.addTransaction.bind(txService);
    let calls = 0;
    txService.addTransaction = async (...args: unknown[]) => {
      calls += 1;
      if (calls === 2) throw new Error('destination leg boom');
      return originalAdd(...args);
    };

    await expect(
      services.recurring.markOccurrenceReady({ occurrenceId: occurrence.id })
    ).rejects.toThrow('destination leg boom');
    txService.addTransaction = originalAdd;

    // No one-sided transfer left behind, occurrence still scheduled
    expect(services.transactions.getTransactionsByAccount(account.ID)).toHaveLength(0);
    expect(services.transactions.getTransactionsByAccount(savings.ID)).toHaveLength(0);
    expect(services.recurring.getOccurrenceWithTemplate(occurrence.id).status).toBe('scheduled');

    // Retry succeeds and posts both legs
    const result = await services.recurring.markOccurrenceReady({ occurrenceId: occurrence.id });
    expect(result.transactionId).toBeGreaterThan(0);
    expect(services.transactions.getTransactionsByAccount(account.ID)).toHaveLength(1);
    expect(services.transactions.getTransactionsByAccount(savings.ID)).toHaveLength(1);
  });

  it('lists transfer occurrences for both the source and destination account', async () => {
    const { services, budgetId, account, savings } = await setupWithSavings();
    const today = new Date();

    await services.recurring.createRecurringTransaction({
      budgetId,
      accountId: account.ID,
      toAccountId: savings.ID,
      name: 'Monthly savings',
      amount: 200,
      direction: 'outflow',
      schedule: { startDate: isoDate(today), intervalUnit: 'month', intervalCount: 1 },
    });

    const fromSource = services.recurring.listOccurrences(budgetId, {
      accountId: account.ID,
    });
    const fromDestination = services.recurring.listOccurrences(budgetId, {
      accountId: savings.ID,
    });
    expect(fromSource.length).toBeGreaterThan(0);
    expect(fromDestination.length).toBe(fromSource.length);
    expect(fromDestination[0].template.toAccountId).toBe(savings.ID);

    // Unrelated accounts still see nothing
    const unrelated = services.recurring.listOccurrences(budgetId, {
      accountId: savings.ID + 999,
    });
    expect(unrelated).toHaveLength(0);
  });

  it('converts the destination amount at the latest known rate for cross-currency transfers', async () => {
    const { adapter, services, budgetId, account } = await setupWithSavings();
    const today = new Date();

    const eurSavings = await services.accounts.createAccount(
      'EUR Savings',
      budgetId,
      'savings',
      'EUR',
      0,
      {},
      true
    );

    // Two months of rates — the newest one must win.
    const insertRate = adapter.prepare(
      `INSERT INTO currency_rates (FromCurrency, ToCurrency, Rate, Month, LastUpdated, BudgetID)
       VALUES (?, ?, ?, ?, datetime('now'), ?)`
    );
    insertRate.run('USD', 'EUR', 0.8, '2020-01', budgetId);
    insertRate.run('USD', 'EUR', 0.5, '2020-02', budgetId);
    insertRate.finalize();

    await services.recurring.createRecurringTransaction({
      budgetId,
      accountId: account.ID,
      toAccountId: eurSavings.ID,
      name: 'EUR stash',
      amount: 200,
      direction: 'outflow',
      schedule: { startDate: isoDate(today), intervalUnit: 'month', intervalCount: 1 },
    });

    const occurrences = services.recurring.listOccurrences(budgetId, {
      accountId: eurSavings.ID,
    });
    expect(occurrences.length).toBeGreaterThan(0);
    for (const occurrence of occurrences) {
      expect(occurrence.template.amount).toBe(200);
      expect(occurrence.template.destinationAmount).toBe(100);
    }

    // The projected inflow leg carries the same converted original amount
    const destProjected = services.recurring.listProjectedTransactions(budgetId, {
      accountId: eurSavings.ID,
    });
    expect(destProjected.length).toBeGreaterThan(0);
    for (const row of destProjected) {
      expect(row.InflowOriginal).toBe(100);
    }

    // Same-currency transfers report the untouched amount
    const {
      services: sameCurrency,
      budgetId: scBudget,
      account: scAccount,
      savings,
    } = await setupWithSavings();
    await sameCurrency.recurring.createRecurringTransaction({
      budgetId: scBudget,
      accountId: scAccount.ID,
      toAccountId: savings.ID,
      name: 'Savings',
      amount: 200,
      direction: 'outflow',
      schedule: { startDate: isoDate(today), intervalUnit: 'month', intervalCount: 1 },
    });
    const scOccurrences = sameCurrency.recurring.listOccurrences(scBudget, {
      accountId: savings.ID,
    });
    expect(scOccurrences[0].template.destinationAmount).toBe(200);
  });

  it('keeps projected transfers out of analytics spending', async () => {
    const { services, budgetId, account, savings } = await setupWithSavings();
    const today = new Date();
    const startDate = isoDate(today);
    const endDate = isoDate(addMonths(today, 2));

    await services.recurring.createRecurringTransaction({
      budgetId,
      accountId: account.ID,
      toAccountId: savings.ID,
      name: 'Monthly savings',
      amount: 200,
      direction: 'outflow',
      schedule: {
        startDate: isoDate(addMonths(today, 1)),
        intervalUnit: 'month',
        intervalCount: 1,
      },
    });
    services.recurring.ensureOccurrencesThrough(budgetId, endDate);

    const withProjections = services.analytics.getPeriodSummary(startDate, endDate, budgetId, {
      includeProjections: true,
    });
    expect(withProjections.TotalSpending).toBe(0);
  });
});

describe('Analytics projections', () => {
  it('includes scheduled occurrences in spending when includeProjections is set', async () => {
    const { services, budgetId, account, categoryId } = await setup();
    const today = new Date();
    const startDate = isoDate(today);
    const endDate = isoDate(addMonths(today, 2));

    await services.transactions.addTransaction(
      0,
      40,
      account.ID,
      categoryId,
      budgetId,
      startDate,
      'real spend'
    );

    await services.recurring.createRecurringTransaction({
      budgetId,
      accountId: account.ID,
      categoryId,
      name: 'Streaming',
      amount: 15,
      direction: 'outflow',
      schedule: {
        startDate: isoDate(addMonths(today, 1)),
        intervalUnit: 'month',
        intervalCount: 1,
      },
    });
    services.recurring.ensureOccurrencesThrough(budgetId, endDate);

    const withoutProjections = services.analytics.getPeriodSummary(startDate, endDate, budgetId);
    expect(withoutProjections.TotalSpending).toBe(40);

    const withProjections = services.analytics.getPeriodSummary(startDate, endDate, budgetId, {
      includeProjections: true,
    });
    expect(withProjections.TotalSpending).toBeGreaterThan(40);
    expect(withProjections.TotalSpending % 15).toBeCloseTo(40 % 15, 5);

    // Per-day series also reflects projected spend on the due date
    const byDates = services.analytics.getSpendingByDates(startDate, endDate, budgetId, {
      includeProjections: true,
    });
    const dueDate = isoDate(addMonths(today, 1));
    const dueRow = byDates.find((row) => row.Date === dueDate);
    expect(dueRow?.Spending).toBe(15);

    // Payee rollup attributes projections to the template name
    const byPayees = services.analytics.getSpendingByPayees(startDate, endDate, budgetId, {
      includeProjections: true,
    });
    expect(byPayees.some((row) => row.Payee === 'Streaming' && row.Spending > 0)).toBe(true);
  });
});
