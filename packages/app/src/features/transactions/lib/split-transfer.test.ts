import { describe, expect, it } from 'vitest';
import { splitPayeeUpdate, splitTransferUpdate, transferAccountFromPayee } from './split-transfer';

const accounts = [
  { ID: 1, Name: 'Account_A' },
  { ID: 2, Name: 'Account_B' },
  { ID: 3, Name: 'Account_C' },
];

describe('split transfer lines', () => {
  it('reads "Transfer : Account" payees as a transfer to that account', () => {
    expect(transferAccountFromPayee('Transfer : Account_B', accounts, 1)).toBe(2);
    expect(transferAccountFromPayee('Transfer: account_c', accounts, 1)).toBe(3);
    expect(transferAccountFromPayee('Transfer to: Account_B', accounts, 1)).toBe(2);
  });

  it('leaves ordinary payees, unknown accounts and the own account alone', () => {
    expect(transferAccountFromPayee('Grocer', accounts, 1)).toBeNull();
    expect(transferAccountFromPayee('Transfer : Brokerage', accounts, 1)).toBeNull();
    expect(transferAccountFromPayee('Transfer : Account_A', accounts, 1)).toBeNull();
  });

  it('turns a payee commit into a transfer line (no category) or a plain payee', () => {
    expect(splitPayeeUpdate('Transfer : Account_B', accounts, 1)).toEqual({
      payee: '',
      transferAccountId: 2,
      categoryId: null,
    });
    expect(splitPayeeUpdate('Grocer', accounts, 1)).toEqual({
      payee: 'Grocer',
      transferAccountId: null,
    });
    expect(splitTransferUpdate(3)).toEqual({ payee: '', transferAccountId: 3, categoryId: null });
  });
});
