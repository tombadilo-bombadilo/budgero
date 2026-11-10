import { beforeEach, describe, expect, it } from 'vitest';
import {
  accountNameKey,
  defaultRoutes,
  planAccountRoutes,
  readRememberedRoutes,
  rememberRoutes,
  sourceAccountsOf,
} from './account-routes';

const accounts = [
  { ID: 1, Name: 'Current Account' },
  { ID: 2, Name: 'Visa' },
];

beforeEach(() => localStorage.clear());

describe('account routes', () => {
  it('lists each account in the file once, with its row count and currency', () => {
    const sources = sourceAccountsOf(
      [
        { Account: 'A', Currency: 'GBP' },
        { Account: 'A', Currency: 'GBP' },
        { Account: ' B ' },
        { Account: '' },
      ],
      'Account'
    );
    expect(sources).toEqual([
      { source: 'A', rows: 2, currency: 'GBP' },
      { source: 'B', rows: 1 },
    ]);
  });

  it('starts from a same-name account, then the last choice, then a new account', () => {
    rememberRoutes(9, { '12345678': 2 });
    const routes = defaultRoutes(
      sourceAccountsOf(
        [{ Account: 'current account' }, { Account: '12345678' }, { Account: 'IBAN-X' }],
        'Account'
      ),
      accounts,
      readRememberedRoutes(9)
    );
    expect(routes).toEqual({
      'current account': { kind: 'existing', accountId: 1 },
      '12345678': { kind: 'existing', accountId: 2 },
      'IBAN-X': { kind: 'new', name: 'IBAN-X' },
    });
  });

  it('keeps what the user picked, unless that account is gone', () => {
    const sources = sourceAccountsOf([{ Account: 'A' }, { Account: 'B' }], 'Account');
    const routes = defaultRoutes(
      sources,
      accounts,
      {},
      {
        A: { kind: 'skip' },
        B: { kind: 'existing', accountId: 77 },
      }
    );
    expect(routes).toEqual({ A: { kind: 'skip' }, B: { kind: 'new', name: 'B' } });
  });

  it('flags new accounts that share a name across currencies', () => {
    const plan = planAccountRoutes({
      rows: [
        { Account: 'A', Currency: 'EUR' },
        { Account: 'B', Currency: 'USD' },
      ],
      column: 'Account',
      accounts,
      chosen: { B: { kind: 'new', name: 'a' } },
      newAccountCurrency: 'GBP',
    });
    expect(plan.newAccounts).toHaveLength(1);
    expect(plan.problems.get('B')).toBe('currency');
    expect(plan.problems.has('A')).toBe(false);
  });

  it('leaves an ambiguous or archived-only name unset for the user to pick', () => {
    for (const extra of [
      { ID: 3, Name: 'visa ' },
      { ID: 3, Name: 'Amex', Archived: true },
    ]) {
      const plan = planAccountRoutes({
        rows: [{ Account: extra.Archived ? 'amex' : 'Visa' }, { Account: 'Other' }],
        column: 'Account',
        accounts: [...accounts, extra],
        newAccountCurrency: 'EUR',
      });
      const source = extra.Archived ? 'amex' : 'Visa';
      expect(plan.routes[source]).toBeUndefined();
      expect(plan.targets.get(source)).toEqual({ kind: 'unset' });
      expect(plan.problems.get(source)).toBe('pick');
      expect(plan.routes.Other).toEqual({ kind: 'new', name: 'Other' });
    }
  });

  it('sends the only account in a file to the account chosen in the dialog, else asks', () => {
    const rows = [{ Account: 'DE89 3704 0044' }, { Account: 'DE89 3704 0044' }];
    const withChoice = planAccountRoutes({
      rows,
      column: 'Account',
      accounts,
      newAccountCurrency: 'EUR',
      fallbackAccountId: 2,
    });
    expect(withChoice.routes['DE89 3704 0044']).toEqual({ kind: 'existing', accountId: 2 });
    expect(withChoice.problems.size).toBe(0);
    const without = planAccountRoutes({
      rows,
      column: 'Account',
      accounts,
      newAccountCurrency: 'EUR',
    });
    expect(without.problems.get('DE89 3704 0044')).toBe('pick');
    // A name match or a remembered choice still wins over the dialog's account.
    const named = planAccountRoutes({
      rows: [{ Account: 'visa' }],
      column: 'Account',
      accounts,
      newAccountCurrency: 'EUR',
      fallbackAccountId: 1,
    });
    expect(named.routes.visa).toEqual({ kind: 'existing', accountId: 2 });
  });

  it('carries the QIF account type into the new account', () => {
    const plan = planAccountRoutes({
      rows: [
        { Account: 'Card', AccountType: 'Credit' },
        { Account: 'Odd', AccountType: 'Spaceship' },
      ],
      column: 'Account',
      accounts,
      newAccountCurrency: 'EUR',
    });
    expect(plan.newAccounts.map((a) => [a.name, a.type])).toEqual([
      ['Card', 'Credit'],
      ['Odd', undefined],
    ]);
  });

  it('ignores a garbage stored value and handles source names like __proto__', () => {
    localStorage.setItem('budgero:import-account-routes:4', '[1,2]');
    expect(readRememberedRoutes(4)).toEqual({});
    localStorage.setItem('budgero:import-account-routes:4', '{"__proto__":2,"ok":1.5}');
    expect(readRememberedRoutes(4)).toEqual({ ['__proto__']: 2 });
    const plan = planAccountRoutes({
      rows: [{ Account: '__proto__' }, { Account: 'constructor' }],
      column: 'Account',
      accounts,
      remembered: readRememberedRoutes(4),
      newAccountCurrency: 'EUR',
    });
    expect(plan.targets.get('__proto__')).toEqual({ kind: 'existing', accountId: 2 });
    expect(plan.routes.constructor).toEqual({ kind: 'new', name: 'constructor' });
  });

  it('keeps at most 200 remembered sources, newest last', () => {
    for (let i = 0; i < 210; i++) rememberRoutes(5, { [`s${i}`]: 1 });
    const stored = readRememberedRoutes(5);
    expect(Object.keys(stored)).toHaveLength(200);
    expect(stored.s0).toBeUndefined();
    expect(stored.s209).toBe(1);
  });

  it('treats names that differ only by case, spacing or width as one', () => {
    expect(accountNameKey('  My   Visa ')).toBe(accountNameKey('my visa'));
    expect(accountNameKey('ＶＩＳＡ')).toBe(accountNameKey('visa'));
  });
});
