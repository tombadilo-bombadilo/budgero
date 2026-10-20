import { afterEach, describe, expect, it } from 'vitest';
import { NodeSqlJsAdapter, ServiceManager, setClock } from '../src';

afterEach(() => setClock(null));

async function setup() {
  const adapter = await NodeSqlJsAdapter.create();
  const manager = new ServiceManager();
  await manager.initialize(adapter);
  const services = manager.getServices();
  const budgetId = await services.budgets.createBudget({
    name: 'Biennial',
    display_currency: 'USD',
    badge_icon: 'dollar',
    number_format: '123,456.78',
    create_default_categories: true,
  });
  const account = await services.accounts.createAccount('Checking', budgetId, 'checking', 'USD', 0);
  const groupId = services.categories.addCategoryGroup('Bills', budgetId);
  const categoryId = services.categories.addCategory(groupId, budgetId, 'Licence');
  return { adapter, services, budgetId, accountId: account.ID, categoryId };
}

const dueDates = (adapter: NodeSqlJsAdapter) =>
  (
    adapter
      .prepare('SELECT DueDate FROM recurring_transaction_occurrences ORDER BY DueDate')
      .all() as { DueDate: string }[]
  ).map((row) => row.DueDate);

describe('recurring series whose first due date is past the horizon', () => {
  it('keeps its first due date, so later passes do not depend on the device clock', async () => {
    const c = await setup();
    setClock(Date.UTC(2026, 9, 16, 12)); // threshold 2026-09-16, horizon end of April 2027
    await c.services.recurring.createRecurringTransaction({
      budgetId: c.budgetId,
      accountId: c.accountId,
      categoryId: c.categoryId,
      name: 'Licence',
      amount: 50,
      direction: 'outflow',
      schedule: { startDate: '2024-09-01', intervalUnit: 'year', intervalCount: 2 },
    });
    // 2026-09-01 is before the backfill threshold, the next one is past the horizon.
    expect(dueDates(c.adapter)).toEqual(['2028-09-01']);

    // A device whose "today" is earlier (threshold 2026-09-01) reads the series.
    setClock(Date.UTC(2026, 9, 1, 0));
    c.services.recurring.ensureOccurrencesThrough(c.budgetId, '2030-12-31');
    expect(dueDates(c.adapter)).toEqual(['2028-09-01', '2030-09-01']);
  });
});
