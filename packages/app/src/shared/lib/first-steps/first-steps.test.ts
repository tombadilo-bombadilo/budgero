import { beforeEach, describe, expect, it } from 'vitest';
import { setDemoSpaceId } from '@shared/lib/demo-space';
import { resetSyncedRuntime, syncedRuntime, syncedWrites } from '@/test/synced-runtime';
import {
  firstStepsLocalActions,
  getFirstSteps,
  hideFirstSteps,
  isFirstStepDone,
  isFirstStepsHidden,
  markFirstStep,
  migrateLegacyFirstSteps,
  noteFirstStepsLocalAction,
  noteFirstStepsMutation,
  noteFirstStepsVisit,
  resetFirstStepsForTests,
  setFirstStepsCollapsed,
  setFirstStepsUser,
  showFirstSteps,
  startFirstSteps,
} from './first-steps';

vi.mock('@shared/runtime/global', async () => (await import('@/test/synced-runtime')).globalMock());

const synced = (userId = 'u1') => syncedRuntime.store.get(`user:${userId}|firstSteps`);

beforeEach(() => {
  localStorage.clear();
  setDemoSpaceId(null);
  resetSyncedRuntime();
  resetFirstStepsForTests();
});

describe('first steps', () => {
  it('only tracks users who started the checklist', () => {
    setFirstStepsUser('space-1', 'u1');
    noteFirstStepsMutation('space-1', 'transactions.add');
    expect(getFirstSteps('space-1')).toBeNull();
    expect(syncedWrites()).toEqual([]);
  });

  it('starts in the user’s synced state, with one write', () => {
    startFirstSteps('space-1', 'u1', new Date(2026, 10, 3));
    expect(synced()).toEqual({ startedOn: '2026-11-03', version: 4 });
    expect(syncedWrites()).toHaveLength(1);
    startFirstSteps('space-1', 'u1', new Date(2026, 10, 4));
    expect(syncedWrites()).toHaveLength(1);
  });

  it('ticks the transaction step for typed and imported transactions', () => {
    startFirstSteps('space-1', 'u1');
    noteFirstStepsMutation('space-1', 'categories.create');
    expect(getFirstSteps('space-1')?.done.transaction).toBe(false);
    noteFirstStepsMutation('space-1', 'transactions.import');
    expect(getFirstSteps('space-1')?.done.transaction).toBe(true);
    expect(synced()).toMatchObject({ transaction: true });
    // Once is enough.
    noteFirstStepsMutation('space-1', 'transactions.add');
    expect(syncedWrites()).toHaveLength(2);
  });

  it('ticks "come back" only on a later day', () => {
    startFirstSteps('space-1', 'u1', new Date(2026, 10, 3, 23, 50));
    noteFirstStepsVisit('space-1', new Date(2026, 10, 3, 23, 59));
    expect(getFirstSteps('space-1')?.done.return).toBe(false);
    noteFirstStepsVisit('space-1', new Date(2026, 10, 4, 0, 5));
    expect(getFirstSteps('space-1')?.done.return).toBe(true);
  });

  it('keeps progress across reloads and cleared site data', () => {
    startFirstSteps('space-1', 'u1');
    markFirstStep('space-1', 'assign');
    hideFirstSteps('space-1');
    localStorage.clear();
    resetFirstStepsForTests();
    setFirstStepsUser('space-1', 'u1');
    expect(getFirstSteps('space-1')).toMatchObject({
      dismissed: true,
      done: { assign: true, goal: false, transaction: false, return: false },
    });
  });

  it('ticks the goal step when a goal is created', () => {
    startFirstSteps('space-1', 'u1');
    noteFirstStepsMutation('space-1', 'goals.update');
    expect(getFirstSteps('space-1')?.done.goal).toBe(false);
    noteFirstStepsMutation('space-1', 'goals.create');
    expect(getFirstSteps('space-1')?.done.goal).toBe(true);
  });

  it('hides only when asked, and comes back with showFirstSteps', () => {
    startFirstSteps('space-1', 'u1');
    expect(isFirstStepsHidden('space-1')).toBe(false);
    hideFirstSteps('space-1');
    expect(isFirstStepsHidden('space-1')).toBe(true);
    showFirstSteps('space-1');
    expect(isFirstStepsHidden('space-1')).toBe(false);
    expect(synced()).toMatchObject({ dismissed: false });
  });

  it('showing brings a folded list back unfolded', () => {
    startFirstSteps('space-1', 'u1');
    setFirstStepsCollapsed('space-1', true);
    hideFirstSteps('space-1');
    showFirstSteps('space-1');
    expect(getFirstSteps('space-1')).toMatchObject({ dismissed: false, collapsed: false });
  });

  it('remembers a folded list on this device only, and folding is not hiding', () => {
    startFirstSteps('space-1', 'u1');
    const writes = syncedWrites().length;
    setFirstStepsCollapsed('space-1', true);
    expect(syncedWrites()).toHaveLength(writes);
    resetFirstStepsForTests();
    setFirstStepsUser('space-1', 'u1');
    expect(getFirstSteps('space-1')).toMatchObject({ collapsed: true, dismissed: false });
    expect(isFirstStepsHidden('space-1')).toBe(false);
  });

  it('never makes a list for a user who has none (demo, invited members, older budgets)', () => {
    setFirstStepsUser('space-1', 'u1');
    showFirstSteps('space-1');
    hideFirstSteps('space-1');
    setFirstStepsCollapsed('space-1', false);
    markFirstStep('space-1', 'share');
    expect(getFirstSteps('space-1')).toBeNull();
    expect(isFirstStepsHidden('space-1')).toBe(false);
    expect(isFirstStepsHidden(null)).toBe(false);
    expect(syncedWrites()).toEqual([]);
  });

  it('writes nothing in the demo', () => {
    setDemoSpaceId('space-1');
    startFirstSteps('space-1', 'u1');
    noteFirstStepsMutation('space-1', 'transactions.add');
    expect(syncedWrites()).toEqual([]);
  });

  it('keeps two members of one workspace apart', () => {
    startFirstSteps('space-1', 'u1');
    hideFirstSteps('space-1');
    setFirstStepsUser('space-1', 'u2');
    expect(getFirstSteps('space-1')).toBeNull();
    startFirstSteps('space-1', 'u2');
    expect(getFirstSteps('space-1')?.dismissed).toBe(false);
    setFirstStepsUser('space-1', 'u1');
    expect(getFirstSteps('space-1')?.dismissed).toBe(true);
  });

  it('counts the user’s own changes, not its bookkeeping writes', () => {
    const before = firstStepsLocalActions();
    noteFirstStepsLocalAction('syncedState.merge');
    noteFirstStepsLocalAction('pageGuides.markSeen');
    expect(firstStepsLocalActions()).toBe(before);
    noteFirstStepsLocalAction('budgets.assign');
    expect(firstStepsLocalActions()).toBe(before + 1);
  });
});

describe('a checklist kept only on this device', () => {
  const all = { assign: true, goal: true, transaction: true, return: true };
  function stored(entries: Record<string, unknown>) {
    localStorage.setItem('budgero:first-steps', JSON.stringify(entries));
    resetFirstStepsForTests();
  }
  const legacy = () => JSON.parse(localStorage.getItem('budgero:first-steps')!)['space-1'];

  it('moves into the synced state with one write, and is dropped here', () => {
    stored({
      'space-1': {
        startedOn: '2026-11-01',
        done: { ...all, return: false },
        dismissed: false,
        collapsed: true,
        v: 3,
      },
    });
    migrateLegacyFirstSteps('space-1', 'u1');
    expect(syncedWrites()).toHaveLength(1);
    expect(synced()).toEqual({
      startedOn: '2026-11-01',
      version: 4,
      assign: true,
      goal: true,
      transaction: true,
    });
    expect(legacy()).toBeUndefined();
    setFirstStepsUser('space-1', 'u1');
    expect(getFirstSteps('space-1')).toMatchObject({ collapsed: true, dismissed: false });
    migrateLegacyFirstSteps('space-1', 'u1');
    expect(syncedWrites()).toHaveLength(1);
  });

  it('adds only what the synced state lacks', () => {
    syncedRuntime.store.set('user:u1|firstSteps', {
      startedOn: '2026-10-30',
      version: 4,
      goal: true,
      dismissed: false,
    });
    stored({
      'space-1': {
        startedOn: '2026-11-01',
        done: { assign: false, goal: true, transaction: true, return: false },
        dismissed: true,
        v: 3,
      },
    });
    migrateLegacyFirstSteps('space-1', 'u1');
    // Shown again on another device later than it was hidden here: stays shown.
    expect(syncedWrites()[0].payload.patch).toEqual({ set: { transaction: true } });
    // Nothing to add: no write, but still dropped.
    stored({ 'space-1': { startedOn: '2026-11-01', done: all, dismissed: false, v: 3 } });
    syncedRuntime.store.set('user:u1|firstSteps', { startedOn: '2026-11-01', version: 4, ...all });
    migrateLegacyFirstSteps('space-1', 'u1');
    expect(syncedWrites()).toHaveLength(1);
    expect(legacy()).toBeUndefined();
  });

  it('is left for the owner: a member opening it on the same device does not take it', () => {
    stored({ 'space-1': { startedOn: '2026-11-01', done: all, dismissed: false, v: 3 } });
    syncedRuntime.role = 'editor';
    migrateLegacyFirstSteps('space-1', 'u2');
    expect(syncedWrites()).toEqual([]);
    expect(legacy()).toBeDefined();
  });

  it('stays until it can be written (demo, store not ready)', () => {
    stored({ 'space-1': { startedOn: '2026-11-01', done: all, dismissed: false, v: 3 } });
    setDemoSpaceId('space-1');
    migrateLegacyFirstSteps('space-1', 'u1');
    expect(syncedWrites()).toEqual([]);
    expect(legacy()).toBeDefined();
  });

  it('started without a user id, it is written when the owner opens the app', () => {
    startFirstSteps('space-1', null, new Date(2026, 10, 3));
    expect(syncedWrites()).toEqual([]);
    migrateLegacyFirstSteps('space-1', 'u1');
    expect(synced()).toEqual({ startedOn: '2026-11-03', version: 4 });
  });
});

describe('older device-only lists (migrated before they are moved)', () => {
  const all = { assign: true, goal: true, transaction: true, return: true };
  function moved(entries: Record<string, unknown>, spaceId: string) {
    localStorage.setItem('budgero:first-steps', JSON.stringify(entries));
    resetFirstStepsForTests();
    syncedRuntime.spaceId = spaceId;
    syncedRuntime.store.clear();
    migrateLegacyFirstSteps(spaceId, 'u1');
    setFirstStepsUser(spaceId, 'u1');
    return getFirstSteps(spaceId);
  }

  it('reads a checklist stored before the goal step: goal not done', () => {
    const started = moved(
      {
        started: {
          startedOn: '2026-11-01',
          done: { assign: true, transaction: true, return: false },
          dismissed: false,
        },
      },
      'started'
    )!;
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
  });

  it('shows a list hidden by the old ✕ before all steps were done again', () => {
    const state = moved(
      {
        unfinished: {
          startedOn: '2026-11-01',
          done: { ...all, transaction: false },
          dismissed: true,
        },
      },
      'unfinished'
    );
    expect(state?.dismissed).toBe(false);
  });

  it('keeps a finished list that was closed closed', () => {
    const state = moved(
      { finished: { startedOn: '2026-11-01', done: all, dismissed: true } },
      'finished'
    );
    expect(state?.dismissed).toBe(true);
  });

  it('keeps every tick and adds no new ones when the order changed (version 3)', () => {
    const done = { assign: true, goal: false, transaction: true, return: false };
    expect(
      moved({ mid: { startedOn: '2026-11-01', done, dismissed: false, v: 2 } }, 'mid')
    ).toMatchObject({
      dismissed: false,
      // Its first assignment was announced under the old rule.
      done: { ...done, everyCoin: true },
    });
    const fresh = moved(
      {
        fresh: { startedOn: '2026-11-01', done: { ...done, assign: false }, dismissed: true, v: 2 },
      },
      'fresh'
    );
    // Hidden on purpose (version 2 already had the labelled button): stays hidden.
    expect(fresh).toMatchObject({ dismissed: true, done: { assign: false } });
    expect(fresh?.done.everyCoin).toBeUndefined();
  });
});
