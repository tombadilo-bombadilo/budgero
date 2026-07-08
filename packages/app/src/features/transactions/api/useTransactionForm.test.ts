import { describe, expect, it } from 'vitest';
import { mergeLastUsedFields } from './useTransactionForm';

describe('mergeLastUsedFields', () => {
  it('remembers a newly selected label', () => {
    const next = mergeLastUsedFields({}, { labelId: 5 });
    expect(next.labelId).toBe(5);
  });

  it('clears the remembered label when the user saves with "No label" (null)', () => {
    // Regression: previously null was coerced to undefined and ignored, so a
    // stale label (e.g. "Corolla") kept re-appearing on the next transaction.
    const next = mergeLastUsedFields({ labelId: 5 }, { labelId: null });
    expect(next.labelId).toBeNull();
  });

  it('keeps the remembered label when labelId is absent from the update', () => {
    const next = mergeLastUsedFields({ labelId: 5 }, { payee: 'Amazon' });
    expect(next.labelId).toBe(5);
    expect(next.payee).toBe('Amazon');
  });

  it('ignores non-positive label ids', () => {
    const next = mergeLastUsedFields({ labelId: 5 }, { labelId: 0 });
    expect(next.labelId).toBe(5);
  });

  it('merges category, payee, and account without disturbing the label', () => {
    const next = mergeLastUsedFields(
      { labelId: 3 },
      { category: 'Groceries', payee: 'Amazon', accountId: '2' }
    );
    expect(next).toEqual({ labelId: 3, category: 'Groceries', payee: 'Amazon', accountId: '2' });
  });
});
