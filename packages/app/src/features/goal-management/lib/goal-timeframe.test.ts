import { describe, expect, it } from 'vitest';
import { GoalPurpose, GoalType, type Goal } from '@budgero/core/browser';
import { defaultGoalTimeframe, goalSaveAction } from './goal-timeframe';

const tf = (id: number, from: string, to: string | null = null): Goal => ({
  ID: id,
  Type: GoalType.MONTHLY,
  Purpose: GoalPurpose.SPENDING,
  CategoryID: 1,
  Target: 1000 as Goal['Target'],
  StartDate: `${from}-01`,
  EffectiveFrom: from,
  EffectiveTo: to,
});

describe('goal form timeframe choices', () => {
  it('a first goal is a plain create with no dates', () => {
    const choice = defaultGoalTimeframe(null, [], '2026-08');
    expect(choice).toEqual({ from: null, to: null });
    expect(goalSaveAction(null, [], choice, '2026-08')).toEqual({
      kind: 'create',
      effectiveFrom: null,
      effectiveTo: null,
    });
  });

  it('a goal in a gap after an ended one starts in the viewed month', () => {
    const ended = tf(1, '2026-01', '2026-03');
    const choice = defaultGoalTimeframe(null, [ended], '2026-06');
    expect(goalSaveAction(null, [ended], choice, '2026-06')).toEqual({
      kind: 'setFrom',
      from: '2026-06',
      to: null,
    });
  });

  it('a later month splits; the start month edits in place', () => {
    const goal = tf(1, '2026-01');
    expect(
      goalSaveAction(goal, [goal], defaultGoalTimeframe(goal, [goal], '2026-08'), '2026-08')
    ).toEqual({
      kind: 'setFrom',
      from: '2026-08',
      to: null,
    });
    expect(
      goalSaveAction(goal, [goal], defaultGoalTimeframe(goal, [goal], '2026-01'), '2026-01')
    ).toEqual({
      kind: 'update',
      effectiveFrom: '2026-01',
    });
  });

  it('a split keeps the end month of the goal it splits', () => {
    const goal = tf(1, '2026-01', '2026-12');
    expect(defaultGoalTimeframe(goal, [goal], '2026-08')).toEqual({
      from: '2026-08',
      to: '2026-12',
    });
  });

  it('changing only the end month rewrites the timeframe through setFrom', () => {
    const goal = tf(1, '2026-01');
    expect(goalSaveAction(goal, [goal], { from: '2026-01', to: '2026-05' }, '2026-01')).toEqual({
      kind: 'setFrom',
      from: '2026-01',
      to: '2026-05',
    });
  });
});
