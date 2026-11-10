import { describe, expect, it } from 'vitest';
import { getAccountTypeDefinition, isLiabilityType } from './accountTypes';

describe('account types', () => {
  it('match case-insensitively, like core', () => {
    // The demo budget (and older data) stores 'credit'.
    expect(isLiabilityType('credit')).toBe(true);
    expect(isLiabilityType('Credit')).toBe(true);
    expect(isLiabilityType('LOAN')).toBe(true);
    expect(isLiabilityType('checking')).toBe(false);
    expect(getAccountTypeDefinition('real estate')?.category).toBe('asset');
    expect(getAccountTypeDefinition('nope')).toBeNull();
  });
});
