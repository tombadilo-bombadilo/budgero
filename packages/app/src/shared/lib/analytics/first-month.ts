/**
 * First-month analytics: how a new user's first 30 days go, without reading
 * any budget data. Everything here is derived from events the app already
 * tracks (observeTrackedEvents) plus the signup date from the profile.
 *
 * - app_opened: once per calendar day per device, with days since signup.
 * - activation_milestone: the first transaction, assignment, import and
 *   Ready to Assign reaching zero, once each per user: the milestones sent are
 *   kept in the workspace's synced state too (user scope, merged set), so a
 *   second device doesn't send them again. Per workspace like all synced
 *   state: a device that has never seen the milestone and opens another
 *   workspace can still repeat it.
 * - session_summary: once per visit, the visit's length and rough counts. A
 *   visit ends at pagehide or when the tab has been hidden for 30 minutes.
 *
 * Nothing is sent after day 30, and nothing done in the onboarding demo
 * budget counts. The keys in localStorage hold only dates, milestone names
 * and count buckets, never budget data. app_opened's day and the parked
 * summary stay on the device: the first is a daily analytics counter (syncing
 * it would write the database on every day's first open), the second is this
 * device's unfinished visit. The de-duplication keys are kept
 * across sign-out (see sign-out-preserved.ts) so signing in again doesn't
 * repeat a day's app_opened or a milestone.
 */
import { useEffect } from 'react';
import { getDemoSpaceId } from '@shared/lib/demo-space';
import { getRuntime } from '@shared/runtime/global';
import {
  mergeSyncedState,
  readSyncedState,
  userScope,
} from '@shared/lib/synced-state/synced-state';
import {
  countBucket,
  durationBucket,
  type ActivationMilestone,
  type AnalyticsEventName,
  type EmptyStateScreen,
  type SignupDayBucket,
} from './events';
import { observeTrackedEvents, track, trackOnUnload } from './track';

const DAY_MS = 86_400_000;
const LAST_DAYS = 30;
const OPENED_KEY = 'budgero:fm-opened';
/** Device cache of the milestones sent, per user; the synced copy is SYNCED_MILESTONES_KEY. */
const MILESTONES_KEY = 'budgero:fm-milestones';
/** Synced state key (user scope): the milestones sent, as a set {milestone: true}. */
export const SYNCED_MILESTONES_KEY = 'firstMonthMilestones';
/** The summary of a visit whose tab is hidden, in case it never comes back. */
const PENDING_SUMMARY_KEY = 'budgero:fm-pending-summary';
/** A tab hidden this long has ended its visit; coming back starts a new one. */
const VISIT_GAP_MS = 30 * 60_000;

/** Entries a person typed in, as opposed to imports, bank sync and automation. */
const MANUAL_ENTRIES = new Set([
  'inline',
  'dialog',
  'mobile_dialog',
  'command_palette',
  'receipt_scan',
  'ai_assistant',
]);

let userId: string | null = null;
let signedUpAt: number | null = null;
let sessionStart = Date.now();
let transactions = 0;
let assignments = 0;
let imported = false;
let summarySent = false;
let hiddenAt: number | null = null;
let started = false;
let stopObserving: (() => void) | null = null;
const emptyStatesSeen = new Set<EmptyStateScreen>();
/** workspace|user|milestone already in the synced set: skips re-reading it on every assign. */
const syncedMilestones = new Set<string>();

function localDay(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/** Calendar days since signup in local time, or null outside the first month. */
export function daysSinceSignup(now = Date.now()): number | null {
  if (signedUpAt === null) return null;
  const start = new Date(signedUpAt);
  start.setHours(0, 0, 0, 0);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const days = Math.round((today.getTime() - start.getTime()) / DAY_MS);
  return days >= 0 && days <= LAST_DAYS ? days : null;
}

export function signupDayBucket(days: number): SignupDayBucket {
  if (days <= 3) return String(days) as SignupDayBucket;
  if (days <= 7) return '4-7';
  if (days <= 14) return '8-14';
  return '15-30';
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or blocked: at worst an event repeats */
  }
}

function reportAppOpened(): void {
  const days = daysSinceSignup();
  if (days === null || !userId) return;
  const seen = readJson<Record<string, string>>(OPENED_KEY, {});
  const today = localDay(Date.now());
  if (seen[userId] === today) return;
  writeJson(OPENED_KEY, { ...seen, [userId]: today });
  track('app_opened', { day: signupDayBucket(days) });
}

function activeSpaceId(): string | null {
  try {
    return getRuntime()?.getActiveSpaceId() ?? null;
  } catch {
    return null;
  }
}

function reachMilestone(milestone: ActivationMilestone): void {
  const days = daysSinceSignup();
  if (days === null || !userId) return;
  const all = readJson<Record<string, string[]>>(MILESTONES_KEY, {});
  const mine = all[userId] ?? [];
  const spaceId = activeSpaceId();
  const confirmed = `${spaceId}|${userId}|${milestone}`;
  if (mine.includes(milestone) && syncedMilestones.has(confirmed)) return;

  const scope = userScope(userId);
  const synced = readSyncedState<Record<string, unknown>>(scope, SYNCED_MILESTONES_KEY);
  const elsewhere =
    synced.value && typeof synced.value === 'object' ? Object.keys(synced.value) : [];
  const known = new Set([...mine, ...elsewhere]);
  if (!known.has(milestone)) {
    track('activation_milestone', { milestone, day: signupDayBucket(days) });
    known.add(milestone);
  }
  if (known.size !== mine.length) writeJson(MILESTONES_KEY, { ...all, [userId]: [...known] });
  if (!synced.available) return;
  // One write with what only this device knows (incl. milestones sent before they synced).
  const missing = [...known].filter((m) => !elsewhere.includes(m));
  if (missing.length === 0) {
    syncedMilestones.add(confirmed);
    return;
  }
  void mergeSyncedState(scope, SYNCED_MILESTONES_KEY, {
    set: Object.fromEntries(missing.map((m) => [m, true])),
  })
    .then((sent) => {
      if (sent) syncedMilestones.add(confirmed);
    })
    .catch(() => {
      /* the cache has it; the next milestone event writes again */
    });
}

/** The open workspace is the onboarding demo: nothing done there is the user's own. */
function inDemoBudget(): boolean {
  const demoSpaceId = getDemoSpaceId();
  return Boolean(demoSpaceId) && activeSpaceId() === demoSpaceId;
}

function onTracked(name: AnalyticsEventName, props: Record<string, string>): void {
  if (inDemoBudget()) return;
  if (name === 'Transaction Logged') {
    transactions += 1;
    if (MANUAL_ENTRIES.has(props.entry)) reachMilestone('first_transaction');
  } else if (name === 'Assignment Upserted') {
    assignments += 1;
    reachMilestone('first_assign');
  } else if (name === 'import_finished' && props.outcome === 'ok') {
    imported = true;
    reachMilestone('first_import');
  }
}

/**
 * Ready to Assign as shown in the toolbar. Reaching exactly zero right after
 * assigning money in this visit is the "every coin has a job" moment; a zero
 * on an empty budget is not. `ready` is false while the number is a loading
 * default or the previous month's placeholder.
 */
export function noteReadyToAssign(value: number, ready = true): void {
  if (!ready || inDemoBudget()) return;
  if (value === 0 && assignments > 0) reachMilestone('rta_zero');
}

type SummaryProps = {
  day: SignupDayBucket;
  duration_bucket: ReturnType<typeof durationBucket>;
  transactions_bucket: ReturnType<typeof countBucket>;
  assignments_bucket: ReturnType<typeof countBucket>;
  imported: 'yes' | 'no';
};

function summaryProps(until = Date.now()): SummaryProps | null {
  const days = daysSinceSignup();
  if (days === null) return null;
  return {
    day: signupDayBucket(days),
    duration_bucket: durationBucket(until - sessionStart),
    transactions_bucket: countBucket(transactions),
    assignments_bucket: countBucket(assignments),
    imported: imported ? 'yes' : 'no',
  };
}

function clearPendingSummary(): void {
  try {
    localStorage.removeItem(PENDING_SUMMARY_KEY);
  } catch {
    /* nothing stored then */
  }
}

/** Sends the summary of a visit that ended while its tab was hidden. */
function flushPendingSummary(): void {
  const pending = readJson<{ user?: string; props?: SummaryProps } | null>(
    PENDING_SUMMARY_KEY,
    null
  );
  if (!pending) return;
  clearPendingSummary();
  if (pending.user && pending.user === userId && pending.props) {
    track('session_summary', pending.props);
  }
}

function startVisit(): void {
  sessionStart = Date.now();
  transactions = 0;
  assignments = 0;
  imported = false;
  summarySent = false;
  hiddenAt = null;
  emptyStatesSeen.clear();
}

function onPageHide(): void {
  if (summarySent) return;
  // The visit ended when the tab was hidden, if it was.
  const props = summaryProps(hiddenAt ?? Date.now());
  clearPendingSummary();
  if (!props) return;
  summarySent = true;
  trackOnUnload('session_summary', props);
}

function onPageShow(event: PageTransitionEvent): void {
  // Back from the back/forward cache: the page lives on as a new visit.
  if (event.persisted && summarySent) {
    startVisit();
    reportAppOpened();
  }
}

function onVisibilityChange(): void {
  if (document.visibilityState === 'hidden') {
    // A hidden tab may never run code again (mobile browsers skip pagehide),
    // so the visit so far is parked in storage. Coming back soon drops it;
    // otherwise it is sent when the tab returns or the app is next opened.
    hiddenAt = Date.now();
    const props = summarySent ? null : summaryProps(hiddenAt);
    if (props && userId) writeJson(PENDING_SUMMARY_KEY, { user: userId, props });
    return;
  }
  const away = hiddenAt === null ? 0 : Date.now() - hiddenAt;
  hiddenAt = null;
  if (away >= VISIT_GAP_MS) {
    flushPendingSummary();
    startVisit();
    reportAppOpened();
  } else {
    clearPendingSummary();
  }
}

/**
 * Called with the signed-in user (AnalyticsGate). Starts listening once; a
 * different user resets the visit counters.
 */
export function setFirstMonthUser(id: string | null, createdAt: string | null | undefined): void {
  const parsed = createdAt ? Date.parse(createdAt) : NaN;
  const changed = id !== userId;
  userId = id;
  signedUpAt = Number.isFinite(parsed) ? parsed : null;
  if (!id || signedUpAt === null) return;
  if (changed) startVisit();
  if (!started && typeof window !== 'undefined') {
    started = true;
    // A visit that ended in a hidden tab (closed or killed there).
    flushPendingSummary();
    stopObserving = observeTrackedEvents(onTracked);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('pageshow', onPageShow);
    document.addEventListener('visibilitychange', onVisibilityChange);
  }
  reportAppOpened();
}

/** Test hook: forget the user and stop listening. */
export function resetFirstMonthForTests(): void {
  stopObserving?.();
  stopObserving = null;
  if (started && typeof window !== 'undefined') {
    window.removeEventListener('pagehide', onPageHide);
    window.removeEventListener('pageshow', onPageShow);
    document.removeEventListener('visibilitychange', onVisibilityChange);
  }
  started = false;
  userId = null;
  signedUpAt = null;
  sessionStart = Date.now();
  transactions = 0;
  assignments = 0;
  imported = false;
  summarySent = false;
  hiddenAt = null;
  emptyStatesSeen.clear();
  syncedMilestones.clear();
}

/**
 * An empty screen was shown; counted once per screen per visit, in the first
 * month only. Callers report a truly empty screen, not a list that a filter
 * or search emptied.
 */
export function noteEmptyState(screen: EmptyStateScreen): void {
  if (daysSinceSignup() === null || inDemoBudget()) return;
  if (emptyStatesSeen.has(screen)) return;
  emptyStatesSeen.add(screen);
  track('empty_state_viewed', { screen });
}

/** React wrapper for noteEmptyState: report on mount. */
export function useEmptyStateViewed(screen: EmptyStateScreen, shown = true): void {
  useEffect(() => {
    if (shown) noteEmptyState(screen);
  }, [screen, shown]);
}
