import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Copy, Lock, PauseCircle, Sparkles, Wrench } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent } from '@shared/ui/card';
import { Button } from '@shared/ui/button';
import { Badge } from '@shared/ui/badge';
import { Progress } from '@shared/ui/progress';
import {
  useDevForceUnlock,
  useDevResetTrial,
  useTrialProgress,
} from '@features/subscription/api/useTrialRewards';
import { getUtcMonthKey } from '@shared/lib/date-utils';
import { getErrorMessage } from '@shared/lib/errors';
import { useProfile } from '@entities/user/api/useAuth';
import type { TrialDiscountCode, TrialProgress, TrialProgressCounts } from '@shared/api/api-client';

interface TierUI {
  tier: 1 | 2 | 3;
  name: string;
  discountPercent: number;
  headline: string;
  criteria: TierCriterion[];
}

interface TierCriterion {
  label: string;
  done: boolean;
  /** Optional progress: { current, target } when this is a count toward a target */
  progress?: { current: number; target: number };
}

const REWARDS_PAGE_HELP =
  'Earn a discount on the yearly plan by building real budgeting habits during your trial. Rewards apply only to the yearly plan and last for 24 months — your subscription renews at the regular yearly price after that. Codes are tied to your account and apply automatically at checkout.';

export default function RewardsPage() {
  const { data, dataUpdatedAt, isLoading } = useTrialProgress();
  const { data: user } = useProfile();

  const [now] = useState(() => Date.now());
  const progress = data?.progress ?? null;
  // Pick the user's currently-active code — the highest-tier non-redeemed
  // code, then check expiry. The supersede invariant on the server clamps
  // lower-tier codes' valid_until to the supersede moment, so after refetch
  // their valid_until lands at-or-before dataUpdatedAt and they correctly
  // filter out. Using react-query's dataUpdatedAt (a plain number set on
  // every fetch) keeps this memo pure for react-compiler.
  const codesByTier = useMemo(() => {
    const m = new Map<number, TrialDiscountCode>();
    const candidate = (data?.codes ?? [])
      .filter((c) => !c.redeemed_at)
      .reduce<TrialDiscountCode | null>(
        (best, c) => (best === null || c.tier > best.tier ? c : best),
        null
      );
    if (candidate && new Date(candidate.valid_until).getTime() > dataUpdatedAt) {
      m.set(candidate.tier, candidate);
    }
    return m;
  }, [data?.codes, dataUpdatedAt]);

  const counts = data?.counts ?? null;
  const tiers = useMemo<TierUI[]>(
    () => buildTierUI(progress, counts, now),
    [progress, counts, now]
  );

  const trialEndsAt = user?.trial_ends_at ? new Date(user.trial_ends_at) : null;
  const trialActive = trialEndsAt ? trialEndsAt.getTime() > now : false;
  const activeCode = Array.from(codesByTier.values())[0] ?? null;
  const hasAnyEarnedCode = (data?.codes?.length ?? 0) > 0;
  // Tier progress is driven by anonymous trial signals with their own opt-out
  // (Settings → Privacy → Trial Reward Tracking), separate from analytics.
  // Surface it here so an opted-out user understands why their progress
  // isn't moving.
  const trackingPausesProgress = trialActive && user?.is_trial_signals_disabled === true;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:py-12">
      <header className="mb-8">
        <div className="flex items-center gap-3">
          <Sparkles className="h-7 w-7 text-amber-500" />
          <h1 className="text-3xl font-semibold tracking-tight">Trial rewards</h1>
        </div>
        <p className="mt-3 max-w-xl text-sm text-muted-foreground">{REWARDS_PAGE_HELP}</p>
        {trackingPausesProgress && <TrackingPausedNotice />}
        {!trialActive && !isLoading && (
          <TrialEndedNotice activeCode={activeCode} hasAnyEarnedCode={hasAnyEarnedCode} />
        )}
      </header>

      {isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-40 animate-pulse rounded-xl bg-muted/40" />
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          {tiers.map((tier) => (
            <TierCard key={tier.tier} tier={tier} earnedCode={codesByTier.get(tier.tier)} />
          ))}
        </div>
      )}

      {!isLoading && <SubscribeCta bestCode={activeCode} />}

      {import.meta.env.DEV && <DevPanel />}

      <footer className="mt-12 space-y-1 text-xs text-muted-foreground">
        <p>
          Progress is tracked from anonymous activity signals (event names only, no amounts or
          details). You can turn this off anytime in{' '}
          <Link to="/settings/security" className="underline">
            Settings → Privacy
          </Link>
          .
        </p>
        <p>
          Need help?{' '}
          <Link to="/settings/subscription" className="underline">
            Subscription settings
          </Link>
        </p>
      </footer>
    </div>
  );
}

function TrackingPausedNotice() {
  return (
    <div className="mt-4 flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50/60 px-4 py-3 dark:border-amber-500/40 dark:bg-amber-950/15">
      <PauseCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
      <div className="text-sm">
        <p className="font-medium text-foreground">Trial-reward progress is paused.</p>
        <p className="mt-0.5 text-muted-foreground">
          Trial reward tracking is turned off in{' '}
          <Link to="/settings/security" className="underline underline-offset-2">
            Settings → Privacy
          </Link>
          , so new tier unlocks aren't being counted. Turn it back on to resume earning your trial
          reward.
        </p>
      </div>
    </div>
  );
}

function TrialEndedNotice({
  activeCode,
  hasAnyEarnedCode,
}: {
  activeCode: TrialDiscountCode | null;
  hasAnyEarnedCode: boolean;
}) {
  if (activeCode) {
    return (
      <div className="mt-4 flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50/60 px-4 py-3 dark:border-amber-500/40 dark:bg-amber-950/15">
        <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <div className="text-sm">
          <p className="font-medium text-foreground">
            Your trial has ended — your reward is ready.
          </p>
          <p className="mt-0.5 text-muted-foreground">
            Use your {activeCode.percent_off}% off code by{' '}
            {new Date(activeCode.valid_until).toLocaleDateString()} on the yearly plan.
          </p>
        </div>
      </div>
    );
  }
  return (
    <div className="mt-4 flex items-start gap-3 rounded-lg border bg-muted/40 px-4 py-3">
      <Lock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="text-sm">
        <p className="font-medium text-foreground">
          {hasAnyEarnedCode
            ? 'Your reward window has closed.'
            : 'No active trial rewards on your account.'}
        </p>
        <p className="mt-0.5 text-muted-foreground">
          {hasAnyEarnedCode
            ? 'Codes are valid for 7 days after the trial ends. You can still subscribe below to keep using Budgero.'
            : 'Trial rewards are earned during the 35-day trial. You can still subscribe below to keep using Budgero.'}
        </p>
      </div>
    </div>
  );
}

function SubscribeCta({ bestCode }: { bestCode: TrialDiscountCode | null }) {
  return (
    <div className="mt-6 rounded-2xl border border-amber-300 bg-amber-50/60 p-5 dark:border-amber-500/40 dark:bg-amber-950/15">
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <p className="text-base font-semibold">
            {bestCode ? `Ready to use your ${bestCode.percent_off}% off?` : 'Ready to subscribe?'}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {bestCode
              ? 'Your reward applies automatically at checkout on the yearly plan.'
              : 'Subscribe any time — earned rewards apply automatically.'}
          </p>
        </div>
        <Button asChild className="bg-amber-500 text-black hover:bg-amber-400">
          <Link to="/settings/subscription">
            {bestCode ? 'Subscribe to yearly plan' : 'View plans'}
          </Link>
        </Button>
      </div>
    </div>
  );
}

function TierCard({
  tier,
  earnedCode,
}: {
  tier: TierUI;
  earnedCode: TrialDiscountCode | undefined;
}) {
  const unlocked = !!earnedCode;
  const allCriteriaMet = tier.criteria.every((c) => c.done);

  const handleCopy = () => {
    if (!earnedCode) return;
    navigator.clipboard
      .writeText(earnedCode.code)
      .then(() => toast.success('Code copied'))
      .catch(() => toast.error('Could not copy code'));
  };

  return (
    <Card className={unlocked ? 'border-amber-500/40 bg-amber-50/40 dark:bg-amber-950/10' : ''}>
      <CardContent className="space-y-4 p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-semibold">
                Tier {tier.tier} — {tier.name}
              </h2>
              {unlocked ? (
                <Badge variant="default" className="bg-amber-500 text-white hover:bg-amber-500">
                  Unlocked
                </Badge>
              ) : allCriteriaMet ? (
                <Badge variant="outline">Ready</Badge>
              ) : (
                <Badge variant="outline" className="text-muted-foreground">
                  <Lock className="mr-1 h-3 w-3" /> Locked
                </Badge>
              )}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{tier.headline}</p>
          </div>
          <div className="text-right">
            <div className="text-3xl font-bold tabular-nums">{tier.discountPercent}%</div>
            <div className="text-xs text-muted-foreground">off yearly plan · 2 years</div>
          </div>
        </div>

        <ul className="space-y-2">
          {tier.criteria.map((c, i) => (
            <CriterionRow key={i} criterion={c} />
          ))}
        </ul>

        {earnedCode && (
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 rounded-md border bg-background px-3 py-2">
              <code className="flex-1 text-sm font-mono">{earnedCode.code}</code>
              <Button size="sm" variant="ghost" onClick={handleCopy}>
                <Copy className="mr-1 h-4 w-4" />
                Copy
              </Button>
              <span className="text-xs text-muted-foreground">
                Valid until {new Date(earnedCode.valid_until).toLocaleDateString()}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              {earnedCode.percent_off}% off your first 2 years on the annual plan. Subscription
              renews at the regular price after 24 months.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CriterionRow({ criterion }: { criterion: TierCriterion }) {
  const showProgressBar = criterion.progress && !criterion.done;
  return (
    <li className="flex items-start gap-2 text-sm">
      <span
        className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
          criterion.done
            ? 'bg-emerald-500 text-white'
            : 'border border-muted-foreground/40 text-muted-foreground'
        }`}
      >
        {criterion.done ? <Check className="h-3 w-3" /> : null}
      </span>
      <div className="flex-1">
        <span className={criterion.done ? 'text-foreground' : 'text-muted-foreground'}>
          {criterion.label}
        </span>
        {showProgressBar && criterion.progress && (
          <div className="mt-1 flex items-center gap-2">
            <Progress
              value={Math.min(100, (criterion.progress.current / criterion.progress.target) * 100)}
              className="h-1.5"
            />
            <span className="text-xs tabular-nums text-muted-foreground">
              {criterion.progress.current}/{criterion.progress.target}
            </span>
          </div>
        )}
      </div>
    </li>
  );
}

/**
 * Dev-only QA panel. Renders only when import.meta.env.DEV is true (Vite
 * dev server). The corresponding endpoints are also gated server-side by
 * DEV_TOOLS_ENABLED — set DEV_TOOLS_ENABLED=true in your local server .env
 * for the buttons to actually do anything. In production builds this entire
 * component is dead-code-eliminated.
 */
function DevPanel() {
  const forceUnlock = useDevForceUnlock();
  const reset = useDevResetTrial();

  const onUnlock = (tier: 1 | 2 | 3) =>
    forceUnlock.mutate(tier, {
      onSuccess: () => toast.success(`Tier ${tier} unlocked`),
      onError: (err) => toast.error(`Unlock failed: ${getErrorMessage(err, 'unknown')}`),
    });

  const onReset = () =>
    reset.mutate(undefined, {
      onSuccess: () => toast.success('Trial state reset'),
      onError: (err) => toast.error(`Reset failed: ${getErrorMessage(err, 'unknown')}`),
    });

  const busy = forceUnlock.isPending || reset.isPending;

  return (
    <Card className="mt-8 border-dashed border-amber-600/50 bg-amber-50/30 dark:bg-amber-950/10">
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-300">
          <Wrench className="h-3.5 w-3.5" />
          Dev tools
        </div>
        <p className="text-xs text-muted-foreground">
          Force-unlock bypasses criteria + skips emails. Server endpoint must have{' '}
          <code className="font-mono">DEV_TOOLS_ENABLED=true</code>.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => onUnlock(1)} disabled={busy}>
            Unlock Tier 1
          </Button>
          <Button size="sm" variant="outline" onClick={() => onUnlock(2)} disabled={busy}>
            Unlock Tier 2
          </Button>
          <Button size="sm" variant="outline" onClick={() => onUnlock(3)} disabled={busy}>
            Unlock Tier 3
          </Button>
          <Button size="sm" variant="destructive" onClick={onReset} disabled={busy}>
            Reset all
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function buildTierUI(
  p: TrialProgress | null,
  counts: TrialProgressCounts | null,
  nowMs: number
): TierUI[] {
  const transactionCount = counts?.transaction_count ?? 0;
  const hasFirstReconciliation = !!p?.first_reconciliation_at;
  const hasGoalFunding = !!p?.goal_funded_at;
  const assignmentMonths = counts?.assignment_distinct_months ?? 0;
  const transactionMonths = counts?.transaction_distinct_months ?? 0;

  return [
    {
      tier: 1,
      name: 'Foundation',
      discountPercent: 10,
      headline:
        'Log 5 transactions during your trial. Logging is the foundation of manual budgeting — it raises awareness of your spending and is the first real step toward financial control.',
      criteria: [
        {
          label: 'Log 5 transactions',
          done: transactionCount >= 5,
          progress: { current: Math.min(transactionCount, 5), target: 5 },
        },
      ],
    },
    {
      tier: 2,
      name: 'Discipline',
      discountPercent: 20,
      headline:
        'Reconcile an account and create + fund a goal. Reconciliation keeps you honest — only budget money you actually have. Goals tie every dollar to a job.',
      criteria: [
        { label: 'Tier 1 unlocked', done: !!p?.tier1_unlocked_at },
        { label: 'Reconcile at least one account', done: hasFirstReconciliation },
        { label: 'Create a goal and fund it to its target', done: hasGoalFunding },
      ],
    },
    {
      tier: 3,
      name: 'Persistence',
      discountPercent: 35,
      headline:
        'Use your budget across two months. The deepest reward is for sticking with the practice — assigning money and logging transactions as you cross from one calendar month into the next.',
      criteria: [
        { label: 'Tier 2 unlocked', done: !!p?.tier2_unlocked_at },
        {
          label: 'Trial active for at least 21 days',
          done: hasElapsed(p?.trial_started_at, 21, nowMs),
        },
        {
          label: 'Crossed from your signup month into the next calendar month',
          done: hasCrossedSignupMonth(p?.trial_started_at, nowMs),
        },
        {
          label: 'Assigned money in two distinct calendar months',
          done: assignmentMonths >= 2,
          progress: { current: Math.min(assignmentMonths, 2), target: 2 },
        },
        {
          label: 'Logged transactions dated in two distinct calendar months',
          done: transactionMonths >= 2,
          progress: { current: Math.min(transactionMonths, 2), target: 2 },
        },
      ],
    },
  ];
}

function hasElapsed(startISO: string | undefined, days: number, nowMs: number): boolean {
  if (!startISO) return false;
  const start = new Date(startISO).getTime();
  if (!Number.isFinite(start)) return false;
  return nowMs - start >= days * 24 * 60 * 60 * 1000;
}

function hasCrossedSignupMonth(startISO: string | undefined, nowMs: number): boolean {
  if (!startISO) return false;
  const startMonth = getUtcMonthKey(new Date(startISO));
  const nowMonth = getUtcMonthKey(new Date(nowMs));
  return nowMonth > startMonth;
}
