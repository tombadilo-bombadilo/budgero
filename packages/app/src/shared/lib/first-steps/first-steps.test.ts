import { beforeEach, describe, expect, it } from 'vitest';
import {
  dismissFirstSteps,
  getFirstSteps,
  isFirstStepDone,
  markFirstStep,
  noteFirstStepsMutation,
  noteFirstStepsVisit,
  resetFirstStepsForTests,
  startFirstSteps,
} from './first-steps';

beforeEach(() => {
  localStorage.clear();
  resetFirstStepsForTests();
});

describe('first steps', () => {
  it('only tracks workspaces that started the checklist', () => {
    noteFirstStepsMutation('space-1', 'transactions.add');
    expect(getFirstSteps('space-1')).toBeNull();
  });

  it('ticks the transaction step for typed and imported transactions', () => {
    startFirstSteps('space-1');
    noteFirstStepsMutation('space-1', 'categories.create');
    expect(getFirstSteps('space-1')?.done.transaction).toBe(false);
    noteFirstStepsMutation('space-1', 'transactions.import');
    expect(getFirstSteps('space-1')?.done.transaction).toBe(true);
  });

  it('ticks "come back" only on a later day', () => {
    startFirstSteps('space-1', new Date(2026, 10, 3, 23, 50));
    noteFirstStepsVisit('space-1', new Date(2026, 10, 3, 23, 59));
    expect(getFirstSteps('space-1')?.done.return).toBe(false);
    noteFirstStepsVisit('space-1', new Date(2026, 10, 4, 0, 5));
    expect(getFirstSteps('space-1')?.done.return).toBe(true);
  });

  it('keeps progress across reloads and restarts', () => {
    startFirstSteps('space-1');
    markFirstStep('space-1', 'assign');
    dismissFirstSteps('space-1');
    resetFirstStepsForTests();
    startFirstSteps('space-1');
    expect(getFirstSteps('space-1')).toMatchObject({
      dismissed: true,
      done: { assign: true, goal: false, transaction: false, return: false },
    });
  });

  it('ticks the goal step when a goal is created', () => {
    startFirstSteps('space-1');
    noteFirstStepsMutation('space-1', 'goals.update');
    expect(getFirstSteps('space-1')?.done.goal).toBe(false);
    noteFirstStepsMutation('space-1', 'goals.create');
    expect(getFirstSteps('space-1')?.done.goal).toBe(true);
  });

  it('reads a checklist stored before the goal step: goal not done, dismissed stays', () => {
    localStorage.setItem(
      'budgero:first-steps',
      JSON.stringify({
        started: {
          startedOn: '2026-11-01',
          done: { assign: true, transaction: true, return: false },
          dismissed: false,
        },
        hidden: {
          startedOn: '2026-11-01',
          done: { assign: true, transaction: true, return: true },
          dismissed: true,
        },
      })
    );
    resetFirstStepsForTests();
    const started = getFirstSteps('started')!;
    expect(isFirstStepDone(started, 'goal')).toBe(false);
    expect(isFirstStepDone(started, 'assign')).toBe(true);
    noteFirstStepsMutation('started', 'goals.create');
    expect(getFirstSteps('started')?.done).toEqual({
      assign: true,
      transaction: true,
      return: false,
      goal: true,
    });
    expect(getFirstSteps('hidden')?.dismissed).toBe(true);
  });
});
