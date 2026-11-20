import { describe, expect, it } from 'vitest';
import { asMilli } from '@budgero/core/browser';
import {
  hasReadOnlyTransferCategory,
  splitLinePayeeLabel,
  splitPayeesLabel,
  transferHasOffBudgetLeg,
  transferPayeeLabel,
} from './transfer-category';

describe('hasReadOnlyTransferCategory', () => {
  it('is read-only only when both linked accounts are on-budget', () => {
    expect(
      hasReadOnlyTransferCategory({
        TransferID: 'transfer-1',
        AccountOnBudget: true,
        TransferAccountOnBudget: true,
      })
    ).toBe(true);

    expect(
      hasReadOnlyTransferCategory({
        TransferID: 'transfer-1',
        AccountOnBudget: true,
        TransferAccountOnBudget: false,
      })
    ).toBe(false);

    expect(
      hasReadOnlyTransferCategory({
        TransferID: undefined,
        AccountOnBudget: true,
        TransferAccountOnBudget: true,
      })
    ).toBe(false);
  });
});

describe('transferHasOffBudgetLeg', () => {
  it('only allows the Transfers category for transfers crossing the budget boundary', () => {
    expect(
      transferHasOffBudgetLeg({
        TransferID: 'internal',
        AccountOnBudget: true,
        TransferAccountOnBudget: true,
      })
    ).toBe(false);
    expect(
      transferHasOffBudgetLeg({
        TransferID: 'external',
        AccountOnBudget: true,
        TransferAccountOnBudget: false,
      })
    ).toBe(true);
    expect(
      transferHasOffBudgetLeg({
        TransferID: undefined,
        AccountOnBudget: true,
        TransferAccountOnBudget: false,
      })
    ).toBe(false);
  });
});

describe('transferPayeeLabel', () => {
  const leg = {
    TransferID: 'transfer-1',
    TransferAccountName: 'Savings',
    Payee: '',
    OutflowConverted: asMilli(5000),
  };

  it('points at the other account in the direction the money moved', () => {
    expect(transferPayeeLabel(leg)).toBe('→ Savings');
    expect(transferPayeeLabel({ ...leg, OutflowConverted: asMilli(0) })).toBe('← Savings');
  });

  it('leaves real payees and non-transfers alone', () => {
    expect(transferPayeeLabel({ ...leg, Payee: 'Bank' })).toBeNull();
    expect(transferPayeeLabel({ ...leg, TransferID: '' })).toBeNull();
    expect(transferPayeeLabel({ ...leg, TransferAccountName: null })).toBeNull();
  });
});

describe('splitPayeesLabel', () => {
  const lines = (...values: unknown[][]) => JSON.stringify(values);

  it("lists a payee-less split's line payees and transfer targets once, in line order", () => {
    expect(
      splitPayeesLabel({
        Payee: undefined,
        SplitPayees: lines(
          ['', 'Checking EUR', 1],
          ['Walmart', null, 1],
          ['Walmart', null, 1],
          ['', 'Savings', 0],
          ['', null, 1]
        ),
      })
    ).toBe('→ Checking EUR, Walmart, ← Savings');
  });

  it('is null for a split with its own payee, without line payees, or for other rows', () => {
    expect(splitPayeesLabel({ Payee: 'Shop', SplitPayees: lines(['Walmart', null, 1]) })).toBe(
      null
    );
    expect(splitPayeesLabel({ Payee: '', SplitPayees: lines(['', null, 1]) })).toBeNull();
    expect(splitPayeesLabel({ Payee: '', SplitPayees: null })).toBeNull();
    expect(splitPayeesLabel({ Payee: '', SplitPayees: 'not json' })).toBeNull();
  });
});

describe('splitLinePayeeLabel', () => {
  it("shows a line's payee, else its transfer target, else the parent's payee", () => {
    expect(splitLinePayeeLabel({ Payee: 'Walmart', TransferAccountName: 'Euro' }, 'Shop')).toBe(
      'Walmart'
    );
    expect(
      splitLinePayeeLabel({ Payee: '', TransferAccountName: 'Euro', OutflowConverted: 5 })
    ).toBe('→ Euro');
    expect(splitLinePayeeLabel({ payee: '', transfer_account_name: 'Euro', outflow: 0 })).toBe(
      '← Euro'
    );
    expect(splitLinePayeeLabel({ Payee: '' }, 'Shop')).toBe('Shop');
    expect(splitLinePayeeLabel({ Payee: '' })).toBeNull();
  });
});
