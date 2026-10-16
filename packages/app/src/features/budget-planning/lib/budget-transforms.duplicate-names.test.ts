import type { GetMonthlyBudgetRow } from '@budgero/core/browser';
import { describe, expect, it } from 'vitest';
import { transformBudgetRows } from './budget-transforms';

const row = (categoryId: number, category: string): GetMonthlyBudgetRow =>
  ({
    CategoryID: categoryId,
    Category: category,
    CategoryGroupID: 6,
    CategoryGroup: 'SAVINGS',
    Assigned: 0,
    Activity: 0,
    Available: 0,
    TotalTransactionCount: 0,
  }) as unknown as GetMonthlyBudgetRow;

describe('transformBudgetRows with repeated category names', () => {
  it('gives same-named categories in one group distinct row ids', () => {
    const rows = transformBudgetRows(
      [row(11, 'Emergency fund'), row(12, 'Emergency fund')],
      [],
      '2026-10'
    );
    const categories = rows.filter((r) => !r.isGroup);
    expect(categories.map((r) => r.categoryId)).toEqual([11, 12]);
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
  });
});
