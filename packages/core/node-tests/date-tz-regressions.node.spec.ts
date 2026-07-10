/**
 * Timezone regression tests for the date-only-string bug class.
 *
 * JavaScript parses date-only strings ("YYYY-MM-DD") as UTC midnight, so any
 * local-time read of such a Date shifts the calendar day for users away from
 * UTC. These tests pin the invariants that broke: run them under several
 * timezones via `pnpm run test:tz` at the repo root.
 */
import { describe, it, expect } from 'vitest';
import { NodeSqlJsAdapter, ServiceManager, DatabaseAdapter } from '../src';
import { getLocalDateString, getUTCDateString, parseDateOnlyLocal } from '../src/utils/date';

describe('utils/date timezone invariants', () => {
  it('getUTCDateString round-trips a UTC-anchored date in any timezone', () => {
    const utcAnchored = new Date('2026-06-01T00:00:00Z');
    expect(getUTCDateString(utcAnchored)).toBe('2026-06-01');
  });

  it('parseDateOnlyLocal anchors date-only strings to local midnight', () => {
    const d = parseDateOnlyLocal('2026-06-01');
    expect(d).not.toBeNull();
    expect(d!.getFullYear()).toBe(2026);
    expect(d!.getMonth()).toBe(5);
    expect(d!.getDate()).toBe(1);
    expect(d!.getHours()).toBe(0);
  });

  it('parseDateOnlyLocal + getLocalDateString round-trips in any timezone', () => {
    for (const key of ['2026-01-01', '2026-06-30', '2026-12-31']) {
      expect(getLocalDateString(parseDateOnlyLocal(key)!)).toBe(key);
    }
  });

  it('parseDateOnlyLocal falls through to Date parsing for timestamps', () => {
    const d = parseDateOnlyLocal('2026-06-01T12:00:00Z');
    expect(d).not.toBeNull();
    expect(d!.getTime()).toBe(Date.parse('2026-06-01T12:00:00Z'));
  });

  it('parseDateOnlyLocal returns null for garbage', () => {
    expect(parseDateOnlyLocal('not-a-date')).toBeNull();
    expect(parseDateOnlyLocal('')).toBeNull();
  });
});

describe('recurring schedule date stability (compounding-drift regression)', () => {
  async function setup() {
    const adapter = await NodeSqlJsAdapter.create();
    const sm = new ServiceManager();
    await sm.initialize(adapter as DatabaseAdapter);
    const services = sm.getServices();

    const budgetId = await services.budgets.createBudget({
      name: 'TZ Regression',
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

    const groupId = services.categories.addCategoryGroup('Bills', budgetId);
    const categoryId = services.categories.addCategory(groupId, budgetId, 'Rent');

    return { services, budgetId, account, categoryId };
  }

  it('startDate survives create → read → update cycles unchanged', async () => {
    const { services, budgetId, account, categoryId } = await setup();

    const startDate = '2026-01-15';
    const created = await services.recurring.createRecurringTransaction({
      budgetId,
      accountId: account.ID,
      categoryId,
      name: 'Rent',
      amount: 1000,
      direction: 'outflow',
      schedule: { startDate, intervalUnit: 'month', intervalCount: 1 },
    });

    expect(created.schedule.startDate).toBe(startDate);

    // Each update re-normalizes the schedule; before the fix every cycle
    // shifted the date back one day for UTC-negative timezones.
    let template = created;
    for (let i = 0; i < 3; i += 1) {
      template = await services.recurring.updateRecurringTransaction(template.id, {
        schedule: template.schedule,
      });
      expect(template.schedule.startDate).toBe(startDate);
    }

    const reread = services.recurring.getRecurringTransaction(template.id);
    expect(reread.schedule.startDate).toBe(startDate);
  });

  it('generated occurrences fall on the scheduled day-of-month', async () => {
    const { services, budgetId, account, categoryId } = await setup();

    const created = await services.recurring.createRecurringTransaction({
      budgetId,
      accountId: account.ID,
      categoryId,
      name: 'Internet',
      amount: 50,
      direction: 'outflow',
      schedule: { startDate: '2026-01-15', intervalUnit: 'month', intervalCount: 1 },
    });

    const occurrences = services.recurring
      .listOccurrences(budgetId)
      .filter((o) => o.recurringTransactionId === created.id);
    expect(occurrences.length).toBeGreaterThan(0);
    for (const occurrence of occurrences) {
      expect(occurrence.dueDate.slice(8, 10)).toBe('15');
    }
  });
});
