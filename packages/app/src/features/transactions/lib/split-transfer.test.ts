import { describe, expect, it } from 'vitest';
import {
  mirrorMagnitude,
  needsReceivedAmount,
  splitLineCategoryMode,
  splitPayeeUpdate,
  splitTransferUpdate,
  transferAccountFromPayee,
} from './split-transfer';

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
      receivedAmount: null,
      receivedAuto: true,
    });
    expect(splitPayeeUpdate('Grocer', accounts, 1)).toEqual({
      payee: 'Grocer',
      transferAccountId: null,
      receivedAmount: null,
      receivedAuto: true,
    });
    expect(splitTransferUpdate(3)).toEqual({
      payee: '',
      transferAccountId: 3,
      categoryId: null,
      receivedAmount: null,
      receivedAuto: true,
    });
  });

  it('locks the category of on-budget transfer lines; off-budget targets may take one', () => {
    const onBudget = { OnBudget: true };
    const tracking = { OnBudget: 0 };
    expect(splitLineCategoryMode(onBudget, undefined)).toBe('category');
    expect(splitLineCategoryMode(onBudget, onBudget)).toBe('transfer-locked');
    expect(splitLineCategoryMode(onBudget, tracking)).toBe('transfer-optional');
    // An off-budget parent's lines never count in the budget.
    expect(splitLineCategoryMode(tracking, tracking)).toBe('transfer-locked');
    expect(splitLineCategoryMode(tracking, onBudget)).toBe('transfer-locked');
  });

  it('asks for a received amount only across currencies', () => {
    expect(needsReceivedAmount('USD', { Currency: 'EUR' })).toBe(true);
    expect(needsReceivedAmount('USD', { Currency: 'USD' })).toBe(false);
    expect(needsReceivedAmount(undefined, { Currency: 'EUR' })).toBe(false);
    expect(mirrorMagnitude({ InflowNative: 0, OutflowNative: 4_200 })).toBe(4_200);
    expect(mirrorMagnitude({ InflowNative: 0, OutflowNative: 0 })).toBeNull();
  });
});
