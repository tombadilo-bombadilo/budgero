import { describe, expect, it } from 'vitest';
import {
  BASE_MUTATION_FORMAT_VERSION,
  MUTATION_FORMAT_VERSION,
  mutationFormatVersion,
  REQUIRES_FORMAT_ARG,
} from './sync-format.js';

describe('per-call format (REQUIRES_FORMAT_ARG)', () => {
  it('raises an older op code to the format the call asks for', () => {
    expect(mutationFormatVersion('transactions.delete', { id: 1 })).toBe(
      BASE_MUTATION_FORMAT_VERSION
    );
    expect(mutationFormatVersion('transactions.delete', { id: 1, [REQUIRES_FORMAT_ARG]: 3 })).toBe(
      3
    );
  });

  it('never stamps outside what this build writes', () => {
    expect(mutationFormatVersion('x.y', { [REQUIRES_FORMAT_ARG]: 99 })).toBe(
      MUTATION_FORMAT_VERSION
    );
    expect(mutationFormatVersion('x.y', { [REQUIRES_FORMAT_ARG]: 1 })).toBe(
      BASE_MUTATION_FORMAT_VERSION
    );
    expect(mutationFormatVersion('x.y', { [REQUIRES_FORMAT_ARG]: '3' })).toBe(
      BASE_MUTATION_FORMAT_VERSION
    );
  });

  it('counts a marked step inside a list of ops', () => {
    expect(
      mutationFormatVersion('some.wrapper', {
        ops: [{ op: 'transactions.delete', args: { id: 1, [REQUIRES_FORMAT_ARG]: 3 } }],
      })
    ).toBe(3);
  });
});
