import { GoalCalculations, GoalPurpose, GoalType, type Goal } from '@budgero/core/browser';
import { asMilli } from '@shared/lib/currency/milli';
import {
  goalCardDetailItems,
  goalCardHeadline,
  goalRecommendationAddsInfo,
} from './goal-card-view';

const goal = (fields: Partial<Goal>): Goal => ({
  ID: 1,
  CategoryID: 1,
  Purpose: GoalPurpose.SPENDING,
  Type: GoalType.MONTHLY,
  Target: asMilli(700_000),
  StartDate: '2026-01-01',
  ...fields,
});

describe('goal card view helpers', () => {
  it('measures a goal in another currency against its converted target', () => {
    const g = goal({
      TargetCurrency: 'EUR',
      TargetConverted: asMilli(800_000),
      TargetRateSource: 'official',
    });
    const finances = { available: 600_000, assigned: 600_000, activity: 0 };
    const progress = GoalCalculations.calculateProgress(g, finances, '2026-09');
    expect(goalCardHeadline(g, progress, finances)).toEqual({
      amount: 600_000,
      target: 800_000,
      percentage: 75,
    });
  });

  it('caps the headline share at 0–100%', () => {
    const g = goal({ Purpose: GoalPurpose.SAVINGS, Type: GoalType.MONTHLY_SAVINGS });
    const over = { available: 900_000, assigned: 900_000, activity: 0 };
    const under = { available: -50_000, assigned: -50_000, activity: 0 };
    const pct = (f: typeof over) =>
      goalCardHeadline(g, GoalCalculations.calculateProgress(g, f, '2026-09'), f).percentage;
    expect(pct(over)).toBe(100);
    expect(pct(under)).toBe(0);
  });

  it('keeps a row whose value only happens to equal the headline', () => {
    // Monthly available, nothing spent: available equals the headline amount,
    // so "Currently Available" repeats it; "Assigned This Month" is a different
    // fact with the same number and stays.
    const g = goal({});
    const finances = { available: 600_000, assigned: 600_000, activity: 0 };
    const progress = GoalCalculations.calculateProgress(g, finances, '2026-09');
    const labels = goalCardDetailItems(progress, 600_000).map((i) => i.label);
    expect(labels).toEqual(['Assigned This Month']);
  });

  it('keeps counts and percentages (streaks, success rate)', () => {
    const g = goal({ Purpose: GoalPurpose.SAVINGS, Type: GoalType.MONTHLY_SAVINGS });
    const finances = {
      available: 1_500_000,
      assigned: 700_000,
      activity: 0,
      historicalAssignments: [
        { month: '2026-07', amount: 700_000 },
        { month: '2026-08', amount: 700_000 },
      ],
    };
    const progress = GoalCalculations.calculateProgress(g, finances, '2026-09');
    const labels = goalCardDetailItems(progress, 700_000).map((i) => i.label);
    expect(labels).toContain('Success Rate');
    expect(labels).toContain('Total Saved');
    expect(labels).not.toContain('Monthly Target');
  });

  it('shows the recommendation only when it adds something', () => {
    const base = {
      percentage: 50,
      amountSaved: 0,
      amountNeeded: 0,
      monthlyTarget: 0,
      overfundedAmount: 0,
      isOnTrack: false,
      status: 'behind' as const,
      breakdown: { title: '', items: [], explanation: [] },
    };
    // Same amount twice.
    expect(
      goalRecommendationAddsInfo({
        ...base,
        isFunded: false,
        statusMessage: 'Need {{needed}} more available',
        statusValues: { needed: 43_000 },
        recommendation: 'Assign {{needed}} to reach your target',
        recommendationValues: { needed: 43_000 },
      })
    ).toBe(false);
    // A different amount: the rest of the plan.
    expect(
      goalRecommendationAddsInfo({
        ...base,
        isFunded: true,
        statusMessage: '{{assigned}} allocated this month — on track!',
        statusValues: { assigned: 100_000, needed: 900_000 },
        recommendation: 'On track — {{needed}} still needed over {{monthsMore}} more months.',
        recommendationValues: { assigned: 100_000, needed: 900_000, monthsMore: '3' },
      })
    ).toBe(true);
    // A plain sentence once the goal is met says nothing new.
    expect(
      goalRecommendationAddsInfo({
        ...base,
        isFunded: true,
        statusMessage: 'Target available!',
        recommendation: 'Target met — category is fully funded',
      })
    ).toBe(false);
    // A plain nudge while still short stays.
    expect(
      goalRecommendationAddsInfo({
        ...base,
        isFunded: false,
        statusMessage: 'Save {{needed}} more this month',
        statusValues: { needed: 10_000 },
        recommendation: 'Nearly there! Complete this month to maintain your streak',
      })
    ).toBe(true);
  });
});
