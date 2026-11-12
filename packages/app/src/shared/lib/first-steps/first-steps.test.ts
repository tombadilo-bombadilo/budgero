import { beforeEach, describe, expect, it } from 'vitest';
import {
  getFirstSteps,
  hideFirstSteps,
  isFirstStepDone,
  isFirstStepsHidden,
  markFirstStep,
  noteFirstStepsMutation,
  noteFirstStepsVisit,
  resetFirstStepsForTests,
  setFirstStepsCollapsed,
  showFirstSteps,
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
    hideFirstSteps('space-1');
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

  it('reads a checklist stored before the goal step: goal not done', () => {
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
      everyCoin: true,
    });
    // Hidden with the goal step still open: shown again (see the migration below).
    expect(getFirstSteps('hidden')?.dismissed).toBe(false);
  });

  it('hides only when asked, and comes back with showFirstSteps', () => {
    startFirstSteps('space-1');
    expect(isFirstStepsHidden('space-1')).toBe(false);
    hideFirstSteps('space-1');
    expect(isFirstStepsHidden('space-1')).toBe(true);
    showFirstSteps('space-1');
    expect(isFirstStepsHidden('space-1')).toBe(false);
    // Survives a reload.
    resetFirstStepsForTests();
    expect(getFirstSteps('space-1')?.dismissed).toBe(false);
  });

  it('showing brings a folded list back unfolded', () => {
    startFirstSteps('space-1');
    setFirstStepsCollapsed('space-1', true);
    hideFirstSteps('space-1');
    showFirstSteps('space-1');
    expect(getFirstSteps('space-1')).toMatchObject({ dismissed: false, collapsed: false });
  });

  it('remembers a folded list, and folding is not hiding', () => {
    startFirstSteps('space-1');
    setFirstStepsCollapsed('space-1', true);
    resetFirstStepsForTests();
    expect(getFirstSteps('space-1')).toMatchObject({ collapsed: true, dismissed: false });
    expect(isFirstStepsHidden('space-1')).toBe(false);
  });

  it('never makes a list for a workspace that has none (demo, invited members, older budgets)', () => {
    showFirstSteps('space-1');
    setFirstStepsCollapsed('space-1', false);
    expect(getFirstSteps('space-1')).toBeNull();
    expect(isFirstStepsHidden('space-1')).toBe(false);
    expect(isFirstStepsHidden(null)).toBe(false);
    expect(localStorage.getItem('budgero:first-steps')).toBeNull();
  });
});

describe('lists hidden by the old ✕', () => {
  const all = { assign: true, goal: true, transaction: true, return: true };
  function stored(entries: Record<string, unknown>) {
    localStorage.setItem('budgero:first-steps', JSON.stringify(entries));
    resetFirstStepsForTests();
  }

  it('shows a list hidden before all steps were done again, once', () => {
    stored({
      unfinished: {
        startedOn: '2026-11-01',
        done: { ...all, transaction: false },
        dismissed: true,
      },
    });
    expect(getFirstSteps('unfinished')).toMatchObject({ dismissed: false, v: 3 });
    // Written back, so it isn't migrated again.
    expect(JSON.parse(localStorage.getItem('budgero:first-steps')!).unfinished.v).toBe(3);
    // Hidden again by the user now: it stays hidden.
    hideFirstSteps('unfinished');
    resetFirstStepsForTests();
    expect(getFirstSteps('unfinished')?.dismissed).toBe(true);
  });

  it('keeps a finished list that was closed closed', () => {
    stored({ finished: { startedOn: '2026-11-01', done: all, dismissed: true } });
    expect(getFirstSteps('finished')?.dismissed).toBe(true);
  });

  it('leaves visible lists and progress as they were', () => {
    const done = { ...all, return: false };
    stored({ open: { startedOn: '2026-11-01', done, dismissed: false } });
    expect(getFirstSteps('open')).toMatchObject({
      startedOn: '2026-11-01',
      done,
      dismissed: false,
    });
  });

  it('keeps every tick and adds no new ones when the order changed (version 3)', () => {
    const done = { assign: true, goal: false, transaction: true, return: false };
    stored({ mid: { startedOn: '2026-11-01', done, dismissed: false, v: 2 } });
    expect(getFirstSteps('mid')).toMatchObject({
      dismissed: false,
      v: 3,
      // Its first assignment was announced under the old rule.
      done: { ...done, everyCoin: true },
    });
    stored({
      fresh: { startedOn: '2026-11-01', done: { ...done, assign: false }, dismissed: true, v: 2 },
    });
    // Hidden on purpose (version 2 already had the labelled button): stays hidden.
    expect(getFirstSteps('fresh')).toMatchObject({ dismissed: true, done: { assign: false } });
    expect(getFirstSteps('fresh')?.done.everyCoin).toBeUndefined();
  });

  it('new lists start at the current version, so they are never migrated', () => {
    startFirstSteps('space-1');
    hideFirstSteps('space-1');
    resetFirstStepsForTests();
    expect(getFirstSteps('space-1')).toMatchObject({ dismissed: true, v: 3 });
  });
});
