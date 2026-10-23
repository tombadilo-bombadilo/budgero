import { describe, expect, it } from 'vitest';
import {
  BASE_MUTATION_FORMAT_VERSION,
  FormatTooNewError,
  isUpdateRequiredError,
  MUTATION_FORMAT_VERSION,
  mutationFormatVersion,
  normalizeMutationPayload,
  OP_CODE_FORMAT_VERSIONS,
  SNAPSHOT_DATA_FORMAT_VERSION,
  UnknownOpCodeError,
} from './sync-format.js';

describe('per-op mutation formats', () => {
  it('stamps ops that predate format 3 with the base format', () => {
    expect(mutationFormatVersion('transactions.update', { inflow: 1000 })).toBe(
      BASE_MUTATION_FORMAT_VERSION
    );
    expect(BASE_MUTATION_FORMAT_VERSION).toBe(2);
  });

  it('stamps newer ops, and lists of ops containing one, with their format', () => {
    expect(mutationFormatVersion('transactions.saveSplits', {})).toBe(3);
    expect(
      mutationFormatVersion('some.wrapper', {
        ops: [
          { op: 'transactions.update', args: {} },
          { op: 'payees.restore', args: {} },
        ],
      })
    ).toBe(3);
    expect(mutationFormatVersion('some.wrapper', { ops: [{ op: 'transactions.update' }] })).toBe(2);
  });

  it('never stamps a format this build cannot read', () => {
    for (const version of Object.values(OP_CODE_FORMAT_VERSIONS)) {
      expect(version).toBeGreaterThan(BASE_MUTATION_FORMAT_VERSION);
      expect(version).toBeLessThanOrEqual(MUTATION_FORMAT_VERSION);
    }
  });

  it('keeps snapshots readable by format-2 builds', () => {
    expect(SNAPSHOT_DATA_FORMAT_VERSION).toBe(2);
  });
});

describe('normalizeMutationPayload across formats', () => {
  it('leaves format-2 and format-3 milliunit amounts alone', () => {
    const args = { inflow: 12340, outflow: 0 };
    expect(normalizeMutationPayload({ v: 2, op: 'transactions.add', args }).args).toEqual(args);
    expect(normalizeMutationPayload({ v: 3, op: 'transactions.saveSplits', args }).args).toEqual(
      args
    );
  });

  it('still upgrades unversioned decimal payloads', () => {
    expect(
      normalizeMutationPayload({ op: 'transactions.add', args: { inflow: 1.5 } }).args
    ).toEqual({ inflow: 1500 });
  });

  it('rejects formats newer than this build with an update-required error', () => {
    let caught: unknown;
    try {
      normalizeMutationPayload({ v: MUTATION_FORMAT_VERSION + 1, op: 'x', args: {} });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(FormatTooNewError);
    expect(isUpdateRequiredError(caught)).toBe(true);
  });
});

describe('isUpdateRequiredError', () => {
  it('matches unknown op codes, including copies from another module instance', () => {
    expect(isUpdateRequiredError(new UnknownOpCodeError('a.b'))).toBe(true);
    const foreign = new Error('Unknown mutation op code: a.b');
    foreign.name = 'UnknownOpCodeError';
    expect(isUpdateRequiredError(foreign)).toBe(true);
    expect(isUpdateRequiredError(new Error('constraint failed'))).toBe(false);
  });
});
