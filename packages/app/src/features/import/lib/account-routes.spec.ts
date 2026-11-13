import { describe, expect, it } from 'vitest';
import type { SyncedStateMergePatch } from '@shared/lib/synced-state';
import {
  accountNameKey,
  defaultRoutes,
  legacyRoutesPatch,
  planAccountRoutes,
  rememberedRoutesOf,
  rememberRoutesPatch,
  sourceAccountsOf,
} from './account-routes';

const accounts = [
  { ID: 1, Name: 'Current Account' },
  { ID: 2, Name: 'Visa' },
];

/** What the store holds after `patch` (as the synced merge applies it). */
function applied(stored: unknown, patch: SyncedStateMergePatch | null): Record<string, unknown> {
  const next = { ...(stored as Record<string, unknown>) };
  Object.assign(next, patch?.set);
  for (const key of patch?.remove ?? []) delete next[key];
  return next;
}

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

  it("takes the account's own currency (OFX CURDEF) over a row's", () => {
    const sources = sourceAccountsOf(
      [
        { Account: 'A', Currency: 'EUR', AccountCurrency: 'USD' },
        { Account: 'A', Currency: 'USD', AccountCurrency: 'USD' },
        { Account: 'B', Currency: 'AUD', AccountCurrency: '' },
      ],
      'Account'
    );
    expect(sources.map((s) => [s.source, s.currency])).toEqual([
      ['A', 'USD'],
      ['B', 'AUD'],
    ]);
  });

  it('starts from a same-name account, then the last choice, then a new account', () => {
    const stored = applied({}, rememberRoutesPatch({}, { '12345678': 2 }, 1));
    const routes = defaultRoutes(
      sourceAccountsOf(
        [{ Account: 'current account' }, { Account: '12345678' }, { Account: 'IBAN-X' }],
        'Account'
      ),
      accounts,
      rememberedRoutesOf(stored)
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
    expect(rememberedRoutesOf([1, 2])).toEqual({});
    const stored = JSON.parse(
      '{"s:__proto__":{"accountId":2,"usedAt":1},"s:ok":{"accountId":1.5,"usedAt":1},"x":{"accountId":1,"usedAt":1}}'
    );
    expect(rememberedRoutesOf(stored)).toEqual(JSON.parse('{"__proto__":2}'));
    const patch = rememberRoutesPatch({}, JSON.parse('{"__proto__":3}'), 5);
    expect(patch?.set).toEqual({ 's:__proto__': { accountId: 3, usedAt: 5 } });
    const plan = planAccountRoutes({
      rows: [{ Account: '__proto__' }, { Account: 'constructor' }],
      column: 'Account',
      accounts,
      remembered: rememberedRoutesOf(stored),
      newAccountCurrency: 'EUR',
    });
    expect(plan.targets.get('__proto__')).toEqual({ kind: 'existing', accountId: 2 });
    expect(plan.routes.constructor).toEqual({ kind: 'new', name: 'constructor' });
  });

  it('keeps at most 200 remembered sources, dropping the oldest', () => {
    let stored: Record<string, unknown> = {};
    for (let i = 0; i < 210; i++) {
      stored = applied(stored, rememberRoutesPatch(stored, { [`s${i}`]: 1 }, 1000 + i));
    }
    const routes = rememberedRoutesOf(stored);
    expect(Object.keys(routes)).toHaveLength(200);
    expect(routes.s9).toBeUndefined();
    expect(routes.s10).toBe(1);
    expect(routes.s209).toBe(1);
    // Picking an old source again makes it new.
    stored = applied(stored, rememberRoutesPatch(stored, { s10: 2, s210: 1 }, 2000));
    expect(rememberedRoutesOf(stored).s10).toBe(2);
    expect(rememberedRoutesOf(stored).s11).toBeUndefined();
  });

  it('stays well under the synced value cap and skips very long sources', () => {
    let stored: Record<string, unknown> = {};
    for (let i = 0; i < 200; i++) {
      const source = `${i}`.padEnd(120, 'x');
      stored = applied(stored, rememberRoutesPatch(stored, { [source]: 1_000_000 + i }, 1e12 + i));
    }
    expect(JSON.stringify(stored).length).toBeLessThan(40_000);
    expect(rememberRoutesPatch({}, { ['y'.repeat(121)]: 1 }, 1)).toBeNull();
    expect(rememberRoutesPatch({}, {}, 1)).toBeNull();
  });

  it("adds only the device's old choices the synced map lacks, oldest first", () => {
    const stored = applied({}, rememberRoutesPatch({}, { A: 1 }, 500));
    const patch = legacyRoutesPatch(
      stored,
      [
        ['A', 9],
        ['B', 2],
        ['C', 3],
      ],
      1000
    );
    expect(patch).toEqual({
      set: { 's:B': { accountId: 2, usedAt: 998 }, 's:C': { accountId: 3, usedAt: 999 } },
    });
    expect(legacyRoutesPatch(stored, [['A', 9]], 1000)).toBeNull();
  });

  it('treats names that differ only by case, spacing or width as one', () => {
    expect(accountNameKey('  My   Visa ')).toBe(accountNameKey('my visa'));
    expect(accountNameKey('ＶＩＳＡ')).toBe(accountNameKey('visa'));
  });
});
