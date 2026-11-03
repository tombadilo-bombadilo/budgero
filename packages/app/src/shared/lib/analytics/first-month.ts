/**
 * First-month analytics: how a new user's first 30 days go, without reading
 * any budget data. Everything here is derived from events the app already
 * tracks (observeTrackedEvents) plus the signup date from the profile.
 *
 * - app_opened: once per calendar day per device, with days since signup.
 * - activation_milestone: the first transaction, assignment, import and
 *   Ready to Assign reaching zero, once each per user per device.
 * - session_summary: at pagehide, the visit's length and rough counts.
 *
 * Nothing is sent after day 30. The de-duplication keys in localStorage hold
 * only dates and milestone names, never budget data.
 */
import { useEffect } from 'react';
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
const MILESTONES_KEY = 'budgero:fm-milestones';

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
let started = false;
let stopObserving: (() => void) | null = null;
const emptyStatesSeen = new Set<EmptyStateScreen>();

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

function reachMilestone(milestone: ActivationMilestone): void {
  const days = daysSinceSignup();
  if (days === null || !userId) return;
  const all = readJson<Record<string, string[]>>(MILESTONES_KEY, {});
  const mine = all[userId] ?? [];
  if (mine.includes(milestone)) return;
  writeJson(MILESTONES_KEY, { ...all, [userId]: [...mine, milestone] });
  track('activation_milestone', { milestone, day: signupDayBucket(days) });
}

function onTracked(name: AnalyticsEventName, props: Record<string, string>): void {
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
 * on an empty budget is not.
 */
export function noteReadyToAssign(value: number): void {
  if (value === 0 && assignments > 0) reachMilestone('rta_zero');
}

function sendSummary(): void {
  if (summarySent) return;
  const days = daysSinceSignup();
  if (days === null) return;
  summarySent = true;
  trackOnUnload('session_summary', {
    day: signupDayBucket(days),
    duration_bucket: durationBucket(Date.now() - sessionStart),
    transactions_bucket: countBucket(transactions),
    assignments_bucket: countBucket(assignments),
    imported: imported ? 'yes' : 'no',
  });
}

function onPageHide(): void {
  sendSummary();
}

function onVisibilityChange(): void {
  // A tab hidden for good never fires pagehide on some mobile browsers; a tab
  // that comes back starts a new visit.
  if (document.visibilityState === 'hidden') {
    sendSummary();
  } else if (summarySent) {
    summarySent = false;
    sessionStart = Date.now();
    transactions = 0;
    assignments = 0;
    imported = false;
    reportAppOpened();
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
  if (changed) {
    sessionStart = Date.now();
    transactions = 0;
    assignments = 0;
    imported = false;
    summarySent = false;
  }
  if (!started && typeof window !== 'undefined') {
    started = true;
    stopObserving = observeTrackedEvents(onTracked);
    window.addEventListener('pagehide', onPageHide);
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
  emptyStatesSeen.clear();
}

/** An empty screen was shown; counted once per screen per visit. */
export function noteEmptyState(screen: EmptyStateScreen): void {
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
