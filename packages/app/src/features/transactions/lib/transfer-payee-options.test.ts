import { describe, expect, it } from 'vitest';
import type { Account } from '@budgero/core/browser';
import {
  conversionReplacesCategory,
  getTransferPayeeOptions,
  isLinkedTransferRow,
} from './transfer-payee-options';

const account = (id: number, name: string, extra: Partial<Account> = {}) =>
  ({ ID: id, Name: name, OnBudget: true, Archived: false, ...extra }) as Account;

const accounts = [
  account(1, 'Checking'),
  account(2, 'Savings'),
  account(3, 'Brokerage', { OnBudget: false }),
  account(4, 'Old account', { Archived: true }),
  account(5, 'Credit card'),
];

const plainRow = {
  ID: 10,
  TransferID: undefined,
  Reconciled: false,
  Category: 'Groceries',
  AccountID: 1,
};

describe('isLinkedTransferRow', () => {
  it('is true only for a real transfer id, not split-line mirrors', () => {
    expect(isLinkedTransferRow({ TransferID: 'abc' })).toBe(true);
    expect(isLinkedTransferRow({ TransferID: '  ' })).toBe(false);
    expect(isLinkedTransferRow({ TransferID: undefined })).toBe(false);
    expect(isLinkedTransferRow({ TransferID: 'split_transfer_7_2026-09-02' })).toBe(false);
  });
});

describe('getTransferPayeeOptions', () => {
  it('offers every other non-archived account, on-budget first, on a plain row', () => {
    const options = getTransferPayeeOptions(plainRow, accounts);

    expect(options.accounts.map((a) => a.Name)).toEqual(['Savings', 'Credit card', 'Brokerage']);
    expect(options.accounts.find((a) => a.Name === 'Brokerage')?.OnBudget).toBe(false);
    expect(options.selectedAccountId).toBeNull();
    expect(options.canUnlink).toBe(false);
  });

  it('falls back to the open register account when the row has no AccountID', () => {
    const options = getTransferPayeeOptions({ ...plainRow, AccountID: undefined }, accounts, 2);

    expect(options.accounts.map((a) => a.Name)).not.toContain('Savings');
    expect(options.accounts.map((a) => a.Name)).toContain('Checking');
  });

  it('excludes the row account by name on budget-wide lists', () => {
    const options = getTransferPayeeOptions(
      { ...plainRow, AccountID: undefined, Account: 'Savings' },
      accounts
    );

    expect(options.accounts.map((a) => a.Name)).not.toContain('Savings');
  });

  it.each([
    ['reconciled', { Reconciled: true }],
    ['split', { Category: 'Split' }],
    ['projected', { IsProjected: true }],
    ['negative id (projected)', { ID: -3 }],
  ])('offers nothing on a %s plain row', (_label, patch) => {
    expect(getTransferPayeeOptions({ ...plainRow, ...patch }, accounts).accounts).toEqual([]);
  });

  it('shows the partner as selected on an existing transfer and allows unlinking', () => {
    const options = getTransferPayeeOptions(
      {
        ...plainRow,
        TransferID: 'tr-1',
        TransferAccountName: 'Savings',
        TransferAccountOnBudget: true,
      },
      accounts
    );

    expect(options.accounts).toEqual([{ ID: 2, Name: 'Savings', OnBudget: true }]);
    expect(options.selectedAccountId).toBe(2);
    expect(options.canUnlink).toBe(true);
  });

  it('flags an off-budget partner and blocks unlinking reconciled transfers', () => {
    const options = getTransferPayeeOptions(
      {
        ...plainRow,
        Reconciled: true,
        TransferID: 'tr-2',
        TransferAccountName: 'Brokerage',
        TransferAccountOnBudget: 0 as unknown as boolean,
      },
      accounts
    );

    expect(options.accounts[0]).toEqual({ ID: 3, Name: 'Brokerage', OnBudget: false });
    expect(options.canUnlink).toBe(false);
  });

  it('still offers unlinking when the partner cannot be matched by name', () => {
    const options = getTransferPayeeOptions(
      { ...plainRow, TransferID: 'tr-3', TransferAccountName: 'Renamed away' },
      accounts
    );

    expect(options).toEqual({ accounts: [], selectedAccountId: null, canUnlink: true });
  });

  it('never matches the row own account as its partner', () => {
    const twins = [account(1, 'Checking'), account(6, 'Checking')];
    const options = getTransferPayeeOptions(
      { ...plainRow, TransferID: 'tr-4', TransferAccountName: 'Checking' },
      twins
    );

    expect(options.selectedAccountId).toBe(6);
  });

  it('offers nothing for split-line mirrors', () => {
    const options = getTransferPayeeOptions(
      { ...plainRow, TransferID: 'split_transfer_7_2026-09-02' },
      accounts
    );

    expect(options).toEqual({ accounts: [], selectedAccountId: null, canUnlink: false });
  });
});

describe('conversionReplacesCategory', () => {
  const row = { Category: 'Groceries', CategoryID: 9, AccountOnBudget: true };

  it('asks when an on-budget row would lose a real category', () => {
    expect(conversionReplacesCategory(row, true)).toBe(true);
  });

  it('does not ask when nothing is lost', () => {
    expect(conversionReplacesCategory(row, false)).toBe(false);
    expect(
      conversionReplacesCategory({ ...row, AccountOnBudget: 0 as unknown as boolean }, true)
    ).toBe(false);
    expect(conversionReplacesCategory({ ...row, Category: 'Transfers' }, true)).toBe(false);
    expect(conversionReplacesCategory({ ...row, Category: 'Uncategorized' }, true)).toBe(false);
    expect(conversionReplacesCategory({ ...row, CategoryID: 0 }, true)).toBe(false);
  });
});
