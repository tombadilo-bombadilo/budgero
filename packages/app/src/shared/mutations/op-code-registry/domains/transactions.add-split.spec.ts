import { beforeEach, describe, expect, it, vi } from 'vitest';
import { executeMutationOp, getInvalidatesForOp } from '@shared/mutations/op-code-registry';

const transactionMocks = vi.hoisted(() => ({
  addTransaction: vi.fn(),
}));
const splitsMocks = vi.hoisted(() => ({
  upsertSplits: vi.fn(),
}));

vi.mock('@shared/runtime/global', () => ({
  getRuntime: () => ({
    services: () => ({ transactions: transactionMocks, splits: splitsMocks }),
    mutationsRouter: () => ({ execute: vi.fn() }),
  }),
}));

describe('transactions.add with optional splits (Push API v2)', () => {
  beforeEach(() => {
    transactionMocks.addTransaction.mockReset().mockResolvedValue(42);
    splitsMocks.upsertSplits.mockReset().mockResolvedValue(undefined);
  });

  it('plain add (no splits) does not touch the split service', async () => {
    await executeMutationOp('transactions.add', {
      inflow: 0,
      outflow: 1234,
      accountId: 10,
      categoryId: 20,
      budgetId: 7,
      date: '2026-09-19',
      memo: 'plain',
      payee: 'Store',
    });
    expect(transactionMocks.addTransaction).toHaveBeenCalledTimes(1);
    expect(splitsMocks.upsertSplits).not.toHaveBeenCalled();
  });

  it('add with splits creates the parent then upserts the normalized lines', async () => {
    await executeMutationOp('transactions.add', {
      inflow: 0,
      outflow: 10000, // 10.00 — must equal the sum of the lines
      accountId: 10,
      budgetId: 7,
      date: '2026-09-19',
      payee: 'Groceries',
      splits: [
        { outflow: 7000, categoryId: 30, memo: 'food' },
        { outflow: 3000, categoryId: 31, payee: 'tax' },
      ],
    });

    const call = transactionMocks.addTransaction.mock.calls[0];
    expect(call[2]).toBe(10); // accountId
    expect(call[3]).toBeNull(); // parent categoryId — no single category when splitting
    expect(call[4]).toBe(7); // budgetId
    expect(call[5]).toBe('2026-09-19'); // date
    expect(call[7]).toBe(''); // transferId
    expect(call[8]).toBe('Groceries'); // payee

    expect(splitsMocks.upsertSplits).toHaveBeenCalledWith(42, [
      expect.objectContaining({
        CategoryID: 30,
        OutflowConverted: 7000,
        Memo: 'food',
        Payee: '',
        OrderIndex: 0,
      }),
      expect.objectContaining({
        CategoryID: 31,
        OutflowConverted: 3000,
        Payee: 'tax',
        OrderIndex: 1,
      }),
    ]);
  });

  it('an empty splits array is rejected instead of creating a parentless split', async () => {
    await expect(
      executeMutationOp('transactions.add', {
        outflow: 1000,
        accountId: 10,
        budgetId: 7,
        date: '2026-09-19',
        splits: [],
      })
    ).rejects.toThrow(/at least one line/i);
  });

  it('a non-array splits field is rejected', async () => {
    await expect(
      executeMutationOp('transactions.add', {
        outflow: 1000,
        accountId: 10,
        budgetId: 7,
        date: '2026-09-19',
        splits: 'nope',
      })
    ).rejects.toThrow(/must be an array/i);
  });

  it('the op invalidates split-scoped queries too', () => {
    const invalidates = getInvalidatesForOp('transactions.add');
    expect(invalidates.some(([key]) => key === 'transactionSplits')).toBe(true);
  });
});
