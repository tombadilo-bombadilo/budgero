/**
 * The first-steps goal walkthrough: a few cards on the real Budget page that
 * walk someone through their first goal. Pick a category (their own click),
 * read what the goal types mean, press Create Goal (their own press), fill
 * in the form, then fund it.
 *
 * The transitions are one pure function (goalWalkthrough), unit-tested; the
 * small store around it lives for this session only.
 */
import { useSyncExternalStore } from 'react';
import { useUiStore } from '@shared/store/useUiStore';

export interface PickedCategory {
  id: number;
  name: string;
  hasGoal: boolean;
}

export type GoalWalkthroughState =
  | { step: 'closed' }
  /** `taken`: the category they picked already has a goal. */
  | { step: 'pick'; taken?: string }
  | { step: 'types'; categoryId: number; categoryName: string }
  | { step: 'create'; categoryId: number; categoryName: string }
  | { step: 'form'; categoryId: number; categoryName: string }
  | { step: 'saved'; categoryId: number; categoryName: string };

export type GoalWalkthroughEvent =
  /** "Show me". `selected`: the category already selected, if any. */
  | { type: 'start'; selected: PickedCategory | null }
  /** The selection on the page changed (null: nothing, or several, selected). */
  | { type: 'select'; selected: PickedCategory | null }
  | { type: 'next' }
  | { type: 'formOpened'; categoryId: number }
  | { type: 'formClosed'; categoryId: number }
  | { type: 'goalSaved'; categoryId: number }
  | { type: 'close' };

export const CLOSED: GoalWalkthroughState = { step: 'closed' };

/** Where a picked category takes the walkthrough: on to the types, or ask again. */
function picked(selected: PickedCategory | null): GoalWalkthroughState {
  if (!selected) return { step: 'pick' };
  if (selected.hasGoal) return { step: 'pick', taken: selected.name };
  return { step: 'types', categoryId: selected.id, categoryName: selected.name };
}

export function goalWalkthrough(
  state: GoalWalkthroughState,
  event: GoalWalkthroughEvent
): GoalWalkthroughState {
  if (event.type === 'close') return CLOSED;
  if (event.type === 'start') return picked(event.selected);
  switch (state.step) {
    case 'closed':
      return state;
    case 'pick':
      if (event.type !== 'select') return state;
      // Deselecting keeps the question as it was.
      return event.selected ? picked(event.selected) : state;
    case 'types':
    case 'create': {
      if (event.type === 'select') {
        if (!event.selected) return { step: 'pick' };
        if (event.selected.id === state.categoryId) return state;
        // Another category: follow it (or ask again if it has a goal).
        const next = picked(event.selected);
        return next.step === 'types' && state.step === 'create'
          ? { ...next, step: 'create' }
          : next;
      }
      if (event.type === 'next' && state.step === 'types') return { ...state, step: 'create' };
      if (event.type === 'formOpened' && event.categoryId === state.categoryId)
        return { ...state, step: 'form' };
      if (event.type === 'goalSaved' && event.categoryId === state.categoryId)
        return { ...state, step: 'saved' };
      return state;
    }
    case 'form':
      if (event.type === 'goalSaved' && event.categoryId === state.categoryId)
        return { ...state, step: 'saved' };
      // Closed without saving: back to "Press Create Goal".
      if (event.type === 'formClosed' && event.categoryId === state.categoryId)
        return { ...state, step: 'create' };
      return state;
    case 'saved':
      return state;
  }
}

// ---------------------------------------------------------------------------
// Session store
// ---------------------------------------------------------------------------

let current: GoalWalkthroughState = CLOSED;
const listeners = new Set<() => void>();

export function dispatchGoalWalkthrough(event: GoalWalkthroughEvent): void {
  const next = goalWalkthrough(current, event);
  if (next === current) return;
  current = next;
  for (const listener of listeners) listener();
}

let onEnd: (() => void) | null = null;

/**
 * "Show me" on the goal step. `onEnd` runs once when the walkthrough ends
 * (e.g. unfold the checklist it folded away).
 */
export function startGoalWalkthrough(selected: PickedCategory | null, end?: () => void): void {
  if (current.step === 'closed') onEnd = end ?? null;
  dispatchGoalWalkthrough({ type: 'start', selected });
}

/** ✕, Esc, Done or "Fund it": close and clear what the walkthrough highlighted. */
export function closeGoalWalkthrough(): void {
  const state = current;
  dispatchGoalWalkthrough({ type: 'close' });
  if ('categoryId' in state) {
    const ui = useUiStore.getState();
    if (ui.highlightGoalCategoryId === state.categoryId) ui.setHighlightGoalCategoryId(null);
  }
  const end = onEnd;
  onEnd = null;
  end?.();
}

export function getGoalWalkthrough(): GoalWalkthroughState {
  return current;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useGoalWalkthrough(): GoalWalkthroughState {
  return useSyncExternalStore(subscribe, getGoalWalkthrough, getGoalWalkthrough);
}

/** The goal form for `categoryId` is open as part of the walkthrough (shows its hint). */
export function useGoalWalkthroughFormHint(categoryId: number): boolean {
  const state = useGoalWalkthrough();
  return state.step === 'form' && state.categoryId === categoryId;
}

/** Test hook. */
export function resetGoalWalkthroughForTests(): void {
  current = CLOSED;
  onEnd = null;
  listeners.clear();
}
