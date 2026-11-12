/**
 * The week-one checklist for a budget set up through "Fresh start", read as a
 * small lesson: set a goal for one category, assign money to fund it, add a
 * transaction (or import one), come back another day, and (optional) invite
 * someone to budget with.
 *
 * Progress lives on this device only (localStorage, per workspace) and is
 * worked out from what happens in the app, never sent anywhere: the server
 * can't see budget data, so it couldn't do this anyway.
 */
import { useSyncExternalStore } from 'react';

export type FirstStepId = 'assign' | 'goal' | 'transaction' | 'return' | 'share' | 'everyCoin';
/** `share` (optional) and `everyCoin` (Ready to Assign reached 0, announced once) don't count. */
export type CountedFirstStepId = Exclude<FirstStepId, 'share' | 'everyCoin'>;

export interface FirstStepsState {
  /** Local calendar day the checklist started (YYYY-MM-DD). */
  startedOn: string;
  /**
   * `share` is optional: it isn't counted in FIRST_STEP_IDS. `goal` came later,
   * so a checklist stored before it has no key for it (read as not done).
   */
  done: Record<Exclude<CountedFirstStepId, 'goal'>, boolean> & {
    goal?: boolean;
    share?: boolean;
    everyCoin?: boolean;
  };
  /**
   * Hidden on purpose: "Hide first steps", or Close on the finished list.
   * Nothing else sets it (closing a drawer or a dialog never does), and
   * showFirstSteps() brings the list back.
   */
  dismissed: boolean;
  /** Desktop card folded to one row. Still there, just small. */
  collapsed?: boolean;
  /**
   * Storage version. Until 2 a bare ✕ (on the phone, in the drawer where it
   * reads as "close this sheet") hid the list for good; see migrate().
   */
  v?: number;
}

const KEY = 'budgero:first-steps';
/**
 * The steps that count toward "x of 4 done", in the order they are taught:
 * a goal first, then money to fund it. Stored lists keep their ticks; they
 * just show in this order.
 */
export const FIRST_STEP_IDS: CountedFirstStepId[] = ['goal', 'assign', 'transaction', 'return'];

export function isFirstStepDone(state: FirstStepsState, step: FirstStepId): boolean {
  return state.done[step] ?? false;
}

/** Ops that put a transaction in the budget, typed or imported. */
const TRANSACTION_OPS = new Set([
  'transactions.add',
  'transactions.addTransfer',
  'transactions.import',
]);
/** Ops that give a category a goal (goals.restore is only undo). */
const GOAL_OPS = new Set(['goals.create']);

const listeners = new Set<() => void>();
let cache: Record<string, FirstStepsState> | null = null;

function today(now = new Date()): string {
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${m}-${d}`;
}

const VERSION = 3;

function allCountedDone(state: FirstStepsState): boolean {
  return FIRST_STEP_IDS.every((id) => isFirstStepDone(state, id));
}

/**
 * Before version 2 a bare ✕ hid the list: one hidden before all steps were
 * done was most likely closed by accident, so it shows once more (a finished
 * one that was closed stays closed). Before version 3 "assign" was only
 * ticked once Ready to Assign reached 0, which was announced then, so a
 * ticked one isn't announced again.
 */
function migrate(all: Record<string, FirstStepsState>): Record<string, FirstStepsState> | null {
  let changed = false;
  const next: Record<string, FirstStepsState> = {};
  for (const [spaceId, state] of Object.entries(all)) {
    if (!state || typeof state !== 'object' || (state.v ?? 0) >= VERSION) {
      next[spaceId] = state;
      continue;
    }
    changed = true;
    const v = state.v ?? 0;
    next[spaceId] = {
      ...state,
      dismissed: v < 2 ? state.dismissed && allCountedDone(state) : state.dismissed,
      done:
        state.done?.assign && state.done.everyCoin === undefined
          ? { ...state.done, everyCoin: true }
          : state.done,
      v: VERSION,
    };
  }
  return changed ? next : null;
}

function readAll(): Record<string, FirstStepsState> {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(KEY);
    cache = raw ? (JSON.parse(raw) as Record<string, FirstStepsState>) : {};
  } catch {
    cache = {};
  }
  const migrated = migrate(cache);
  if (migrated) {
    cache = migrated;
    try {
      localStorage.setItem(KEY, JSON.stringify(migrated));
    } catch {
      /* storage blocked: migrate again next time */
    }
  }
  return cache;
}

function writeAll(next: Record<string, FirstStepsState>): void {
  cache = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage blocked: progress lasts for this visit */
  }
  for (const listener of listeners) listener();
}

function update(spaceId: string, change: (state: FirstStepsState) => FirstStepsState): void {
  const all = readAll();
  const current = all[spaceId];
  if (!current) return;
  const next = change(current);
  if (next === current) return;
  writeAll({ ...all, [spaceId]: next });
}

/** Start the checklist for a workspace just set up from scratch. */
export function startFirstSteps(spaceId: string, now = new Date()): void {
  const all = readAll();
  if (all[spaceId]) return;
  writeAll({
    ...all,
    [spaceId]: {
      startedOn: today(now),
      done: { assign: false, goal: false, transaction: false, return: false },
      dismissed: false,
      v: VERSION,
    },
  });
}

export function markFirstStep(spaceId: string, step: FirstStepId): void {
  update(spaceId, (state) =>
    isFirstStepDone(state, step) ? state : { ...state, done: { ...state.done, [step]: true } }
  );
}

/** The user's own "Hide first steps" (or Close on the finished list). */
export function hideFirstSteps(spaceId: string): void {
  update(spaceId, (state) => (state.dismissed ? state : { ...state, dismissed: true }));
}

/** Bring a hidden list back, unfolded. */
export function showFirstSteps(spaceId: string): void {
  update(spaceId, (state) =>
    state.dismissed || state.collapsed ? { ...state, dismissed: false, collapsed: false } : state
  );
}

/** True only for a list this workspace started and the user hid. */
export function isFirstStepsHidden(spaceId: string | null): boolean {
  return getFirstSteps(spaceId)?.dismissed ?? false;
}

export function setFirstStepsCollapsed(spaceId: string, collapsed: boolean): void {
  update(spaceId, (state) =>
    (state.collapsed ?? false) === collapsed ? state : { ...state, collapsed }
  );
}

/** Called for every local mutation (AppRuntime.executeMutation). */
export function noteFirstStepsMutation(spaceId: string | null, op: string): void {
  if (!spaceId) return;
  if (TRANSACTION_OPS.has(op)) markFirstStep(spaceId, 'transaction');
  else if (GOAL_OPS.has(op)) markFirstStep(spaceId, 'goal');
}

/** Opening the budget on a later day than setup ticks "come back". */
export function noteFirstStepsVisit(spaceId: string, now = new Date()): void {
  update(spaceId, (state) =>
    !state.done.return && today(now) > state.startedOn
      ? { ...state, done: { ...state.done, return: true } }
      : state
  );
}

export function getFirstSteps(spaceId: string | null): FirstStepsState | null {
  return spaceId ? (readAll()[spaceId] ?? null) : null;
}

// Another tab ticking a step (or hiding the list) shows up here too.
function onStorage(event: StorageEvent): void {
  if (event.key !== KEY && event.key !== null) return;
  cache = null;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0 && typeof window !== 'undefined') {
    window.addEventListener('storage', onStorage);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && typeof window !== 'undefined') {
      window.removeEventListener('storage', onStorage);
    }
  };
}

export function useFirstSteps(spaceId: string | null): FirstStepsState | null {
  return useSyncExternalStore(
    subscribe,
    () => getFirstSteps(spaceId),
    () => null
  );
}

/** Test hook. */
export function resetFirstStepsForTests(): void {
  cache = null;
  listeners.clear();
  if (typeof window !== 'undefined') window.removeEventListener('storage', onStorage);
}
