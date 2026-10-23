import { describe, expect, it } from 'vitest';
import { mutationFormatVersion } from './sync-format.js';

/**
 * Undo / redo steps added for exact undo (redo under the first run's IDs,
 * goal restore, payee entry cleanup, transfer template category) are new op
 * codes: older builds can't apply them, so they must stop with
 * "update required" instead of skipping the step and diverging.
 */
describe('exact undo / redo op formats', () => {
  it.each(['history.redoWithIds', 'goals.restore', 'payees.removeUnused', 'recurring.restoreEdit'])(
    '%s is format 3',
    (op) => {
      expect(mutationFormatVersion(op, {})).toBe(3);
    }
  );

  it('a redo under reused IDs is format 3 even when its steps are old ops', () => {
    expect(
      mutationFormatVersion('history.redoWithIds', {
        ids: { transactions: [1, 2] },
        ops: [{ op: 'transactions.add', args: {} }],
      })
    ).toBe(3);
  });
});
