import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { Device, installFxStub, resetClock, SPACE_ID } from '@shared/mutations/fuzz/harness';
import { useUndoStore } from '@shared/mutations/UndoStore';
import { seedDemoBudget } from './seed-demo-budget';

vi.mock('@shared/runtime/global', async (importOriginal) => {
  const { runtimeHolder } = await import('@shared/mutations/fuzz/runtime-holder');
  return {
    ...(await importOriginal<object>()),
    getRuntime: () => runtimeHolder.current?.runtime ?? null,
  };
});

beforeAll(() => installFxStub());
afterAll(() => {
  resetClock();
  vi.unstubAllGlobals();
});

it('builds a demo budget with every coin assigned, through the normal ops', async () => {
  const device = await Device.open('demo');
  const today = new Date(2026, 10, 4);
  const budgetId = await device.run(() => seedDemoBudget(device.runtime, SPACE_ID, 'EUR', today));
  const s = device.services;
  expect(s.budgets.getBudget(budgetId)?.DisplayCurrency).toBe('EUR');
  expect(s.accounts.listAccounts(budgetId)).toHaveLength(3);
  for (const month of ['2026-10', '2026-11']) {
    expect(s.monthlyBudgets.getReadyToAssign(budgetId, month)).toBe(0);
  }
  // No transaction lands after "today".
  const late = device.adapter.exec(
    "SELECT COUNT(*) FROM transactions WHERE Date > '2026-11-04'"
  ) as { values: unknown[][] }[];
  expect(late[0]?.values[0]?.[0]).toBe(0);
  // Sample data can't be undone like the user's own changes.
  expect(useUndoStore.getState().past).toHaveLength(0);
}, 60_000);
