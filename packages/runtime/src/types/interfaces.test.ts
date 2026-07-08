import { describe, expect, it } from 'vitest';
import { extractBudgetId } from './interfaces';

describe('interfaces helpers', () => {
  it('extracts budget id from supported field names', () => {
    expect(extractBudgetId({ budgetId: 1 })).toBe(1);
    expect(extractBudgetId({ budget_id: 2 })).toBe(2);
    expect(extractBudgetId({ BudgetID: 3 })).toBe(3);
    expect(extractBudgetId({ budgetId: 0 })).toBeNull();
    expect(extractBudgetId({ budgetId: Number.NaN })).toBeNull();
  });
});
