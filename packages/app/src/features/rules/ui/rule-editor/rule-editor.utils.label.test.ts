import { describe, it, expect } from 'vitest';
import {
  convertAction,
  getDefaultPayload,
  normalizeAction,
  validateForm,
  createDefaultCondition,
} from './rule-editor.utils';

describe('label.set in the rule editor', () => {
  it('round-trips a label, and "No label" (null) as the clear action', () => {
    const set = normalizeAction({ type: 'label.set', payload: { labelId: 4 } });
    expect(set).toEqual({ type: 'label.set', payload: { labelId: 4 } });
    expect(convertAction(set)).toEqual({ type: 'label.set', payload: { labelId: 4 } });

    const clear = normalizeAction({ type: 'label.set', payload: { labelId: null } });
    expect(clear.payload.labelId).toBe('');
    expect(convertAction(clear)).toEqual({ type: 'label.set', payload: { labelId: null } });
    expect(getDefaultPayload('label.set', [], [])).toEqual({ labelId: '' });
  });

  it('accepts a label or No label, and rejects garbage', () => {
    const condition = { ...createDefaultCondition(), value: 'coffee' };
    const ok = (labelId: string | number) =>
      validateForm('Rule', [condition], [{ type: 'label.set', payload: { labelId } }]);
    expect(ok(4)).toBeNull();
    expect(ok('')).toBeNull();
    expect(ok('abc')).toMatch(/label/i);
  });
});
