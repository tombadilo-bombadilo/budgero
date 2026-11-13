import { create } from 'zustand';

/**
 * First future-dated transaction in a budget. Recurring transactions are
 * explained by the Recurring page guide (features/page-guides).
 */
export type SchedulingGuideKind = 'future';

/** A guide asked for, before the open workspace's synced "seen" list has ruled on it. */
export interface SchedulingGuideRequest {
  kind: SchedulingGuideKind;
  spaceKey: string;
  budgetId: number;
}

interface SchedulingGuideState {
  /** Waiting for SchedulingGuideDialog to check it against the synced list. */
  request: SchedulingGuideRequest | null;
  /** Approved to show (not seen before); the dialog opens once no other dialog is. */
  pending: SchedulingGuideKind | null;
  /** Account the transaction belongs to. */
  accountId: number | null;
  /** One-shot request for the next register to extend its range 30 days ahead. */
  showUpcomingRequested: boolean;
  dismiss: () => void;
  requestShowUpcoming: () => void;
  consumeShowUpcoming: () => void;
}

export const useSchedulingGuideStore = create<SchedulingGuideState>()((set) => ({
  request: null,
  pending: null,
  accountId: null,
  showUpcomingRequested: false,
  dismiss: () => set({ request: null, pending: null }),
  requestShowUpcoming: () => set({ request: null, pending: null, showUpcomingRequested: true }),
  consumeShowUpcoming: () => set({ showUpcomingRequested: false }),
}));

const CACHE_PREFIX = 'budgero:scheduling-guide:';

/** Synced "seen" set (per user, in the open workspace): entry `<kind>:<budgetId>`. */
export const SCHEDULING_GUIDES_SEEN_KEY = 'schedulingGuidesSeen';

export const schedulingGuideEntry = (kind: SchedulingGuideKind, budgetId: number) =>
  `${kind}:${budgetId}`;

/** Device cache, also where "seen" lived before it synced: one key per workspace + budget. */
const cacheKey = (kind: SchedulingGuideKind, spaceKey: string, budgetId: number) =>
  `${CACHE_PREFIX}${kind}:${spaceKey}:${budgetId}`;

export function isSchedulingGuideCached(request: SchedulingGuideRequest): boolean {
  try {
    return Boolean(
      localStorage.getItem(cacheKey(request.kind, request.spaceKey, request.budgetId))
    );
  } catch {
    return false;
  }
}

export function cacheSchedulingGuideSeen(request: SchedulingGuideRequest): void {
  try {
    localStorage.setItem(cacheKey(request.kind, request.spaceKey, request.budgetId), '1');
  } catch {
    /* storage blocked: the synced list still has it */
  }
}

/** Synced entries this device has cached for a workspace. */
export function cachedSchedulingGuideEntries(spaceKey: string): string[] {
  const entries: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key?.startsWith(CACHE_PREFIX) || !localStorage.getItem(key)) continue;
      const [kind, space, budgetId] = key.slice(CACHE_PREFIX.length).split(':');
      if (kind !== 'future' || space !== spaceKey || !Number(budgetId)) continue;
      entries.push(schedulingGuideEntry(kind, Number(budgetId)));
    }
  } catch {
    /* storage blocked: nothing cached */
  }
  return entries;
}

/**
 * Asks for the guide for `kind` the first time it happens in a budget.
 * SchedulingGuideDialog shows it unless the user has seen it on any device
 * (synced list, or this device's cache).
 */
export function requestSchedulingGuide(
  kind: SchedulingGuideKind,
  spaceKey: string,
  budgetId: number,
  accountId: number | null = null
): void {
  if (!budgetId) return;
  const request = { kind, spaceKey, budgetId };
  if (isSchedulingGuideCached(request)) return;
  const { request: current, pending } = useSchedulingGuideStore.getState();
  if (pending || current) return;
  useSchedulingGuideStore.setState({ request, accountId });
}
