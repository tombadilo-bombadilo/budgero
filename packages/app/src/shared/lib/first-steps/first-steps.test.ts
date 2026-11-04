import { beforeEach, describe, expect, it } from 'vitest';
import {
  dismissFirstSteps,
  getFirstSteps,
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
      done: { assign: true, transaction: false, return: false },
    });
  });
});
