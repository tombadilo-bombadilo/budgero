import { describe, expect, it } from 'vitest';
import { planAccountRoutes } from './account-routes';
import { planFileTransfers, transferTargetsOf, type TransferRow } from './plan-transfers';

const accounts = [
  { ID: 1, Name: 'Checking', Currency: 'USD' },
  { ID: 2, Name: 'Savings', Currency: 'USD' },
  { ID: 3, Name: 'Euro', Currency: 'EUR' },
];

interface Line {
  account: string;
  to?: string;
  amount: number;
  date?: string;
}

/** A QIF-like file: Account and TransferAccount columns. */
function plan(lines: Line[], chosen = {}, extraAccounts = accounts) {
  const rows = lines.map((l) => ({ Account: l.account, TransferAccount: l.to ?? '' }));
  const routePlan = planAccountRoutes({
    rows,
    column: 'Account',
    accounts: extraAccounts,
    chosen,
    newAccountCurrency: 'USD',
  });
  const transferRows: TransferRow[] = lines.map((l, index) => {
    const target = routePlan.targets.get(l.account);
    return {
      index,
      ready: true,
      accountId:
        target?.kind === 'existing'
          ? target.accountId
          : target?.kind === 'new'
            ? target.placeholderId
            : null,
      currency: target?.kind === 'new' ? target.currency : 'USD',
      date: l.date ?? '2026-09-01',
      inflow: Math.max(l.amount, 0),
      outflow: Math.max(-l.amount, 0),
    };
  });
  return planFileTransfers({
    rows: transferRows,
    targets: transferTargetsOf(rows, ['Account', 'TransferAccount'], undefined),
    routePlan,
    accounts: extraAccounts,
  });
}

describe('transfers inside one file', () => {
  it('pairs both sides once, each pointing at the other', () => {
    const transfers = plan([
      { account: 'Checking', to: 'Savings', amount: -100 },
      { account: 'Checking', amount: -5 },
      { account: 'Savings', to: 'Checking', amount: 100, date: '2026-09-02' },
    ]);
    expect(transfers.get(0)).toEqual({
      counterpartAccountId: 2,
      counterpartName: 'Savings',
      partnerIndex: 2,
    });
    expect(transfers.get(2)).toEqual({
      counterpartAccountId: 1,
      counterpartName: 'Checking',
      partnerIndex: 0,
    });
    expect(transfers.has(1)).toBe(false);
  });

  it('pairs equal repeated transfers one to one, nearest date first', () => {
    const transfers = plan([
      { account: 'Checking', to: 'Savings', amount: -50, date: '2026-09-01' },
      { account: 'Checking', to: 'Savings', amount: -50, date: '2026-09-08' },
      { account: 'Savings', to: 'Checking', amount: 50, date: '2026-09-08' },
      { account: 'Savings', to: 'Checking', amount: 50, date: '2026-09-01' },
    ]);
    expect(transfers.get(0)?.partnerIndex).toBe(3);
    expect(transfers.get(1)?.partnerIndex).toBe(2);
  });

  it('creates the transfer from one side when the other is not in the file', () => {
    const transfers = plan([
      { account: 'Checking', to: 'Savings', amount: -100 },
      { account: 'Savings', amount: 3 },
    ]);
    expect(transfers.get(0)).toEqual({ counterpartAccountId: 2, counterpartName: 'Savings' });
  });

  it('finds an existing account by name when it is not one of the file accounts', () => {
    const transfers = plan([{ account: 'Checking', to: 'savings', amount: -100 }]);
    expect(transfers.get(0)?.counterpartAccountId).toBe(2);
  });

  it('pairs with a new account by its placeholder', () => {
    const transfers = plan([
      { account: 'Checking', to: 'Brokerage cash', amount: -100 },
      { account: 'Brokerage cash', to: 'Checking', amount: 100 },
    ]);
    expect(transfers.get(0)?.counterpartAccountId).toBeLessThanOrEqual(-100);
    expect(transfers.get(1)).toMatchObject({ counterpartAccountId: 1, partnerIndex: 0 });
  });

  it('keeps sides too far apart plain, so the transfer is not created twice', () => {
    const transfers = plan([
      { account: 'Checking', to: 'Savings', amount: -100, date: '2026-09-01' },
      { account: 'Savings', to: 'Checking', amount: 100, date: '2026-09-10' },
    ]);
    expect(transfers.size).toBe(0);
  });

  it('falls back to plain rows for a skipped, unknown, same or other-currency account', () => {
    expect(
      plan(
        [
          { account: 'Checking', to: 'Savings', amount: -100 },
          { account: 'Savings', to: 'Checking', amount: 100 },
        ],
        { Savings: { kind: 'skip' } }
      ).size
    ).toBe(0);
    expect(plan([{ account: 'Checking', to: 'Nowhere', amount: -1 }]).size).toBe(0);
    expect(plan([{ account: 'Checking', to: 'Checking', amount: -1 }]).size).toBe(0);
    expect(plan([{ account: 'Checking', to: 'Euro', amount: -1 }]).size).toBe(0);
  });

  it('reads the YNAB register payee convention', () => {
    const headers = [
      'Account',
      'Flag',
      'Date',
      'Payee',
      'Category Group/Category',
      'Category Group',
      'Category',
      'Memo',
      'Outflow',
      'Inflow',
      'Cleared',
    ];
    expect(
      transferTargetsOf([{ Payee: 'Transfer : Savings' }, { Payee: 'Grocer' }], headers, 'Payee')
    ).toEqual(['Savings', undefined]);
    // A plain CSV with such a payee is not a transfer.
    expect(transferTargetsOf([{ Payee: 'Transfer : Savings' }], ['Payee'], 'Payee')).toEqual([
      undefined,
    ]);
  });
});
