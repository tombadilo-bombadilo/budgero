import { useEffect, useRef } from 'react';
import { trackTrialStarted } from '@shared/lib/analytics/analytics';
import { sendTrialStartedToUmami } from '@shared/lib/analytics/umami';
import { IS_SELF_HOSTABLE_BUILD } from '@shared/lib/env';
import type { AuthStartupSnapshot } from './hooks';

const TRIAL_FIRED_PREFIX = 'budgero:trial_started_fired:';
const TRIAL_FIRE_WINDOW_MS = 15 * 60 * 1000;

function readFiredFlag(userId: string): boolean {
  try {
    return localStorage.getItem(`${TRIAL_FIRED_PREFIX}${userId}`) === '1';
  } catch {
    return false;
  }
}

function writeFiredFlag(userId: string): void {
  try {
    localStorage.setItem(`${TRIAL_FIRED_PREFIX}${userId}`, '1');
  } catch {
    /* localStorage blocked — accept the dupe risk */
  }
}

/**
 * New-signup events. Identification itself lives in AnalyticsGate (app-wide,
 * so it also covers /auth); this hook only decides when Trial Started fires.
 *
 * Wired into StartupController, which is the only point in the app where the
 * backend `User` is guaranteed to exist (`auth.status === 'ready'` requires
 * Clerk loaded + signed in + the profile query resolved).
 *
 * Trial Started fires ONCE per user, gated on:
 *   1. backend `created_at` within the last 15 minutes (existing users won't
 *      refire even if the per-device flag is missing)
 *   2. a per-user localStorage flag (a single user on a single device won't
 *      refire across reloads either)
 *
 * Both gates must pass; either failing suppresses the event.
 */
export function useAnalyticsIdentity(auth: AuthStartupSnapshot): void {
  const trialHandledRef = useRef<string | null>(null);

  useEffect(() => {
    if (IS_SELF_HOSTABLE_BUILD) return;
    if (auth.status !== 'ready' || !auth.user) return;

    const userId = auth.user.id;
    const createdAtRaw = auth.user.created_at;

    if (trialHandledRef.current === userId) return;
    trialHandledRef.current = userId;

    if (readFiredFlag(userId)) return;

    const createdAt = createdAtRaw ? Date.parse(createdAtRaw) : NaN;
    if (!Number.isFinite(createdAt)) return;
    if (Date.now() - createdAt > TRIAL_FIRE_WINDOW_MS) return;

    writeFiredFlag(userId);
    trackTrialStarted();
    // Cookieless anonymous counterpart (see umami.ts).
    sendTrialStartedToUmami();
  }, [auth.status, auth.user]);
}
