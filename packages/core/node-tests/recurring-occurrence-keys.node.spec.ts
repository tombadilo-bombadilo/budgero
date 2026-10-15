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

/** One device's database, built by the same synced ops in the same order. */
async function device() {
  const adapter = await NodeSqlJsAdapter.create();
  const sm = new ServiceManager();
  await sm.initialize(adapter as DatabaseAdapter);
  const services = sm.getServices();

  const budgetId = await services.budgets.createBudget({
    name: 'Bills',
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

type Device = Awaited<ReturnType<typeof device>>;

const startDate = isoDate(new Date());

function createRent(d: Device) {
  return d.services.recurring.createRecurringTransaction({
    budgetId: d.budgetId,
    accountId: d.account.ID,
    categoryId: d.categoryId,
    name: 'Rent',
    amount: 1_000_000,
    direction: 'outflow',
    schedule: { startDate, intervalUnit: 'month', intervalCount: 1 },
  });
}

function createGym(d: Device) {
  return d.services.recurring.createRecurringTransaction({
    budgetId: d.budgetId,
    accountId: d.account.ID,
    categoryId: d.categoryId,
    name: 'Gym',
    amount: 40_000,
    direction: 'outflow',
    schedule: { startDate, intervalUnit: 'month', intervalCount: 1 },
  });
}

/**
 * Two devices that applied the same create ops and opened the same far-future
 * report, at different moments, so they hold the same occurrences under
 * different local IDs.
 */
async function divergedDevices() {
  const a = await device();
  const b = await device();

  const rentA = await createRent(a);
  a.services.recurring.ensureOccurrencesThrough(a.budgetId, isoDate(addMonths(new Date(), 24)));
  const gymA = await createGym(a);

  const rentB = await createRent(b);
  const gymB = await createGym(b);
  b.services.recurring.ensureOccurrencesThrough(b.budgetId, isoDate(addMonths(new Date(), 24)));

  // Template IDs come from the synced create ops, so they agree.
  expect(rentB.id).toBe(rentA.id);
  expect(gymB.id).toBe(gymA.id);

  const gymOnA = a.services.recurring
    .listOccurrences(a.budgetId, { status: 'scheduled' })
    .find((o) => o.recurringTransactionId === gymA.id)!;

  // The bug: on B, A's occurrence ID points at a different bill or date.
  const sameIdOnB = b.services.recurring.getOccurrenceWithTemplate(gymOnA.id);
  expect(
    sameIdOnB.recurringTransactionId !== gymOnA.recurringTransactionId ||
      sameIdOnB.dueDate !== gymOnA.dueDate
  ).toBe(true);

  return { a, b, gymOnA };
}

function transactionsOn(d: Device) {
  return d.services.transactions.getTransactionsByAccount(d.account.ID);
}

describe('recurring occurrences addressed by template and due date', () => {
  it('markReady posts the same bill and date on both devices', async () => {
    const { a, b, gymOnA } = await divergedDevices();
    const options = {
      occurrenceId: gymOnA.id,
      recurringTransactionId: gymOnA.recurringTransactionId,
      dueDate: gymOnA.dueDate,
    };

    const onA = await a.services.recurring.markOccurrenceReady(options);
    const onB = await b.services.recurring.markOccurrenceReady(options);

    for (const result of [onA, onB]) {
      expect(result.occurrence.template.name).toBe('Gym');
      expect(result.occurrence.dueDate).toBe(gymOnA.dueDate);
      expect(result.occurrence.status).toBe('ready');
    }
    for (const d of [a, b]) {
      const posted = transactionsOn(d);
      expect(posted).toHaveLength(1);
      expect(posted[0].OutflowNative).toBe(40_000);
      expect(posted[0].Date).toBe(gymOnA.dueDate);
    }
  });

  it('skip and reset hit the same occurrence on both devices', async () => {
    const { a, b, gymOnA } = await divergedDevices();
    const ref = {
      occurrenceId: gymOnA.id,
      recurringTransactionId: gymOnA.recurringTransactionId,
      dueDate: gymOnA.dueDate,
    };

    for (const d of [a, b]) {
      const skipped = await d.services.recurring.skipOccurrence(ref);
      expect(skipped.template.name).toBe('Gym');
      expect(skipped.dueDate).toBe(gymOnA.dueDate);
      expect(skipped.status).toBe('skipped');

      const reset = d.services.recurring.resetOccurrence(ref);
      expect(reset.id).toBe(skipped.id);
      expect(reset.status).toBe('scheduled');

      const notified = await d.services.recurring.markOccurrenceNotified(ref);
      expect(notified.id).toBe(skipped.id);
      expect(notified.notifiedAt).toBeTruthy();
    }
  });

  it('materializes a keyed occurrence the device has not generated yet, without gaps', async () => {
    const a = await device();
    const b = await device();
    await createRent(a);
    const rent = await createRent(b);

    const farDate = isoDate(addMonths(new Date(), 18));
    a.services.recurring.ensureOccurrencesThrough(a.budgetId, farDate);
    const target = a.services.recurring
      .listOccurrences(a.budgetId, { status: 'scheduled', fromDate: farDate })
      .find((o) => o.recurringTransactionId === rent.id)!;
    expect(target).toBeDefined();

    const skipped = await b.services.recurring.skipOccurrence({
      recurringTransactionId: target.recurringTransactionId,
      dueDate: target.dueDate,
    });
    expect(skipped.dueDate).toBe(target.dueDate);
    expect(skipped.status).toBe('skipped');

    const datesOn = (d: Device) =>
      d.services.recurring
        .listOccurrences(d.budgetId, { toDate: target.dueDate })
        .map((o) => o.dueDate);
    expect(datesOn(b)).toEqual(datesOn(a));
  });

  it('still accepts old ops that only carry the local occurrence ID', async () => {
    const d = await device();
    await createRent(d);
    const [first, second] = d.services.recurring.listOccurrences(d.budgetId, {
      status: 'scheduled',
    });

    const ready = await d.services.recurring.markOccurrenceReady({ occurrenceId: first.id });
    expect(ready.occurrence.id).toBe(first.id);
    expect(ready.occurrence.status).toBe('ready');

    const skipped = await d.services.recurring.skipOccurrence(second.id);
    expect(skipped.id).toBe(second.id);
    expect(d.services.recurring.resetOccurrence({ occurrenceId: second.id }).status).toBe(
      'scheduled'
    );
  });
});

describe('markOccurrenceReady atomicity', () => {
  it('posts once when the same occurrence is marked ready twice at the same time', async () => {
    const d = await device();
    await createRent(d);
    const [occurrence] = d.services.recurring.listOccurrences(d.budgetId, { status: 'scheduled' });

    const results = await Promise.allSettled([
      d.services.recurring.markOccurrenceReady({ occurrenceId: occurrence.id }),
      d.services.recurring.markOccurrenceReady({ occurrenceId: occurrence.id }),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(transactionsOn(d)).toHaveLength(1);
    expect(d.services.recurring.getOccurrenceWithTemplate(occurrence.id).status).toBe('ready');
  });

  it('takes the posting back when the status update fails, so a retry posts once', async () => {
    const d = await device();
    await createRent(d);
    const [occurrence] = d.services.recurring.listOccurrences(d.budgetId, { status: 'scheduled' });

    const prepare = d.adapter.prepare.bind(d.adapter);
    d.adapter.prepare = (sql: string) => {
      if (/SET LastOccurrenceDate = \?, UpdatedAt = datetime\('now'\)/.test(sql)) {
        throw new Error('template update boom');
      }
      return prepare(sql);
    };
    await expect(
      d.services.recurring.markOccurrenceReady({ occurrenceId: occurrence.id })
    ).rejects.toThrow('template update boom');
    d.adapter.prepare = prepare;

    expect(transactionsOn(d)).toHaveLength(0);
    expect(d.services.recurring.getOccurrenceWithTemplate(occurrence.id).status).toBe('scheduled');

    const retry = await d.services.recurring.markOccurrenceReady({ occurrenceId: occurrence.id });
    expect(retry.occurrence.status).toBe('ready');
    expect(transactionsOn(d)).toHaveLength(1);
  });
});
