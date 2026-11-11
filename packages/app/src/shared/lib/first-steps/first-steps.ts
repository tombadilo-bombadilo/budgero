/**
 * The week-one checklist for a budget set up through "Fresh start", read as a
 * small lesson: give every coin a job, set a goal for one category, add a
 * transaction (or import one), come back another day, and (optional) invite
 * someone to budget with.
 *
 * Progress lives on this device only (localStorage, per workspace) and is
 * worked out from what happens in the app, never sent anywhere: the server
 * can't see budget data, so it couldn't do this anyway.
 */
import { useSyncExternalStore } from 'react';

export type FirstStepId = 'assign' | 'goal' | 'transaction' | 'return' | 'share';
export type CountedFirstStepId = Exclude<FirstStepId, 'share'>;

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
  };
  /** Hidden by the user (the ✕, or closing the finished list). */
  dismissed: boolean;
}

const KEY = 'budgero:first-steps';
/** The steps that count toward "x of 4 done", in the order they are taught. */
export const FIRST_STEP_IDS: CountedFirstStepId[] = ['assign', 'goal', 'transaction', 'return'];

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

function readAll(): Record<string, FirstStepsState> {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(KEY);
    cache = raw ? (JSON.parse(raw) as Record<string, FirstStepsState>) : {};
  } catch {
    cache = {};
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
    },
  });
}

export function markFirstStep(spaceId: string, step: FirstStepId): void {
  update(spaceId, (state) =>
    isFirstStepDone(state, step) ? state : { ...state, done: { ...state.done, [step]: true } }
  );
}

export function dismissFirstSteps(spaceId: string): void {
  update(spaceId, (state) => (state.dismissed ? state : { ...state, dismissed: true }));
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
