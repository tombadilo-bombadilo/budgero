import { beforeEach, describe, expect, it } from 'vitest';
import {
  defaultRoutes,
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
});
