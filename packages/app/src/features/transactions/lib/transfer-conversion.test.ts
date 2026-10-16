import { describe, expect, it, vi } from 'vitest';
import type { Account } from '@budgero/core/browser';
import {
  buildConvertToTransferArgs,
  buildRevertToTransactionArgs,
  computeCounterpartAmount,
  getConversionBlocker,
  getRevertBlocker,
  getTransactionFlow,
  stripTransferMemo,
  type ConvertibleTransaction,
} from './transfer-conversion';

const account = (id: number, name: string, extra: Partial<Account> = {}) =>
  ({ ID: id, Name: name, Currency: 'USD', OnBudget: true, Archived: false, ...extra }) as Account;

const checking = account(1, 'Checking');
const savings = account(2, 'Savings');
const brokerage = account(3, 'Brokerage', { OnBudget: false });
const euro = account(4, 'Euro account', { Currency: 'EUR' });

const categories = [
  { ID: 5, Name: 'Groceries' },
  { ID: 9, Name: 'Transfers' },
  { ID: 10, Name: 'Uncategorized' },
];

const expense: ConvertibleTransaction = {
  ID: 41,
  BudgetID: 1,
  AccountID: 1,
  Date: '2026-09-02',
  Memo: 'Rent',
  CategoryID: 5,
  LabelID: 7,
  Cleared: true,
  OutflowNative: 12_000,
  OutflowConverted: 12_000,
  InflowNative: 0,
  InflowConverted: 0,
};
const income: ConvertibleTransaction = {
  ...expense,
  OutflowNative: 0,
  OutflowConverted: 0,
  InflowNative: 7_000,
  InflowConverted: 7_000,
};

describe('getTransactionFlow', () => {
  it('reads direction and the exact native amount', () => {
    expect(getTransactionFlow(expense)).toEqual({ isOutflow: true, amount: 12_000 });
    expect(getTransactionFlow(income)).toEqual({ isOutflow: false, amount: 7_000 });
  });

  it('rejects zero or two-sided amounts', () => {
    expect(getTransactionFlow({ ...expense, OutflowNative: 0, OutflowConverted: 0 })).toBeNull();
    expect(getTransactionFlow({ ...expense, InflowNative: 5, InflowConverted: 5 })).toBeNull();
  });
});

describe('getConversionBlocker', () => {
  const base = { transaction: expense, category: 'Groceries', counterpart: savings };

  it('allows an ordinary transaction', () => {
    expect(getConversionBlocker(base)).toBeNull();
    expect(
      getConversionBlocker({
        ...base,
        links: { warranty: false, recurringOccurrence: false, bankReview: false },
      })
    ).toBeNull();
  });

  it.each([
    ['already-transfer', { transaction: { ...expense, TransferID: 'tr-1' } }],
    ['reconciled', { transaction: { ...expense, Reconciled: true } }],
    ['split', { category: 'Split' }],
    ['no-amount', { transaction: { ...expense, OutflowNative: 0, OutflowConverted: 0 } }],
    ['same-account', { counterpart: checking }],
    ['archived-account', { counterpart: account(2, 'Savings', { Archived: true }) }],
    ['warranty', { links: { warranty: true, recurringOccurrence: false, bankReview: false } }],
    [
      'recurring-occurrence',
      { links: { warranty: false, recurringOccurrence: true, bankReview: false } },
    ],
    ['bank-review', { links: { warranty: false, recurringOccurrence: false, bankReview: true } }],
  ])('blocks with %s', (blocker, patch) => {
    expect(getConversionBlocker({ ...base, ...patch })).toBe(blocker);
  });
});

describe('getRevertBlocker', () => {
  const legs = [
    { ...expense, TransferID: 'tr-1' },
    { ...income, ID: 42, AccountID: 2, TransferID: 'tr-1' },
  ];

  it('allows a simple two-leg transfer', () => {
    expect(getRevertBlocker({ legs, transactionId: 41 })).toBeNull();
  });

  it.each([
    ['one leg only', [legs[0]]],
    ['a split-line mirror', legs.map((l) => ({ ...l, TransferID: 'split_transfer_9_x' }))],
    ['a plain transaction', [{ ...expense }, { ...income, ID: 42 }]],
  ])('blocks %s as not-a-transfer', (_label, rows) => {
    expect(getRevertBlocker({ legs: rows, transactionId: 41 })).toBe('not-a-transfer');
  });

  it('blocks when either leg is reconciled or linked', () => {
    expect(
      getRevertBlocker({ legs: [legs[0], { ...legs[1], Reconciled: true }], transactionId: 41 })
    ).toBe('reconciled');
    expect(
      getRevertBlocker({
        legs,
        transactionId: 41,
        links: { warranty: true, recurringOccurrence: false, bankReview: false },
      })
    ).toBe('warranty');
  });
});

describe('computeCounterpartAmount', () => {
  it('keeps the exact amount inside one currency without asking for a rate', async () => {
    const getRate = vi.fn();
    await expect(
      computeCounterpartAmount({
        amount: 12_000,
        ownAccount: checking,
        counterpart: savings,
        date: '2026-09-02',
        budgetId: 1,
        getRate,
      })
    ).resolves.toBe(12_000);
    expect(getRate).not.toHaveBeenCalled();
  });

  it('converts across currencies with the rate between the two account currencies', async () => {
    const getRate = vi.fn().mockResolvedValue(0.5);
    await expect(
      computeCounterpartAmount({
        amount: 12_000,
        ownAccount: checking,
        counterpart: euro,
        date: '2026-09-02',
        budgetId: 1,
        getRate,
      })
    ).resolves.toBe(6_000);
    expect(getRate).toHaveBeenCalledWith('USD', 'EUR', '2026-09-02', 1);
  });

  it('returns null when the rate is unavailable', async () => {
    await expect(
      computeCounterpartAmount({
        amount: 12_000,
        ownAccount: checking,
        counterpart: euro,
        date: '2026-09-02',
        budgetId: 1,
        getRate: async () => null,
      })
    ).resolves.toBeNull();
  });
});

describe('buildConvertToTransferArgs', () => {
  const build = (
    overrides: Partial<Parameters<typeof buildConvertToTransferArgs>[0]> = {}
  ): ReturnType<typeof buildConvertToTransferArgs> =>
    buildConvertToTransferArgs({
      transaction: expense,
      category: 'Groceries',
      ownAccount: checking,
      counterpart: savings,
      categories,
      transferId: 'tr-1',
      counterpartAmount: 12_000,
      ...overrides,
    });

  it('keeps the original row as the source leg and adds the mirror as the destination', () => {
    const args = build({ importIdentities: [{ operationId: 'op-1' }] });

    expect(args.budgetId).toBe(1);
    expect(args.transferId).toBe('tr-1');
    expect(args.source).toMatchObject({
      id: 41,
      inflow: 0,
      outflow: 12_000,
      accountId: 1,
      date: '2026-09-02',
      labelId: 7,
      cleared: true,
      importIdentities: [{ operationId: 'op-1' }],
    });
    expect(args.destination).toMatchObject({
      inflow: 12_000,
      outflow: 0,
      accountId: 2,
      labelId: 7,
      cleared: false,
    });
    expect(args.destination.id).toBeUndefined();
    expect(args.destination.importIdentities).toBeUndefined();
  });

  it('uses Transfers and no payee between two on-budget accounts, like the add form', () => {
    const args = build();

    expect(args.source.categoryId).toBe(9);
    expect(args.destination.categoryId).toBe(9);
    expect(args.source.payee).toBe('');
    expect(args.destination.payee).toBe('');
    expect(args.source.memo).toBe('Checking → Savings: Rent');
    expect(args.destination.memo).toBe(args.source.memo);
  });

  it('keeps the spending category and names the off-budget account as payee', () => {
    const args = build({ counterpart: brokerage });

    expect(args.source.categoryId).toBe(5);
    expect(args.destination.categoryId).toBe(9);
    expect(args.source.payee).toBe('Brokerage');
    expect(args.destination.payee).toBe('Brokerage');
  });

  it('keeps the original row as the destination leg for an inflow', () => {
    const args = build({ transaction: income, counterpartAmount: 7_000 });

    expect(args.destination).toMatchObject({ id: 41, inflow: 7_000, accountId: 1, cleared: true });
    expect(args.source).toMatchObject({ outflow: 7_000, accountId: 2, cleared: false });
    expect(args.source.id).toBeUndefined();
    expect(args.destination.memo).toBe('Savings → Checking: Rent');
  });

  it('carries the original exchange-rate override on its own leg only', () => {
    const args = build({
      transaction: { ...expense, ExchangeRateOverride: true, ExchangeRate: 0.92 },
    });

    expect(args.source.exchangeRateOverride).toBe(0.92);
    expect(args.destination.exchangeRateOverride).toBeNull();
  });

  it('records the conversion in the memo when the currencies differ', () => {
    const args = build({ counterpart: euro, counterpartAmount: 6_000 });

    expect(args.destination.inflow).toBe(6_000);
    expect(args.source.memo).toContain('Checking → Euro account: Rent (');
    expect(args.source.memo).toContain('USD → ');
  });

  it('falls back to category 0 when a named category is unknown', () => {
    const args = build({ categories: [] });

    expect(args.source.categoryId).toBe(0);
  });

  it('refuses a transaction with no single direction', () => {
    expect(() =>
      build({ transaction: { ...expense, OutflowNative: 0, OutflowConverted: 0 } })
    ).toThrow(/single non-zero amount/);
  });
});

describe('stripTransferMemo', () => {
  it('removes the generated prefix and keeps the user memo', () => {
    expect(stripTransferMemo('Checking → Savings: Rent', 'Checking', 'Savings', false)).toBe(
      'Rent'
    );
    expect(stripTransferMemo('Checking → Savings', 'Checking', 'Savings', false)).toBe('');
  });

  it('removes the cross-currency suffix too', () => {
    expect(stripTransferMemo('A → B: Rent (USD 12 → EUR 6)', 'A', 'B', true)).toBe('Rent');
    expect(stripTransferMemo('A → B (USD 12 → EUR 6)', 'A', 'B', true)).toBe('');
  });

  it('leaves a memo it did not generate untouched', () => {
    expect(stripTransferMemo('Rent', 'Checking', 'Savings', false)).toBe('Rent');
    expect(stripTransferMemo('Rent (a → b)', 'Checking', 'Savings', true)).toBe('Rent (a → b)');
  });

  it('keeps a parenthetical in the user memo when the currencies match', () => {
    expect(stripTransferMemo('A → B: Rent (a → b)', 'A', 'B', false)).toBe('Rent (a → b)');
  });
});

describe('buildRevertToTransactionArgs', () => {
  const survivor: ConvertibleTransaction = {
    ...expense,
    TransferID: 'tr-1',
    CategoryID: 9,
    Memo: 'Checking → Savings: Rent',
  };

  it('restores a plain row with the same ID, uncategorized, without a payee', () => {
    const args = buildRevertToTransactionArgs({
      survivor,
      ownAccount: checking,
      partnerAccount: savings,
      transfersCategoryId: 9,
      importIdentities: [{ operationId: 'op-1' }],
    });

    expect(args).toMatchObject({
      id: 41,
      budgetId: 1,
      inflow: 0,
      outflow: 12_000,
      accountId: 1,
      categoryId: 0,
      labelId: 7,
      memo: 'Rent',
      payee: '',
      cleared: true,
      importIdentities: [{ operationId: 'op-1' }],
    });
    expect(args).not.toHaveProperty('transferId');
  });

  it('keeps the category on the on-budget leg of a transfer to an off-budget account', () => {
    const args = buildRevertToTransactionArgs({
      survivor: { ...survivor, CategoryID: 5, Memo: 'Checking → Brokerage: Rent' },
      ownAccount: checking,
      partnerAccount: brokerage,
      transfersCategoryId: 9,
    });

    expect(args.categoryId).toBe(5);
    expect(args.memo).toBe('Rent');
  });

  it('drops the category on the off-budget leg and when it is Transfers', () => {
    expect(
      buildRevertToTransactionArgs({
        survivor: { ...survivor, CategoryID: 5 },
        ownAccount: brokerage,
        partnerAccount: checking,
        transfersCategoryId: 9,
      }).categoryId
    ).toBe(0);
    expect(
      buildRevertToTransactionArgs({
        survivor,
        ownAccount: checking,
        partnerAccount: brokerage,
        transfersCategoryId: 9,
      }).categoryId
    ).toBe(0);
  });

  it('works out the generated memo direction for an inflow leg', () => {
    const args = buildRevertToTransactionArgs({
      survivor: { ...income, TransferID: 'tr-1', Memo: 'Savings → Checking: Rent' },
      ownAccount: checking,
      partnerAccount: savings,
      transfersCategoryId: 9,
    });

    expect(args).toMatchObject({ inflow: 7_000, outflow: 0, memo: 'Rent' });
  });
});
