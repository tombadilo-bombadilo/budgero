import { describe, expect, it } from 'vitest';
import {
  FormatTooNewError,
  MUTATION_FORMAT_VERSION,
  normalizeMutationPayload,
  upgradeLegacyMoneyValues,
} from './sync-format.js';

describe('normalizeMutationPayload', () => {
  it('passes current-format payloads through untouched', () => {
    const args = { inflow: 12340, outflow: 0, memo: 'coffee' };
    expect(normalizeMutationPayload({ v: MUTATION_FORMAT_VERSION, op: 'transactions.add', args })).toEqual({
      op: 'transactions.add',
      args,
    });
  });

  it('upgrades legacy (unversioned) decimal payloads to milliunits', () => {
    const { args } = normalizeMutationPayload({
      op: 'transactions.add',
      args: { inflow: 12.34, outflow: 0, accountId: 5, memo: 'coffee', exchangeRate: 1.1 },
    });
    expect(args).toEqual({
      inflow: 12340,
      outflow: 0,
      accountId: 5,
      memo: 'coffee',
      exchangeRate: 1.1, // rates are not money
    });
  });

  it('rejects payloads from a newer format', () => {
    expect(() =>
      normalizeMutationPayload({ v: MUTATION_FORMAT_VERSION + 1, op: 'x', args: {} })
    ).toThrow(FormatTooNewError);
  });
});

describe('upgradeLegacyMoneyValues', () => {
  it('converts nested structures and split arrays', () => {
    expect(
      upgradeLegacyMoneyValues({
        splits: [
          { inflow: 0, outflow: 25.1, memo: 'a' },
          { inflow: 0, outflow: 24.9, memo: 'b' },
        ],
        target: 100.004,
      })
    ).toEqual({
      splits: [
        { inflow: 0, outflow: 25100, memo: 'a' },
        { inflow: 0, outflow: 24900, memo: 'b' },
      ],
      target: 100004,
    });
  });

  it('converts newValue only when columnName names a money column', () => {
    expect(
      upgradeLegacyMoneyValues({ columnName: 'Inflow', newValue: 12.34, id: 7 })
    ).toEqual({ columnName: 'Inflow', newValue: 12340, id: 7 });
    expect(upgradeLegacyMoneyValues({ columnName: 'Memo', newValue: 3, id: 7 })).toEqual({
      columnName: 'Memo',
      newValue: 3,
      id: 7,
    });
  });

  it('leaves ids, dates, strings, and non-finite values alone', () => {
    const input = { accountId: 3, date: '2026-07-03', memo: '12.34', amount: 'n/a' };
    expect(upgradeLegacyMoneyValues(input)).toEqual(input);
  });
});
