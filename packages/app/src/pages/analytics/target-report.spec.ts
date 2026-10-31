import { describe, expect, it } from 'vitest';
import { GoalPurpose, GoalType, type Goal } from '@budgero/core/browser';
import {
  buildTargetReport,
  fundedPercent,
  monthTarget,
  type TargetMonthRow,
} from './target-report';

const goal = (type: GoalType, target: number, extra: Partial<Goal> = {}): Goal => ({
  ID: 1,
  CategoryID: 1,
  Type: type,
  Purpose: GoalPurpose.SPENDING,
  Target: target as Goal['Target'],
  StartDate: '2026-08-01',
  ...extra,
});

const row = (
  categoryId: number,
  group: string,
  values: Partial<TargetMonthRow> = {}
): TargetMonthRow => ({
  categoryId,
  category: `Cat ${categoryId}`,
  group,
  assigned: 0,
  spent: 0,
  target: null,
  funded: 0,
  ...values,
});

describe('monthTarget', () => {
  it('has no target without a goal or before the goal started', () => {
    const finances = { available: 0, assigned: 0, activity: 0 };
    expect(monthTarget(undefined, '2026-09', finances)).toEqual({ target: null, funded: 0 });
    expect(monthTarget(goal(GoalType.MONTHLY, 100_000), '2026-07', finances)).toEqual({
      target: null,
      funded: 0,
    });
  });

  it('counts money spent during the month toward a monthly available target', () => {
    // Assigned 100 and spent 60: the target was met at the start of the month.
    const result = monthTarget(goal(GoalType.MONTHLY, 100_000), '2026-09', {
      available: 40_000,
      assigned: 100_000,
      activity: -60_000,
    });
    expect(result).toEqual({ target: 100_000, funded: 100_000 });
  });

  it('reports a partly funded monthly savings target', () => {
    const result = monthTarget(goal(GoalType.MONTHLY_SAVINGS, 200_000), '2026-09', {
      available: 50_000,
      assigned: 50_000,
      activity: 0,
    });
    expect(result).toEqual({ target: 200_000, funded: 50_000 });
  });
});

describe('buildTargetReport', () => {
  const report = buildTargetReport([
    {
      monthKey: '2026-09',
      rows: [
        row(1, 'Bills', { assigned: 100_000, spent: 90_000, target: 100_000, funded: 100_000 }),
        row(2, 'Bills', { assigned: 20_000, spent: 25_000 }),
        row(3, 'Fun', { assigned: 10_000, target: 50_000, funded: 10_000 }),
      ],
    },
    {
      monthKey: '2026-10',
      rows: [
        row(1, 'Bills', { assigned: 60_000, spent: 80_000, target: 100_000, funded: 60_000 }),
        row(2, 'Bills', { assigned: 20_000, spent: 15_000 }),
        row(3, 'Fun', { target: 50_000 }),
      ],
    },
  ]);

  it('sums each category over the months and counts the months met', () => {
    const rent = report.groups[0].rows[0];
    expect(rent).toMatchObject({
      target: 200_000,
      funded: 160_000,
      assigned: 160_000,
      spent: 170_000,
      monthsWithTarget: 2,
      monthsMet: 1,
    });
    expect(fundedPercent(rent)).toBe(80);
  });

  it('keeps categories without a goal, with no target', () => {
    expect(report.groups[0].rows[1]).toMatchObject({ target: null, assigned: 40_000 });
  });

  it('adds up group subtotals and the grand total in budget order', () => {
    expect(report.groups.map((g) => g.name)).toEqual(['Bills', 'Fun']);
    expect(report.groups[0]).toMatchObject({ target: 200_000, assigned: 200_000, spent: 210_000 });
    expect(report.groups[1]).toMatchObject({ target: 100_000, funded: 10_000 });
    expect(report.total).toMatchObject({
      target: 300_000,
      funded: 170_000,
      assigned: 210_000,
      spent: 210_000,
    });
  });
});
