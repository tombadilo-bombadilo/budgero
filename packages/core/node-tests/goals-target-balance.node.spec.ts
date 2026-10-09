import { describe, expect, it } from 'vitest';
import { GoalCalculations, GoalPurpose, GoalType, type Goal } from '../src';

const goal: Goal = {
  ID: 1,
  Type: GoalType.TARGET_BALANCE,
  Purpose: GoalPurpose.SAVINGS,
  CategoryID: 5,
  Target: 1_000_000,
  StartDate: '2026-10-01',
  Recurring: false,
};

const progress = (available: number, assigned = 0, activity = 0) =>
  GoalCalculations.calculateProgress(goal, { available, assigned, activity }, '2026-10');

describe('target balance goal', () => {
  it('needs the gap between the target and what is available', () => {
    expect(progress(400_000)).toMatchObject({
      amountNeeded: 600_000,
      percentage: 40,
      isFunded: false,
      status: 'at-risk',
    });
  });

  it('is funded once the balance reaches the target, and spending reopens the gap', () => {
    expect(progress(1_000_000)).toMatchObject({
      amountNeeded: 0,
      isFunded: true,
      status: 'completed',
    });
    expect(progress(700_000, 0, -300_000)).toMatchObject({
      amountNeeded: 300_000,
      isFunded: false,
    });
  });

  it('includes an overspent deficit in what is needed', () => {
    expect(progress(-50_000)).toMatchObject({ amountNeeded: 1_050_000, status: 'overspent' });
  });

  it('reports the excess when over target', () => {
    expect(progress(1_200_000)).toMatchObject({ status: 'overfunded', overfundedAmount: 200_000 });
  });

  it('validates without a target date', () => {
    expect(GoalCalculations.validateGoal({ ...goal, TargetDate: undefined }).valid).toBe(true);
  });
});
