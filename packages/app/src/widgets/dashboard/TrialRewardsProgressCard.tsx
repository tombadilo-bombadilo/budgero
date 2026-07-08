import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Sparkles, Check, Lock, ChevronRight, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@shared/ui/card';
import { Badge } from '@shared/ui/badge';
import { Button } from '@shared/ui/button';
import { useTrialProgress } from '@features/subscription/api/useTrialRewards';
import { useProfile } from '@entities/user/api/useAuth';
import { IS_SELF_HOSTABLE_BUILD } from '@shared/lib/env';
import { capitalize } from '@shared/lib/utils';
import type { TrialDiscountCode, TrialProgress, TrialProgressCounts } from '@shared/api/api-client';

const POST_TRIAL_VISIBILITY_DAYS = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

interface TierRow {
  tier: 1 | 2 | 3;
  name: string;
  percentOff: number;
  status: 'unlocked' | 'in_progress' | 'locked';
  /** One short sentence describing what's needed (or the unlock state). */
  hint: string;
}

/**
 * Dashboard card showing trial-rewards status. Two visual states:
 *   - Hero: highest-tier (T3) unlocked → big earned % + active code + Subscribe CTA
 *   - List: partial / none → per-tier rows with concrete next-step hints
 *
 * Visibility — show only while the card is meaningful as a trial-period
 * nudge:
 *   - Currently trialing (`trialing` / `on_trial`), OR
 *   - Within 7 days of `trial_ends_at` (grace so earned codes stay visible
 *     while they're still valid).
 *
 * Hidden when:
 *   - self-host build
 *   - active paid subscription (`active`, `lifetime`)
 *   - any other non-trial subscription state (`expired`, `cancelled`,
 *     `past_due`, `inactive`, etc.) past the 7-day grace
 *   - `trial_ends_at` is null and the user is not currently trialing —
 *     e.g. founding members, comped accounts, anyone who skipped the
 *     trial path entirely
 */
export function TrialRewardsProgressCard() {
  const [now] = useState(() => Date.now());
  const { data: user } = useProfile();
  const { data, dataUpdatedAt, isLoading } = useTrialProgress();

  // Pick the user's currently-active code — same selection logic as the
  // rewards page so the dashboard surfaces whichever discount they'd actually
  // get at checkout.
  const bestCode = useMemo<TrialDiscountCode | null>(() => {
    const candidate = (data?.codes ?? [])
      .filter((c) => !c.redeemed_at)
      .reduce<TrialDiscountCode | null>(
        (best, c) => (best === null || c.tier > best.tier ? c : best),
        null
      );
    if (!candidate) return null;
    return new Date(candidate.valid_until).getTime() > dataUpdatedAt ? candidate : null;
  }, [data?.codes, dataUpdatedAt]);

  if (IS_SELF_HOSTABLE_BUILD) return null;
  if (!user) return null;

  const status = user.subscription_status;
  const isPaid = status === 'active' || status === 'lifetime';
  if (isPaid) return null;

  const isTrialing = status === 'trialing' || status === 'on_trial';
  const trialEndsAt = user.trial_ends_at ? new Date(user.trial_ends_at) : null;
  if (!isTrialing) {
    // Non-trialing, non-paid — only stay visible during the grace window
    // immediately after a real trial ended. Founding members and other
    // comped paths have trial_ends_at null and never see the card.
    if (!trialEndsAt) return null;
    const daysSinceTrialEnded = (now - trialEndsAt.getTime()) / MS_PER_DAY;
    if (daysSinceTrialEnded > POST_TRIAL_VISIBILITY_DAYS) return null;
  }

  const daysLeft = trialEndsAt
    ? Math.max(0, Math.ceil((trialEndsAt.getTime() - now) / MS_PER_DAY))
    : null;
  const trialActive = daysLeft !== null && daysLeft > 0;

  const progress = data?.progress;
  const counts = data?.counts ?? null;
  const topTierUnlocked = !!progress?.tier3_unlocked_at;
  const rows = buildTierRows(progress, counts);

  return (
    <Card className="h-full">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-base font-semibold">
            <Sparkles className="h-5 w-5 text-amber-500" />
            Trial rewards
          </CardTitle>
          {trialActive ? (
            <span className="text-xs text-muted-foreground tabular-nums">
              {daysLeft === 1 ? '1 day left' : `${daysLeft} days left`}
            </span>
          ) : daysLeft === 0 ? (
            <span className="text-xs text-muted-foreground">Trial ended</span>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <div className="space-y-2">
            <div className="h-10 animate-pulse rounded-md bg-muted/40" />
            <div className="h-10 animate-pulse rounded-md bg-muted/40" />
            <div className="h-10 animate-pulse rounded-md bg-muted/40" />
          </div>
        ) : topTierUnlocked && bestCode ? (
          <UnlockedHero code={bestCode} />
        ) : (
          <>
            <p className="text-xs text-muted-foreground">
              Discount applies to your first 2 years on the yearly plan. Renews at the regular price
              after that.
            </p>
            <ul className="space-y-1.5">
              {rows.map((row) => (
                <TierRowItem key={row.tier} row={row} />
              ))}
            </ul>
          </>
        )}
      </CardContent>
      <CardFooter className="pt-0">
        {topTierUnlocked && bestCode ? (
          <Button asChild className="w-full bg-amber-500 text-black hover:bg-amber-400">
            <Link to="/settings/subscription">Subscribe with {bestCode.percent_off}% off</Link>
          </Button>
        ) : (
          <Link
            to="/rewards"
            className="inline-flex items-center gap-1 text-sm font-medium text-foreground hover:underline"
          >
            View rewards
            <ChevronRight className="h-4 w-4" />
          </Link>
        )}
      </CardFooter>
    </Card>
  );
}

function UnlockedHero({ code }: { code: TrialDiscountCode }) {
  const handleCopy = () => {
    navigator.clipboard
      .writeText(code.code)
      .then(() => toast.success('Code copied'))
      .catch(() => toast.error('Could not copy code'));
  };

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50/60 p-4 dark:border-amber-500/40 dark:bg-amber-950/15">
      <div className="flex items-baseline gap-2">
        <span className="text-3xl font-semibold tabular-nums text-amber-900 dark:text-amber-200">
          {code.percent_off}% off
        </span>
        <span className="text-sm text-amber-900/80 dark:text-amber-200/80">
          yearly plan · 2 years
        </span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        All 3 tiers unlocked — your reward applies automatically at checkout.
      </p>
      <div className="mt-3 flex items-center gap-2 rounded-md border bg-background px-3 py-1.5">
        <code className="flex-1 truncate text-xs font-mono">{code.code}</code>
        <Button size="sm" variant="ghost" className="h-7 px-2" onClick={handleCopy}>
          <Copy className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

function TierRowItem({ row }: { row: TierRow }) {
  const isUnlocked = row.status === 'unlocked';
  const isLocked = row.status === 'locked';

  return (
    <li className="flex items-start gap-2 rounded-md border border-border/60 px-3 py-2">
      <span
        className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
          isUnlocked
            ? 'bg-amber-500 text-white'
            : isLocked
              ? 'border border-muted-foreground/40 text-muted-foreground'
              : 'border border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300'
        }`}
      >
        {isUnlocked ? (
          <Check className="h-3 w-3" />
        ) : isLocked ? (
          <Lock className="h-3 w-3" />
        ) : null}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium">
            Tier {row.tier} — {row.name}
          </span>
          <Badge
            variant={isUnlocked ? 'default' : 'outline'}
            className={
              isUnlocked
                ? 'bg-amber-500 text-white hover:bg-amber-500 text-[10px] px-1.5'
                : 'text-[10px] px-1.5'
            }
          >
            {row.percentOff}%
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">{row.hint}</p>
      </div>
    </li>
  );
}

function buildTierRows(
  p: TrialProgress | null | undefined,
  counts: TrialProgressCounts | null
): TierRow[] {
  const transactionCount = counts?.transaction_count ?? 0;
  const t1 = !!p?.tier1_unlocked_at;
  const t2 = !!p?.tier2_unlocked_at;
  const t3 = !!p?.tier3_unlocked_at;
  const hasFirstReconciliation = !!p?.first_reconciliation_at;
  const hasGoalFunded = !!p?.goal_funded_at;
  const assignmentMonths = counts?.assignment_distinct_months ?? 0;
  const transactionMonths = counts?.transaction_distinct_months ?? 0;

  const transactionsLeft = Math.max(0, 5 - transactionCount);
  const tier1Hint = t1
    ? 'Unlocked — logged 5 transactions'
    : `Log ${transactionsLeft} more transaction${transactionsLeft === 1 ? '' : 's'}`;

  let tier2Hint: string;
  if (t2) {
    tier2Hint = 'Unlocked';
  } else if (!t1) {
    tier2Hint = 'Unlock Tier 1 first';
  } else {
    const todo: string[] = [];
    if (!hasFirstReconciliation) todo.push('reconcile an account');
    if (!hasGoalFunded) todo.push('create + fund a goal');
    tier2Hint = capitalize(todo.join(' · '));
  }

  let tier3Hint: string;
  if (t3) {
    tier3Hint = 'Unlocked';
  } else if (!t2) {
    tier3Hint = 'Unlock Tier 2 first';
  } else {
    const todo: string[] = [];
    if (assignmentMonths < 2) todo.push(`assign in ${2 - assignmentMonths} more month`);
    if (transactionMonths < 2)
      todo.push(`log a transaction in ${2 - transactionMonths} more month`);
    tier3Hint =
      todo.length > 0
        ? capitalize(todo.join(' · '))
        : 'Cross into next calendar month (≥21 days into trial)';
  }

  return [
    {
      tier: 1,
      name: 'Foundation',
      percentOff: 10,
      status: t1 ? 'unlocked' : 'in_progress',
      hint: tier1Hint,
    },
    {
      tier: 2,
      name: 'Discipline',
      percentOff: 20,
      status: t2 ? 'unlocked' : t1 ? 'in_progress' : 'locked',
      hint: tier2Hint,
    },
    {
      tier: 3,
      name: 'Persistence',
      percentOff: 35,
      status: t3 ? 'unlocked' : t2 ? 'in_progress' : 'locked',
      hint: tier3Hint,
    },
  ];
}
