import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { X } from 'lucide-react';
import { useProfile } from '@entities/user/api/useAuth';
import { useTrialProgress } from '@features/subscription/api/useTrialRewards';
import { IS_SELF_HOSTABLE_BUILD } from '@shared/lib/env';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const SHOW_WITHIN_DAYS = 2;

const dismissKeyFor = (trialEndsAtIso: string) =>
  `budgero:trial_ending_dismissed:${trialEndsAtIso}`;

function readPersistedDismiss(trialEndsAtIso: string): boolean {
  try {
    return localStorage.getItem(dismissKeyFor(trialEndsAtIso)) === '1';
  } catch {
    return false;
  }
}

/**
 * Top-of-app banner that appears in the final 2 days of the trial. Dismissable
 * per-trial (re-keyed by trial_ends_at, so the dismissal state doesn't leak
 * across trials). Surfaces the highest earned discount + a checkout CTA.
 */
export function TrialEndingBanner() {
  const [now] = useState(() => Date.now());
  const [explicitlyDismissed, setExplicitlyDismissed] = useState(false);
  const { data: user } = useProfile();
  const { data } = useTrialProgress();

  const trialEndsAtIso = user?.trial_ends_at ?? null;
  const persistedDismissed = useMemo(
    () => (trialEndsAtIso ? readPersistedDismiss(trialEndsAtIso) : false),
    [trialEndsAtIso]
  );
  const dismissed = explicitlyDismissed || persistedDismissed;

  if (IS_SELF_HOSTABLE_BUILD) return null;
  if (!user) return null;
  if (dismissed) return null;

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

  const codes = data?.codes ?? [];
  const highestCode = codes.reduce<(typeof codes)[number] | null>(
    (best, c) => (best === null || c.tier > best.tier ? c : best),
    null
  );

  const handleDismiss = () => {
    setExplicitlyDismissed(true);
    try {
      localStorage.setItem(dismissKeyFor(trialEndsAt.toISOString()), '1');
    } catch {
      /* no-op */
    }
  };

  const timeLabel =
    daysLeft === 0 ? 'Less than a day' : daysLeft === 1 ? '1 day' : `${daysLeft} days`;
  const message = highestCode
    ? `${timeLabel} left in your trial · You've earned ${highestCode.percent_off}% off for 2 years`
    : `${timeLabel} left in your trial`;

  return (
    <div className="bg-amber-500 text-white w-full">
      <div className="px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between gap-3 py-3">
          <p className="text-sm font-medium flex-1 min-w-0 truncate">{message}</p>
          <Link
            to="/settings/subscription"
            className="text-sm font-semibold underline whitespace-nowrap hover:opacity-90"
          >
            Subscribe
          </Link>
          <button
            onClick={handleDismiss}
            className="p-1 hover:bg-white/20 rounded transition-colors"
            aria-label="Dismiss banner"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
