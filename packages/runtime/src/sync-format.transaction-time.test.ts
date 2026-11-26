import { describe, expect, it } from 'vitest';
import { FormatTooNewError, normalizeMutationPayload, opCodeFormatVersion } from './sync-format';

describe('transaction time (format 7)', () => {
  it('the time display preference is a format 7 op, so older builds stop with update required', () => {
    expect(opCodeFormatVersion('userPreferences.setShowTransactionTime')).toBe(7);
  });

  it('this build reads format 7 payloads (pushed items carrying a time)', () => {
    expect(
      normalizeMutationPayload({ v: 7, op: 'transactions.add', args: { time: '14:30' } }).args
    ).toEqual({ time: '14:30' });
    expect(() => normalizeMutationPayload({ v: 9, op: 'transactions.add', args: {} })).toThrow(
      FormatTooNewError
    );
  });
});
