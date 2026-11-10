import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
// The harness runs the Node build of core; its clock is the one to set.
// eslint-disable-next-line no-restricted-imports
import { setClock } from '@budgero/core';
import {
  Device,
  diffDumps,
  formatDiffs,
  installFxStub,
  resetClock,
  rows,
  SPACE_ID,
} from '@shared/mutations/fuzz/harness';
import { useUndoStore } from '@shared/mutations/UndoStore';
import { DEMO_ACCOUNT_METADATA_KEY } from '@shared/lib/demo-space';
import { DEMO_MONTHS, planDemoBudget, seedDemoBudget } from './seed-demo-budget';

vi.mock('@shared/runtime/global', async (importOriginal) => {
  const { runtimeHolder } = await import('@shared/mutations/fuzz/runtime-holder');
  return {
    ...(await importOriginal<object>()),
    getRuntime: () => runtimeHolder.current?.runtime ?? null,
  };
});

const TODAY = new Date(2026, 10, 4, 12);
const TODAY_ISO = '2026-11-04';

function monthsBack(today: Date): string[] {
  const out: string[] = [];
  for (let offset = -(DEMO_MONTHS - 1); offset <= 0; offset += 1) {
    const d = new Date(today.getFullYear(), today.getMonth() + offset, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

async function seed(name: string, today = TODAY) {
  const device = await Device.open(name);
  const started = performance.now();
  const budgetId = await device.run(() =>
    seedDemoBudget(device.runtime, SPACE_ID, { currency: 'EUR', numberFormat: '1.096,56 $' }, today)
  );
  return { device, budgetId, ms: performance.now() - started };
}

beforeAll(() => {
  installFxStub();
  setClock(TODAY.getTime());
});
afterAll(() => {
  resetClock();
  vi.unstubAllGlobals();
});

describe('demo budget seed', () => {
  it('builds a year and a half of history with every coin assigned', async () => {
    const { device, budgetId, ms } = await seed('demo');
    const s = device.services;
    const months = monthsBack(TODAY);
    expect(s.budgets.getBudget(budgetId)?.DisplayCurrency).toBe('EUR');
    expect(s.budgets.getBudget(budgetId)?.NumberFormat).toBe('1.096,56 $');

    // Three accounts, each carrying the synced demo marker.
    const accounts = rows<{ ID: number; Name: string; Type: string; Metadata: string }>(
      device,
      'SELECT ID, Name, Type, Metadata FROM accounts ORDER BY ID'
    );
    expect(accounts).toHaveLength(3);
    for (const account of accounts) {
      expect(JSON.parse(account.Metadata)[DEMO_ACCOUNT_METADATA_KEY]).toBe(true);
    }

    // History: 18 months, 600-900 transactions, none after today.
    const [{ n: count }] = rows<{ n: number }>(device, 'SELECT COUNT(*) AS n FROM transactions');
    expect(count).toBeGreaterThanOrEqual(600);
    expect(count).toBeLessThanOrEqual(900);
    const active = rows<{ month: string }>(
      device,
      'SELECT DISTINCT substr(Date, 1, 7) AS month FROM transactions ORDER BY 1'
    ).map((row) => row.month);
    expect(active).toEqual(months);
    expect(
      rows<{ n: number }>(
        device,
        'SELECT COUNT(*) AS n FROM transactions WHERE Date > ?',
        TODAY_ISO
      )[0]?.n
    ).toBe(0);

    // Ready to Assign is exactly 0 in every month, and nothing is assigned below zero.
    for (const month of months) {
      expect(s.monthlyBudgets.getReadyToAssign(budgetId, month), month).toBe(0);
    }
    expect(s.monthlyBudgets.getReadyToAssign(budgetId)).toBe(0);
    const view = s.monthlyBudgets.getMonthlyBudget(months.at(-1)!, budgetId);
    for (const month of months) {
      for (const row of s.monthlyBudgets.getMonthlyBudget(month, budgetId)) {
        expect(row.Assigned, `${month} ${row.Category} assigned`).toBeGreaterThanOrEqual(0);
        // Overspending is always covered in the month it happens.
        expect(row.Available, `${month} ${row.Category} available`).toBeGreaterThanOrEqual(0);
      }
    }

    // The card: what is owed is fully covered by its payment category (no warning).
    const card = accounts.find((account) => account.Type === 'credit')!;
    const balance = (id: number) =>
      rows<{ b: number }>(
        device,
        'SELECT COALESCE(SUM(InflowConverted - OutflowConverted), 0) AS b FROM transactions WHERE AccountID = ?',
        id
      )[0]!.b;
    const owed = -balance(card.ID);
    expect(owed).toBeGreaterThan(0);
    const payment = view.find((row) => row.Category === card.Name)!;
    expect(payment.Available).toBe(owed);
    for (const account of accounts.filter((a) => a.Type !== 'credit')) {
      expect(balance(account.ID), account.Name).toBeGreaterThan(0);
    }

    // The variety the demo promises.
    const one = (sql: string) => rows<{ n: number }>(device, sql)[0]!.n;
    expect(
      one('SELECT COUNT(*) AS n FROM transactions WHERE TransferID IS NOT NULL')
    ).toBeGreaterThan(60);
    expect(
      one('SELECT COUNT(DISTINCT TransactionID) AS n FROM transaction_splits')
    ).toBeGreaterThanOrEqual(2);
    // Refunds: money coming back on the card that isn't a payment.
    expect(
      one(
        `SELECT COUNT(*) AS n FROM transactions WHERE InflowConverted > 0 AND TransferID IS NULL AND AccountID = ${
          card.ID
        }`
      )
    ).toBeGreaterThanOrEqual(2);
    expect(one('SELECT COUNT(*) AS n FROM goals')).toBe(3);
    const saved = view.filter((row) => ['Emergency fund', 'Vacation'].includes(row.Category));
    expect(saved).toHaveLength(2);
    for (const row of saved) expect(row.Available, row.Category).toBeGreaterThan(500_000);

    // Sample data can't be undone like the user's own changes.
    expect(useUndoStore.getState().past).toHaveLength(0);
    // Plain rows go in batches: the log holds a few dozen ops, not one per row.
    expect(device.outbox.length).toBeLessThan(100);
    // Older rows are cleared, the last few days' are not yet.
    expect(one('SELECT COUNT(*) AS n FROM transactions WHERE Cleared = 0')).toBeGreaterThan(0);
    expect(one('SELECT COUNT(*) AS n FROM transactions WHERE Cleared = 1')).toBeGreaterThan(
      count / 2
    );
    console.info(
      `[demo seed] ${months.length} months, ${count} transactions, ${device.outbox.length} ops, ${Math.round(ms)} ms`
    );
  }, 60_000);

  it('replays to the same data on another device', async () => {
    const { device } = await seed('demo-origin');
    const other = await Device.open('demo-replica');
    for (const message of device.outbox) await other.receive(message);
    const options = { sequences: true, crossDevice: true };
    const diffs = diffDumps(device.dump(options), other.dump(options));
    expect(diffs, formatDiffs(diffs)).toHaveLength(0);
  }, 60_000);

  it('is the same data for the same day', async () => {
    const a = await seed('demo-a');
    const b = await seed('demo-b');
    const options = { sequences: true, crossDevice: true };
    const diffs = diffDumps(a.device.dump(options), b.device.dump(options));
    expect(diffs, formatDiffs(diffs)).toHaveLength(0);
    expect(planDemoBudget(TODAY)).toEqual(planDemoBudget(new Date(2026, 10, 4, 23, 30)));
  }, 60_000);

  it('keeps past months stable as the days go by', () => {
    const earlier = planDemoBudget(new Date(2026, 10, 4));
    const later = planDemoBudget(new Date(2026, 10, 20));
    const before = (plan: typeof earlier) =>
      plan.transactions.filter((tx) => tx.date < '2026-11-01');
    expect(before(later)).toEqual(before(earlier));
    expect(later.transactions.length).toBeGreaterThan(earlier.transactions.length);
  });

  it('balances on any day of the year', async () => {
    for (const today of [
      new Date(2027, 0, 1, 12),
      new Date(2026, 6, 19, 12),
      new Date(2028, 1, 29, 12),
    ]) {
      setClock(today.getTime());
      const { device, budgetId } = await seed(`demo-${today.getTime()}`, today);
      for (const month of monthsBack(today)) {
        expect(device.services.monthlyBudgets.getReadyToAssign(budgetId, month), month).toBe(0);
        for (const row of device.services.monthlyBudgets.getMonthlyBudget(month, budgetId)) {
          expect(row.Assigned, `${month} ${row.Category}`).toBeGreaterThanOrEqual(0);
          expect(row.Available, `${month} ${row.Category}`).toBeGreaterThanOrEqual(0);
        }
      }
    }
    setClock(TODAY.getTime());
  }, 120_000);
});
