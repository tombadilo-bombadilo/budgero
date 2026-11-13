import { Trans, useLingui } from '@lingui/react/macro';
import { CheckCircle2, ChevronDown, ChevronRight, ChevronUp, Circle, Users, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import type { GetAllTransactions, GetMonthlyBudgetRow, Goal } from '@budgero/core/browser';
import { useAllTransactions } from '@entities/transaction/api/queries';
import { useProfile } from '@entities/user/api/useAuth';
import { Button } from '@shared/ui/button';
import { Card, CardContent } from '@shared/ui/card';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@shared/ui/drawer';
import { cn } from '@shared/lib/utils';
import { useActiveSpaceId } from '@shared/runtime/runtime-provider';
import {
  FIRST_STEP_IDS,
  firstStepsLocalActions,
  hideFirstSteps,
  isFirstStepDone,
  markFirstStep,
  markFirstSteps,
  setFirstStepsCollapsed,
  showFirstSteps,
  type CountedFirstStepId,
  type FirstStepsState,
} from '@shared/lib/first-steps/first-steps';
import { useFirstSteps } from '@shared/lib/first-steps/useFirstSteps';
import { pickGoalToFund, spendingRows } from '../lib/goal-step';
import { startGoalWalkthrough } from '../model/goal-walkthrough';
import { pointAtAssigned, useSelectedForWalkthrough } from '../model/walkthrough-page';

interface FirstStepsCardProps {
  /** The budget on screen: its transactions tick "Add a transaction" (from any device). */
  budgetId?: number;
  readyToAssign: number;
  /** Ready to Assign, formatted for display. */
  readyToAssignLabel: string;
  rows: GetMonthlyBudgetRow[];
  /** This budget's goals: the "fund it" step talks about the user's goal. */
  goals?: Goal[];
  /** The month on screen (YYYY-MM), for what a goal still needs this month. */
  currentMonth?: string;
  /** Formats a milliunit amount (what a goal still needs). */
  formatAmount?: (milli: number) => string;
  /**
   * The figures are this month's real ones, not a loading default or the
   * previous month's placeholder. Nothing is ticked until they are.
   */
  settled?: boolean;
  /** 'bar': one compact row (phones) that opens the full list in a drawer. */
  variant?: 'card' | 'bar';
  /**
   * What a step's button does, per step. Without one, "goal" opens the goal
   * form for a suggested category and "assign" points at the row to type in.
   * A page can take over a step here.
   */
  onStepAction?: Partial<Record<CountedFirstStepId, () => void>>;
  className?: string;
}

interface StepItem {
  id: CountedFirstStepId;
  title: string;
  /** One line: what doing this step does for you. */
  why: React.ReactNode;
  body?: React.ReactNode;
  action?: React.ReactNode;
}

/** Payee of the opening-balance rows core writes for a new account (not the user's). */
const OPENING_PAYEE = 'Budgero';
/** Newest rows looked at; a budget with this many has the user's own. */
const RECENT_TRANSACTIONS = 50;

function hasOwnTransaction(rows: GetAllTransactions[] | undefined): boolean {
  if (!rows) return false;
  return rows.length >= RECENT_TRANSACTIONS || rows.some((row) => row.Payee !== OPENING_PAYEE);
}

/** The category the assign step points at: one with money first, then the first one. */
function pickCategory(rows: GetMonthlyBudgetRow[]): number | null {
  const real = spendingRows(rows);
  return (real.find((row) => row.Assigned > 0) ?? real[0])?.CategoryID ?? null;
}

/**
 * Week-one checklist on the Budget page for a workspace set up through
 * "Start my own budget", read as a lesson: set a goal for one category, then
 * fund it (the first assignment, with the real numbers), then spend, then
 * come back.
 */
export function FirstStepsCard({
  budgetId,
  readyToAssign,
  readyToAssignLabel,
  rows,
  goals = [],
  currentMonth = '',
  formatAmount = (milli) => String(milli / 1000),
  settled = true,
  variant = 'card',
  onStepAction,
  className,
}: FirstStepsCardProps) {
  const { t } = useLingui();
  const spaceId = useActiveSpaceId();
  const { data: profile } = useProfile();
  const steps = useFirstSteps(spaceId, profile?.id ?? null);
  const assignedAny = rows.some((row) => row.Assigned > 0);
  const assignDone = steps ? isFirstStepDone(steps, 'assign') : false;
  const goalDone = steps ? isFirstStepDone(steps, 'goal') : false;
  const everyCoinDone = steps ? isFirstStepDone(steps, 'everyCoin') : false;
  const transactionDone = steps ? isFirstStepDone(steps, 'transaction') : false;
  const [drawerOpen, setDrawerOpen] = useState(false);
  const total = FIRST_STEP_IDS.length;
  const doneCount = steps ? FIRST_STEP_IDS.filter((id) => isFirstStepDone(steps, id)).length : 0;
  const allDone = doneCount === total;
  const goalToFund = useMemo(
    () => pickGoalToFund(goals, rows, currentMonth),
    [goals, rows, currentMonth]
  );
  const selected = useSelectedForWalkthrough(rows, goals);

  // A transaction the user entered counts, from whichever device (the
  // opening balances of new accounts don't). Only read while it's open.
  const { data: recent } = useAllTransactions(budgetId ?? 0, {
    limit: RECENT_TRANSACTIONS,
    enabled: Boolean(steps) && !transactionDone,
  });
  const ownTransaction = hasOwnTransaction(recent);
  useEffect(() => {
    if (spaceId && steps && !transactionDone && ownTransaction)
      markFirstStep(spaceId, 'transaction');
  }, [spaceId, steps, transactionDone, ownTransaction]);

  // A goal that exists counts, however it was made (also on another device).
  useEffect(() => {
    if (spaceId && steps && !goalDone && settled && goals.length > 0)
      markFirstStep(spaceId, 'goal');
  }, [spaceId, steps, goalDone, settled, goals.length]);

  // "Fund it" is done once the goal's category has money assigned (any
  // category without a goal). Ready to Assign reaching 0 is the closing
  // line, said once. Celebrated only here and now: when this user just did
  // it on this device (a local change since it was last seen open), never
  // for a tick from another device or figures that were already there.
  const funded = goalToFund
    ? rows.some((row) => row.CategoryID === goalToFund.categoryId && row.Assigned > 0)
    : assignedAny;
  const fundedNow = assignedAny && funded;
  const everyCoinNow = assignedAny && readyToAssign === 0;
  const openSince = useRef<{ assign?: number; everyCoin?: number }>({});
  useEffect(() => {
    if (!spaceId || !steps || !settled) return;
    const actions = firstStepsLocalActions();
    const seen = openSince.current;
    const justDone = (since: number | undefined) => since !== undefined && actions > since;
    if (everyCoinNow && !everyCoinDone) {
      markFirstSteps(spaceId, assignDone ? ['everyCoin'] : ['assign', 'everyCoin']);
      if (justDone(seen.everyCoin)) {
        toast.success(t`Every coin has a job.`, {
          description: t`That’s the whole method: when money comes in, give it a job here.`,
        });
      }
    } else if (!assignDone && fundedNow) {
      markFirstStep(spaceId, 'assign');
      if (justDone(seen.assign)) {
        toast.success(t`Money assigned.`, {
          description: t`Keep going until Ready to Assign shows 0. Then every coin has a job.`,
        });
      }
    }
    seen.everyCoin = everyCoinDone || everyCoinNow ? undefined : actions;
    seen.assign = assignDone || fundedNow ? undefined : actions;
  }, [spaceId, steps, assignDone, everyCoinDone, everyCoinNow, fundedNow, settled, t]);

  if (!spaceId || !steps || steps.dismissed) return null;

  // The goal's "Show me": the walkthrough on the page (GoalWalkthroughHost).
  // It never picks a category or opens a form for the user.
  const showGoal = () => {
    setDrawerOpen(false);
    // Fold the desktop card out of the way while the walkthrough runs; it
    // unfolds again when the walkthrough ends.
    const fold = variant === 'card' && !steps.collapsed;
    if (fold) setFirstStepsCollapsed(spaceId, true);
    startGoalWalkthrough(selected, fold ? () => setFirstStepsCollapsed(spaceId, false) : undefined);
  };
  // The assign "Show me": the goal's row if there is one, and its Assigned field.
  const showAssign = () => {
    setDrawerOpen(false);
    const id = goalToFund?.categoryId ?? pickCategory(rows);
    if (id) pointAtAssigned(id);
  };
  const runAction = (id: CountedFirstStepId, fallback: () => void) => () => {
    const custom = onStepAction?.[id];
    setDrawerOpen(false);
    if (custom) custom();
    else fallback();
  };
  const stepButton = (label: React.ReactNode, onClick: () => void) => (
    <div>
      <Button size="sm" variant="outline" className="mt-2 h-7" onClick={onClick}>
        {label}
      </Button>
    </div>
  );
  const strong = (text: string) => <strong className="text-foreground">{text}</strong>;

  // Step 1: a goal. The walkthrough on the page explains the rest.
  const hasCategories = spendingRows(rows).length > 0;
  const goalBody = hasCategories ? undefined : (
    <Trans>Add a category first, then give it a goal.</Trans>
  );

  // Step 2: fund the goal. Nothing to assign yet (no balance or income): the
  // step waits with a note, and the next one is what to do now.
  const nothingToAssign = settled && readyToAssign === 0 && !assignedAny && !assignDone;
  const rta = strong(readyToAssignLabel);
  const fundName = goalToFund ? strong(goalToFund.categoryName) : null;
  const needed =
    goalToFund && goalToFund.needed > 0 ? strong(formatAmount(goalToFund.needed)) : null;
  const assignBody =
    readyToAssign < 0 ? (
      <Trans>You assigned more than you have. Take some back until Ready to Assign shows 0.</Trans>
    ) : nothingToAssign ? (
      <Trans>
        Nothing to assign yet. When money comes in (an account balance or income you record), it
        shows up as Ready to Assign. Then give it a job here.
      </Trans>
    ) : fundName && needed ? (
      <>
        <div>
          {variant === 'bar' ? (
            <Trans>
              {fundName} still needs {needed} this month. Tap {fundName} and enter it as Assigned.
              You have {rta} to assign.
            </Trans>
          ) : (
            <Trans>
              {fundName} still needs {needed} this month. Type it in the Assigned column on the{' '}
              {fundName} row. You have {rta} to assign.
            </Trans>
          )}
        </div>
        <div>
          <Trans>Then keep going until Ready to Assign shows 0: every coin gets a job.</Trans>
        </div>
      </>
    ) : variant === 'bar' ? (
      <Trans>
        You have {rta} to assign. Tap a category and enter an amount until Ready to Assign shows 0.
        Only budget money you already have.
      </Trans>
    ) : (
      <Trans>
        You have {rta} to assign. Type an amount in the Assigned column for each category until
        Ready to Assign shows 0. Only budget money you already have.
      </Trans>
    );

  const items: StepItem[] = [
    {
      id: 'goal',
      title: t`Set a goal for one category`,
      why: (
        <Trans>
          A goal says what a category needs, so each month you see what’s still underfunded.
        </Trans>
      ),
      body: goalBody,
      action:
        hasCategories || onStepAction?.goal
          ? stepButton(<Trans>Show me</Trans>, runAction('goal', showGoal))
          : undefined,
    },
    {
      id: 'assign',
      title: goalToFund ? t`Fund your goal` : t`Assign your money`,
      why: goalToFund ? (
        <Trans>Money you assign to a goal is set aside for it, so it can’t be spent twice.</Trans>
      ) : (
        <Trans>Money with a job can’t be spent twice. That’s the whole method.</Trans>
      ),
      body: assignBody,
      action:
        nothingToAssign || readyToAssign < 0
          ? undefined
          : stepButton(<Trans>Show me</Trans>, runAction('assign', showAssign)),
    },
    {
      id: 'transaction',
      title: t`Add a transaction`,
      why: <Trans>Spending comes out of a category, so you always see what’s left in it.</Trans>,
      body: <Trans>Record something you spent today, or import a file from your bank.</Trans>,
      action: onStepAction?.transaction ? (
        stepButton(
          <Trans>Go to transactions</Trans>,
          runAction('transaction', () => {})
        )
      ) : (
        <div>
          <Button asChild size="sm" variant="outline" className="mt-2 h-7">
            <Link to="/accounts/all" onClick={() => setDrawerOpen(false)}>
              <Trans>Go to transactions</Trans>
            </Link>
          </Button>
        </div>
      ),
    },
    {
      id: 'return',
      title: t`Come back tomorrow`,
      why: <Trans>A minute a day keeps your budget in step with your bank.</Trans>,
      body: <Trans>Open Budgero tomorrow and record yesterday’s spending.</Trans>,
    },
  ];
  const nextId = items.find(
    (item) => !isFirstStepDone(steps, item.id) && !(item.id === 'assign' && nothingToAssign)
  )?.id;
  // A waiting step stays open too, so its note is never hidden.
  const openIds = new Set<CountedFirstStepId>(
    [nextId, nothingToAssign ? 'assign' : undefined].filter(Boolean) as CountedFirstStepId[]
  );

  const title = allDone ? <Trans>You’ve got the basics</Trans> : <Trans>Your first steps</Trans>;
  const countLine = (
    <Trans>
      {doneCount} of {total} done
    </Trans>
  );
  // Taking the list away is its own, labelled action (never a bare ✕ that
  // reads as "close this"), and can be undone here or brought back later.
  const hide = () => {
    setDrawerOpen(false);
    hideFirstSteps(spaceId);
    toast.success(t`First steps hidden`, {
      description: t`Bring them back from Help (?) on the Planning page or in Budget Settings.`,
      action: { label: t`Undo`, onClick: () => showFirstSteps(spaceId) },
    });
  };
  const hideButton = (
    <div className="mt-3 border-t pt-2">
      <Button
        variant="ghost"
        size="sm"
        className="-ml-2 h-7 px-2 text-xs text-muted-foreground"
        onClick={hide}
      >
        <Trans>Hide first steps</Trans>
      </Button>
    </div>
  );
  // The finished list stays until the user closes it.
  const finished = (
    <div className="mt-3 border-t pt-3 text-xs leading-relaxed text-muted-foreground">
      <Trans>
        Give every coin a job, plan with goals, record what you spend, and look in now and then.
        That’s all there is to it.
      </Trans>
      <div>
        <Button size="sm" className="mt-2 h-7" onClick={hide}>
          <Trans>Hide first steps</Trans>
        </Button>
      </div>
    </div>
  );
  const list = (
    <>
      <StepList
        items={items}
        steps={steps}
        openIds={openIds}
        onNavigate={() => setDrawerOpen(false)}
        showShare={!allDone}
      />
      {allDone ? finished : hideButton}
    </>
  );
  const next = items.find((item) => item.id === nextId) ?? items[0];

  if (variant === 'bar') {
    // Only "come back tomorrow" left: nothing to do today, so no call to action.
    const waitingForTomorrow =
      !allDone && FIRST_STEP_IDS.every((id) => isFirstStepDone(steps, id) || id === 'return');
    return (
      <>
        <button
          type="button"
          data-testid="first-steps"
          onClick={() => setDrawerOpen(true)}
          aria-haspopup="dialog"
          className={cn(
            'flex h-11 w-full items-center gap-3 rounded-lg border bg-card px-3 text-left',
            waitingForTomorrow && 'border-dashed bg-transparent',
            className
          )}
        >
          <ProgressDots done={doneCount} total={total} />
          {allDone ? (
            <span className="min-w-0 flex-1 truncate text-sm font-medium">
              <Trans>You’ve got the basics</Trans>
            </span>
          ) : waitingForTomorrow ? (
            <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
              <Trans>
                {doneCount} of {total} done · see you tomorrow
              </Trans>
            </span>
          ) : (
            // Label above the title, so long titles (German) still fit one row.
            <span className="flex min-w-0 flex-1 flex-col leading-tight">
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                <Trans>Next:</Trans>
              </span>
              <span className="truncate text-sm font-medium">{next.title}</span>
            </span>
          )}
          {/* The dots show the count; the title gets the room. */}
          {!waitingForTomorrow && (
            <span className="sr-only">
              {doneCount}/{total}
            </span>
          )}
          {!waitingForTomorrow && (
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          )}
        </button>
        <Drawer open={drawerOpen} onOpenChange={setDrawerOpen}>
          <DrawerContent>
            <DrawerHeader className="flex flex-row items-start justify-between gap-2 text-left">
              <div className="text-left">
                <DrawerTitle>{title}</DrawerTitle>
                <div className="text-xs text-muted-foreground">{countLine}</div>
              </div>
              {/* Closes the sheet only: the row stays on the page. */}
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0"
                aria-label={t`Close`}
                onClick={() => setDrawerOpen(false)}
              >
                <X className="h-4 w-4" />
              </Button>
            </DrawerHeader>
            <div className="max-h-[70dvh] overflow-y-auto px-4 pb-6">{list}</div>
          </DrawerContent>
        </Drawer>
      </>
    );
  }

  // Folded to one row (remembered): still on the page, out of the way.
  if (steps.collapsed) {
    return (
      <Card className={cn('gap-0 py-0', className)} data-testid="first-steps">
        <button
          type="button"
          aria-expanded={false}
          onClick={() => setFirstStepsCollapsed(spaceId, false)}
          className="flex h-11 w-full items-center gap-3 rounded-xl px-4 text-left"
        >
          <ProgressDots done={doneCount} total={total} />
          <span className="min-w-0 flex-1 truncate text-sm">
            {allDone ? (
              <span className="font-medium">
                <Trans>You’ve got the basics</Trans>
              </span>
            ) : (
              <>
                <span className="text-muted-foreground">
                  <Trans>Next:</Trans>
                </span>{' '}
                <span className="font-medium">{next.title}</span>
              </>
            )}
          </span>
          <span className="sr-only">
            <Trans>Show first steps</Trans>
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        </button>
      </Card>
    );
  }

  return (
    <Card className={cn('gap-0 py-0', className)} data-testid="first-steps">
      <CardContent className="p-4">
        <div className="mb-3 flex items-start justify-between gap-2">
          <div>
            <div className="text-sm font-semibold">{title}</div>
            <div className="text-xs text-muted-foreground">{countLine}</div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0"
            aria-label={t`Collapse first steps`}
            aria-expanded
            onClick={() => setFirstStepsCollapsed(spaceId, true)}
          >
            <ChevronUp className="h-4 w-4" />
          </Button>
        </div>
        {list}
      </CardContent>
    </Card>
  );
}

function ProgressDots({ done, total }: { done: number; total: number }) {
  return (
    <span className="flex shrink-0 gap-1" aria-hidden>
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className={cn('h-1.5 w-4 rounded-full', i < done ? 'bg-emerald-600' : 'bg-muted')}
        />
      ))}
    </span>
  );
}

function StepList({
  items,
  steps,
  openIds,
  onNavigate,
  showShare,
}: {
  items: StepItem[];
  steps: FirstStepsState;
  openIds: Set<CountedFirstStepId>;
  onNavigate: () => void;
  showShare: boolean;
}) {
  const { t } = useLingui();
  const shared = steps.done.share ?? false;
  return (
    <>
      <ol className="space-y-3">
        {items.map((item) => {
          const done = isFirstStepDone(steps, item.id);
          const open = !done && openIds.has(item.id);
          return (
            <li key={item.id} className="flex gap-2.5">
              {done ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
              ) : (
                <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              )}
              <div className="min-w-0">
                <div
                  className={cn(
                    'text-sm',
                    done ? 'text-muted-foreground line-through' : 'font-medium'
                  )}
                >
                  {item.title}
                  <span className="sr-only">{done ? t`(done)` : ''}</span>
                </div>
                {open && (
                  <div className="mt-1 space-y-1 text-xs leading-relaxed text-muted-foreground">
                    <div className="text-foreground/80">{item.why}</div>
                    {item.body && <div>{item.body}</div>}
                    {item.action}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      {showShare && (
        <div className="mt-3 flex gap-2.5 border-t pt-3">
          {shared ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
          ) : (
            <Users className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          )}
          <div className="min-w-0 text-xs leading-relaxed text-muted-foreground">
            <span
              className={cn('text-sm', shared ? 'line-through' : 'font-medium text-foreground')}
            >
              <Trans>Budget with someone?</Trans>
            </span>{' '}
            <span className="text-muted-foreground">
              <Trans>Optional</Trans>
            </span>
            {!shared && (
              <div>
                <Trans>
                  Invite a partner or housemate. They get their own login and see the same budget.
                </Trans>
                <div>
                  {/* Ticks once an invite is actually created (useCreateSpaceInvite). */}
                  <Button asChild size="sm" variant="outline" className="mt-2 h-7">
                    <Link to="/settings/workspaces" onClick={onNavigate}>
                      <Trans>Invite someone</Trans>
                    </Link>
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
