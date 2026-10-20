import { describe, expect, it } from 'vitest';
import { opCodeFormatVersion } from './sync-format';

describe('userPreferences.setCompactBudgetRows', () => {
  it('is a format 3 op, so builds without it stop with update required', () => {
    expect(opCodeFormatVersion('userPreferences.setCompactBudgetRows')).toBe(3);
    expect(opCodeFormatVersion('userPreferences.setCompactTransactionRows')).toBe(2);
  });
});
