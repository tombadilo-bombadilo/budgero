import { describe, expect, it } from 'vitest';
import { BASE_MUTATION_FORMAT_VERSION, mutationFormatVersion } from './sync-format.js';

describe('rule op formats', () => {
  it('stamps rules.restoreDeleted (undo of a rule delete with its run history) as format 3', () => {
    expect(mutationFormatVersion('rules.restoreDeleted', { journal: {} })).toBe(3);
  });

  it('stamps an undo that restores a deleted rule with format 3', () => {
    expect(
      mutationFormatVersion('history.applyOps', {
        ops: [{ op: 'rules.restoreDeleted', args: { journal: {} } }],
      })
    ).toBe(3);
  });

  it('keeps rules.delete itself at the base format (older builds delete the same rows)', () => {
    expect(mutationFormatVersion('rules.delete', { id: 1 })).toBe(BASE_MUTATION_FORMAT_VERSION);
  });
});
