import { describe, expect, it } from 'vitest';
import {
  MUTATION_FORMAT_VERSION,
  mutationFormatVersion,
  opCodeFormatVersion,
  REQUIRES_FORMAT_ARG,
} from './sync-format';

describe('transaction time (format 7)', () => {
  it('the time display preference is a format-7 op', () => {
    expect(MUTATION_FORMAT_VERSION).toBe(7);
    expect(opCodeFormatVersion('userPreferences.setShowTransactionTime')).toBe(7);
  });

  it('a call that asks for format 7 is stamped 7; others keep the base format', () => {
    expect(
      mutationFormatVersion('transactions.add', { time: '14:30', [REQUIRES_FORMAT_ARG]: 7 })
    ).toBe(7);
    expect(mutationFormatVersion('transactions.add', {})).toBe(2);
  });
});
