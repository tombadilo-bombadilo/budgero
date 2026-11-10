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

  it('defaults to a new account when the same name is ambiguous or archived', () => {
    const plan = planAccountRoutes({
      rows: [{ Account: 'Visa' }],
      column: 'Account',
      accounts: [...accounts, { ID: 3, Name: 'visa ' }],
      newAccountCurrency: 'EUR',
    });
    expect(plan.routes.Visa).toEqual({ kind: 'new', name: 'Visa' });
    expect(plan.problems.get('Visa')).toBe('name-taken');
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
