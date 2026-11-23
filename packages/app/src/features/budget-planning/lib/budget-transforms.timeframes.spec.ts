import { describe, expect, it } from 'vitest';
import { GoalPurpose, GoalType, type GetMonthlyBudgetRow, type Goal } from '@budgero/core/browser';
import { asMilli } from '@shared/lib/currency/milli';
import { transformBudgetRows } from './budget-transforms';
import {
  calculateOverfundedCategories,
  calculateUnderfundedGoals,
} from '../ui/assign-dropdown/assign-dropdown.utils';

const timeframe = (id: number, from: string, target: number, to: string | null = null): Goal => ({
  ID: id,
  Type: GoalType.MONTHLY_SAVINGS,
  Purpose: GoalPurpose.SAVINGS,
  CategoryID: 5,
  Target: asMilli(target),
  StartDate: `${from}-01`,
  TargetDate: '',
  EffectiveFrom: from,
  EffectiveTo: to,
});

/** Groceries: 200 from Jan 2020, 220 from Oct 2020, 250 from Jun 2021 (issue #137). */
const chain = [
  timeframe(1, '2020-01', 200_000),
  timeframe(3, '2021-06', 250_000),
  timeframe(2, '2020-10', 220_000),
];

const row = (month: string, assigned: number): GetMonthlyBudgetRow =>
  ({
    CategoryID: 5,
    Category: 'Groceries',
    CategoryGroupID: 1,
    CategoryGroup: 'Everyday',
    Month: month,
    Assigned: asMilli(assigned),
    Activity: asMilli(0),
    Available: asMilli(assigned),
    FundingPriority: 3,
  }) as unknown as GetMonthlyBudgetRow;

describe('budget rows use the goal of their month', () => {
  it.each([
    ['2019-03', 200_000],
    ['2020-09', 200_000],
    ['2020-10', 220_000],
    ['2021-05', 220_000],
    ['2021-06', 250_000],
  ])('%s → target %i', (month, target) => {
    const rows = transformBudgetRows([row(month, 0)], chain, month);
    const category = rows.find((entry) => !entry.isGroup && entry.categoryId === 5);
    expect(category?.goal?.Target).toBe(target);
  });

  it('a month after an ended goal has no goal', () => {
    const ended = [timeframe(1, '2020-01', 200_000, '2020-05')];
    const rows = transformBudgetRows([row('2020-06', 0)], ended, '2020-06');
    const category = rows.find((entry) => !entry.isGroup && entry.categoryId === 5);
    expect(category?.goal).toBeUndefined();
    expect(category?.goalStatus).toBe('none');
  });
});

describe('underfunded / overfunded use the goal of the month', () => {
  it('asks for what that month’s goal needs', () => {
    expect(calculateUnderfundedGoals(chain, [row('2020-11', 0)], 'USD', '2020-11')).toEqual([
      expect.objectContaining({ categoryId: 5, needed: 220_000, target: 220_000 }),
    ]);
    expect(calculateUnderfundedGoals(chain, [row('2021-07', 0)], 'USD', '2021-07')).toEqual([
      expect.objectContaining({ categoryId: 5, needed: 250_000 }),
    ]);
  });

  it('counts a category once, with the month’s goal, for overfunding', () => {
    const overfunded = calculateOverfundedCategories(
      chain,
      [row('2020-11', 300_000)],
      'USD',
      '2020-11'
    );
    expect(overfunded).toHaveLength(1);
    expect(overfunded[0]).toEqual(expect.objectContaining({ categoryId: 5 }));
  });

  it('skips a category whose goal has ended', () => {
    const ended = [timeframe(1, '2020-01', 200_000, '2020-05')];
    expect(calculateUnderfundedGoals(ended, [row('2020-06', 0)], 'USD', '2020-06')).toEqual([]);
  });
});
