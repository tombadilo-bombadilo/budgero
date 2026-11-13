import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { Device, installFxStub, resetClock } from '@shared/mutations/fuzz/harness';

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

it('a split with transfer lines puts the money in the other accounts (#126)', async () => {
  const device = await Device.open('split-transfers');
  const budgetId = await device.run(async () =>
    device.services.budgets.createBudget({
      name: 'B',
      space_id: 'space-fuzz',
      display_currency: 'USD',
      badge_icon: 'x',
      number_format: '123,456.78',
      create_default_categories: false,
    })
  );
  const account = async (name: string) =>
    (
      await device.local<{ ID: number }>('accounts.create', {
        name,
        budgetId,
        type: 'checking',
        currency: 'USD',
        balance: 100_000,
        onBudget: true,
      })
    ).ID;
  const a = await account('Account_A');
  const b = await account('Account_B');
  const c = await account('Account_C');

  // The add form's payload after picking "Transfer : Account_B/C" on the lines.
  await device.local('transactions.add', {
    budgetId,
    accountId: a,
    categoryId: null,
    date: '2026-11-05',
    memo: '',
    payee: 'Split',
    inflow: 0,
    outflow: 22_000,
    splits: [
      { categoryId: null, transferAccountId: b, inflow: 0, outflow: 10_000 },
      { categoryId: null, transferAccountId: c, inflow: 0, outflow: 12_000 },
    ],
  });

  const balance = (id: number) =>
    (
      device.adapter.exec(
        `SELECT COALESCE(SUM(InflowConverted - OutflowConverted), 0) FROM transactions WHERE AccountID = ${id}`
      ) as { values: unknown[][] }[]
    )[0]?.values[0]?.[0];
  expect(balance(a)).toBe(100_000 - 22_000);
  expect(balance(b)).toBe(100_000 + 10_000);
  expect(balance(c)).toBe(100_000 + 12_000);
});
