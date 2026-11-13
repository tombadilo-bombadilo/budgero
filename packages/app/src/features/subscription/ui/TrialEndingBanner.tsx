import { Trans, useLingui } from '@lingui/react/macro';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { X } from 'lucide-react';
import { useProfile } from '@entities/user/api/useAuth';
import { IS_SELF_HOSTABLE_BUILD } from '@shared/lib/env';
import { userScope, useSyncedState } from '@shared/lib/synced-state';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const SHOW_WITHIN_DAYS = 2;

/** Synced per user: the trial end (ISO) the banner was dismissed for. */
export const TRIAL_ENDING_DISMISSED_KEY = 'trialEndingDismissed';

/** Device cache (and where the dismissal lived before it synced). */
const dismissKeyFor = (trialEndsAtIso: string) =>
  `budgero:trial_ending_dismissed:${trialEndsAtIso}`;

/** One spelling of a trial end, so the server's format can't miss a dismissal. */
function trialKeyFor(trialEndsAtIso: string | null): string | null {
  if (!trialEndsAtIso) return null;
  const date = new Date(trialEndsAtIso);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function readCachedDismiss(trialEndsAtIso: string, trialKey: string): boolean {
  try {
    // Older builds wrote the key with the server's spelling or the ISO one.
    return [trialEndsAtIso, trialKey].some(
      (iso) => localStorage.getItem(dismissKeyFor(iso)) === '1'
    );
  } catch {
    return false;
  }
}

function cacheDismiss(trialKey: string): void {
  try {
    localStorage.setItem(dismissKeyFor(trialKey), '1');
  } catch {
    /* no-op */
  }
}

/**
 * Top-of-app banner that appears in the final 2 days of the trial. Dismissable
 * per-trial (re-keyed by trial_ends_at, so the dismissal state doesn't leak
 * across trials); a dismissal syncs to the user's other devices through the
 * workspace's encrypted database. Shows the time left + a checkout CTA.
 */
export function TrialEndingBanner() {
  const { t } = useLingui();

  const [now] = useState(() => Date.now());
  const [explicitlyDismissed, setExplicitlyDismissed] = useState(false);
  const { data: user } = useProfile();

  const trialEndsAtIso = user?.trial_ends_at ?? null;
  const trialKey = trialKeyFor(trialEndsAtIso);
  const synced = useSyncedState<string>(
    user?.id ? userScope(user.id) : null,
    TRIAL_ENDING_DISMISSED_KEY
  );
  const cachedDismissed = useMemo(
    () => (trialEndsAtIso && trialKey ? readCachedDismiss(trialEndsAtIso, trialKey) : false),
    [trialEndsAtIso, trialKey]
  );
  const syncedDismissed = synced.available && trialKey !== null && synced.value === trialKey;
  const dismissed = explicitlyDismissed || cachedDismissed || syncedDismissed;

  // Dismissed elsewhere → cache it here; dismissed only here (before it synced)
  // → one synced write.
  const { set: setSynced, canWrite } = synced;
  useEffect(() => {
    if (!trialKey) return;
    if (syncedDismissed && !cachedDismissed) cacheDismiss(trialKey);
    else if (cachedDismissed && !syncedDismissed && canWrite) void setSynced(trialKey);
  }, [trialKey, syncedDismissed, cachedDismissed, canWrite, setSynced]);

  if (IS_SELF_HOSTABLE_BUILD) return null;
  if (!user) return null;
  if (dismissed) return null;
  // Not before the synced state is read, so a dismissed banner doesn't flash.
  if (!synced.loaded) return null;

  const subscriptionActive =
    user.subscription_status === 'active' || user.subscription_status === 'lifetime';
  if (subscriptionActive) return null;

  const trialEndsAt = trialEndsAtIso ? new Date(trialEndsAtIso) : null;
  if (!trialEndsAt) return null;

  const msLeft = trialEndsAt.getTime() - now;
  if (msLeft <= 0) return null;
  // Use floor so this matches the calculation on the subscription page —
  // 2.5 days remaining shows as "2 days left" in both surfaces. Banner is
  // visible whenever the floored count is in [0, SHOW_WITHIN_DAYS].
  const daysLeft = Math.max(0, Math.floor(msLeft / MS_PER_DAY));
  if (daysLeft > SHOW_WITHIN_DAYS) return null;

  const handleDismiss = () => {
    setExplicitlyDismissed(true);
    const key = trialEndsAt.toISOString();
    cacheDismiss(key);
    void setSynced(key);
  };

  const timeLabel =
    daysLeft === 0 ? t`Less than a day` : daysLeft === 1 ? '1 day' : `${daysLeft} days`;
  const message = t`${timeLabel} left in your trial`;

  return (
    <div className="bg-amber-500 text-white w-full">
      <div className="px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between gap-3 py-3">
          <p className="text-sm font-medium flex-1 min-w-0 truncate">{message}</p>
          <Link
            to="/settings/subscription"
            className="text-sm font-semibold underline whitespace-nowrap hover:opacity-90"
          >
            <Trans>Subscribe</Trans>
          </Link>
          <button
            onClick={handleDismiss}
            className="p-1 hover:bg-white/20 rounded transition-colors"
            aria-label={t`Dismiss banner`}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
