import { describe, expect, it } from 'vitest';
import {
  followEnteredReceived,
  followEnteredReceivedLines,
  hasTransferRate,
  mirrorMagnitude,
  needsReceivedAmount,
  splitLineCategoryMode,
  splitPayeeUpdate,
  SPLIT_LINE_RECEIVED,
  splitTransferUpdate,
  transferAccountFromPayee,
} from './split-transfer';
import type { SplitLine } from '../ui/form/SplitEditor';

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

  it('a split mirror row has no transfer rate of its own', () => {
    expect(hasTransferRate('tr-1')).toBe(true);
    expect(hasTransferRate('split_transfer_7_2026-03-10')).toBe(false);
    expect(hasTransferRate('')).toBe(false);
    expect(hasTransferRate(null)).toBe(false);
  });
});

describe('an entered received amount follows its line', () => {
  const entered = (fields: Partial<SplitLine> = {}): SplitLine => ({
    id: 'a',
    memo: '',
    payee: '',
    inflow: 0 as SplitLine['inflow'],
    outflow: 120_000 as SplitLine['outflow'],
    transferAccountId: 5,
    receivedAmount: 80_000,
    receivedAuto: false,
    ...fields,
  });
  const follow = (before: SplitLine, patch: Partial<SplitLine>) =>
    followEnteredReceived(before, { ...before, ...patch }, SPLIT_LINE_RECEIVED);

  it('scales in proportion and stays entered: 120 -> 150 turns 80 into 100', () => {
    expect(follow(entered(), { outflow: 150_000 as SplitLine['outflow'] })).toMatchObject({
      receivedAmount: 100_000,
      receivedAuto: false,
    });
    // Exact integer scaling, rounded half away from zero.
    expect(follow(entered(), { outflow: 100_000 as SplitLine['outflow'] }).receivedAmount).toBe(
      66_667
    );
    // A direction flip keeps the magnitude.
    expect(
      follow(entered(), {
        outflow: 0 as SplitLine['outflow'],
        inflow: 120_000 as SplitLine['inflow'],
      }).receivedAmount
    ).toBe(80_000);
  });

  it('a typed amount, a new target, a zero amount or an estimate is left alone', () => {
    const typed = follow(entered(), {
      outflow: 150_000 as SplitLine['outflow'],
      receivedAmount: 90_000,
    });
    expect(typed.receivedAmount).toBe(90_000);
    expect(
      follow(entered(), { outflow: 150_000 as SplitLine['outflow'], transferAccountId: 6 })
        .receivedAmount
    ).toBe(80_000);
    expect(follow(entered(), { outflow: 0 as SplitLine['outflow'] }).receivedAmount).toBe(80_000);
    expect(
      follow(entered({ outflow: 0 as SplitLine['outflow'] }), {
        outflow: 50_000 as SplitLine['outflow'],
      }).receivedAmount
    ).toBe(80_000);
    expect(
      follow(entered({ receivedAuto: true }), { outflow: 150_000 as SplitLine['outflow'] })
        .receivedAmount
    ).toBe(80_000);
  });

  it('applies line by line to lines edited in place', () => {
    const before = [entered(), entered({ id: 'b', transferAccountId: null, receivedAmount: null })];
    const after = before.map((line) => ({ ...line, outflow: 60_000 as SplitLine['outflow'] }));
    expect(
      followEnteredReceivedLines(before, after, SPLIT_LINE_RECEIVED).map((l) => l.receivedAmount)
    ).toEqual([40_000, null]);
  });
});
