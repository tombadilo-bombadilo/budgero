/**
 * Time until the app is usable, once per page load, for app_opened.
 *
 * Usable = the first page inside the app shell (DashboardLayout) has mounted
 * and its first data has loaded. That point comes after StartupController's
 * `app_ready` mark (signed in, master password unlocked, runtime Ready with
 * services bound, workspace and budget resolved), plus the page's own chunk
 * and its first queries; DashboardLayout's UsableMarker reports it once no
 * query is fetching (or after a cap). Measured from navigation start
 * (performance.now()), so it includes downloading and parsing the app.
 *
 * A load that showed a screen waiting on the person (sign-in, onboarding,
 * master password, workspace or budget choice, an error) counts as
 * 'prompted': its time would measure them, not the app. Only the bucket is
 * sent, never raw milliseconds: the event registry (events.ts) allows
 * enum values only.
 */
import { timingBucket, type UsableBucket } from './events';

let usableAt: number | null = null;
let prompted = false;
let consumed = false;
const listeners = new Set<() => void>();

function now(): number {
  try {
    return performance.now();
  } catch {
    return 0;
  }
}

/** A screen that waits on the person was shown before the app was usable. */
export function noteStartupPrompt(): void {
  if (usableAt === null) prompted = true;
}

/** The first screen and its data are on screen. Only the first call counts. */
export function markAppUsable(at = now()): void {
  if (usableAt !== null) return;
  usableAt = at;
  try {
    performance.mark('app_usable');
  } catch {
    /* no-op */
  }
  for (const listener of [...listeners]) listener();
  listeners.clear();
}

export function isAppUsable(): boolean {
  return usableAt !== null;
}

/** Runs once when the app becomes usable (right away if it already is). */
export function onAppUsable(listener: () => void): () => void {
  if (usableAt !== null) {
    listener();
    return () => {};
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * The usable_bucket for this page load's first app_opened; any later
 * app_opened in the same page load (tab back after a long break, back/forward
 * cache, a new day) gets 'already_open'. 'left_before' when the page is left
 * or hidden before it became usable.
 */
export function takeUsableBucket(): UsableBucket {
  if (consumed) return 'already_open';
  consumed = true;
  if (usableAt === null) return 'left_before';
  if (prompted) return 'prompted';
  return timingBucket(usableAt);
}

/** Whether this page load's timing has not been sent yet. */
export function usableTimingPending(): boolean {
  return !consumed;
}

/** Test hook. */
export function resetStartupTimingForTests(): void {
  usableAt = null;
  prompted = false;
  consumed = false;
  listeners.clear();
}
