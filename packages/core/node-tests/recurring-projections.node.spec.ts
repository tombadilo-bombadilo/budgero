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

  return { services, budgetId, account, categoryId };
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
