import { Trans, useLingui } from '@lingui/react/macro';
import { CheckCircle2, ChevronRight, Circle, Users, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import type { GetMonthlyBudgetRow } from '@budgero/core/browser';
import { Button } from '@shared/ui/button';
import { Card, CardContent } from '@shared/ui/card';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@shared/ui/drawer';
import { cn } from '@shared/lib/utils';
import { useActiveSpaceId } from '@shared/runtime/runtime-provider';
import {
  dismissFirstSteps,
  FIRST_STEP_IDS,
  markFirstStep,
  noteFirstStepsVisit,
  useFirstSteps,
  type FirstStepId,
  type FirstStepsState,
} from '@shared/lib/first-steps/first-steps';

interface FirstStepsCardProps {
  readyToAssign: number;
  /** Ready to Assign, formatted for display. */
  readyToAssignLabel: string;
  rows: GetMonthlyBudgetRow[];
  /**
   * The figures are this month's real ones, not a loading default or the
   * previous month's placeholder. Nothing is ticked until they are.
   */
  settled?: boolean;
  /** 'bar': one compact row (phones) that opens the full list in a drawer. */
  variant?: 'card' | 'bar';
  className?: string;
}

/** How long the finished checklist stays before it goes away on its own. */
const DONE_BAR_MS = 4000;

interface StepItem {
  id: FirstStepId;
  title: string;
  body: React.ReactNode;
  action?: React.ReactNode;
}

/**
 * Week-one checklist on the Budget page for a workspace set up through
 * "Fresh start". The first item is the guided first assignment: it explains
 * zero-based budgeting at the moment it applies, with the real number.
 */
export function FirstStepsCard({
  readyToAssign,
  readyToAssignLabel,
  rows,
  settled = true,
  variant = 'card',
  className,
}: FirstStepsCardProps) {
  const { t } = useLingui();
  const spaceId = useActiveSpaceId();
  const steps = useFirstSteps(spaceId);
  const assignedAny = rows.some((row) => row.Assigned > 0);
  const assignDone = steps?.done.assign ?? false;
  const announced = useRef(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const total = FIRST_STEP_IDS.length;
  const doneCount = steps ? FIRST_STEP_IDS.filter((id) => steps.done[id]).length : 0;
  const allDone = doneCount === total;

  useEffect(() => {
    if (spaceId) noteFirstStepsVisit(spaceId);
  }, [spaceId]);

  useEffect(() => {
    if (!spaceId || !steps || assignDone || !settled) return;
    if (readyToAssign === 0 && assignedAny) {
      markFirstStep(spaceId, 'assign');
      if (!announced.current) {
        announced.current = true;
        toast.success(t`Every coin has a job.`, {
          description: t`That’s the whole method: when money comes in, give it a job here.`,
        });
      }
    }
  }, [spaceId, steps, assignDone, readyToAssign, assignedAny, settled, t]);

  // Once everything is ticked, the finished list shows for a moment, then goes.
  const autoDismiss = allDone && Boolean(steps && !steps.dismissed);
  useEffect(() => {
    if (!autoDismiss || !spaceId) return;
    const timer = setTimeout(() => dismissFirstSteps(spaceId), DONE_BAR_MS);
    return () => clearTimeout(timer);
  }, [autoDismiss, spaceId]);

  if (!spaceId || !steps || steps.dismissed) return null;

  // Nothing to assign yet (no balance or income): the first step waits, and
  // the next one is what to do now.
  const nothingToAssign = settled && readyToAssign === 0 && !assignedAny && !assignDone;
  const assignBody =
    readyToAssign < 0 ? (
      <Trans>You assigned more than you have. Take some back until Ready to Assign shows 0.</Trans>
    ) : nothingToAssign ? (
      <Trans>
        Nothing to assign yet. When money comes in (an account balance or income you record), it
        shows up as Ready to Assign. Then give it a job here.
      </Trans>
    ) : variant === 'bar' ? (
      <Trans>
        You have <strong className="text-foreground">{readyToAssignLabel}</strong> to assign. Tap a
        category and enter an amount until Ready to Assign shows 0. Only budget money you already
        have.
      </Trans>
    ) : (
      <Trans>
        You have <strong className="text-foreground">{readyToAssignLabel}</strong> to assign. Type
        an amount in the Assigned column for each category until Ready to Assign shows 0. Only
        budget money you already have.
      </Trans>
    );

  const items: StepItem[] = [
    { id: 'assign', title: t`Give every coin a job`, body: assignBody },
    {
      id: 'transaction',
      title: t`Add a transaction`,
      body: <Trans>Record something you spent today, or import a file from your bank.</Trans>,
      action: (
        <Button asChild size="sm" variant="outline" className="mt-2 h-7">
          <Link to="/accounts/all" onClick={() => setDrawerOpen(false)}>
            <Trans>Go to transactions</Trans>
          </Link>
        </Button>
      ),
    },
    {
      id: 'return',
      title: t`Come back tomorrow`,
      body: (
        <Trans>
          Open Budgero tomorrow and record yesterday’s spending. A minute a day keeps it right.
        </Trans>
      ),
    },
  ];
  const nextId = items.find(
    (item) => !steps.done[item.id] && !(item.id === 'assign' && nothingToAssign)
  )?.id;
  // A waiting first step stays open too, so its note is never hidden.
  const openIds = new Set<FirstStepId>(
    [nextId, nothingToAssign ? 'assign' : undefined].filter(Boolean) as FirstStepId[]
  );

  const header = (
    <>
      <div className="text-sm font-semibold">
        {allDone ? <Trans>You’re set up</Trans> : <Trans>Your first steps</Trans>}
      </div>
      <div className="text-xs text-muted-foreground">
        <Trans>
          {doneCount} of {total} done
        </Trans>
      </div>
    </>
  );
  const list = (
    <StepList
      items={items}
      steps={steps}
      openIds={openIds}
      onNavigate={() => setDrawerOpen(false)}
    />
  );

  if (variant === 'bar') {
    const next = items.find((item) => item.id === nextId) ?? items.find((i) => i.id === 'assign')!;
    return (
      <>
        <button
          type="button"
          data-testid="first-steps"
          onClick={() => setDrawerOpen(true)}
          aria-haspopup="dialog"
          className={cn(
            'flex h-11 w-full items-center gap-3 rounded-lg border bg-card px-3 text-left',
            className
          )}
        >
          <ProgressDots done={doneCount} total={total} />
          {allDone ? (
            <span className="min-w-0 flex-1 truncate text-sm font-medium">
              <Trans>You’re set up</Trans>
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
          <span className="sr-only">
            {doneCount}/{total}
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        </button>
        <Drawer open={drawerOpen} onOpenChange={setDrawerOpen}>
          <DrawerContent>
            <DrawerHeader className="flex flex-row items-start justify-between gap-2 text-left">
              <div className="text-left">
                <DrawerTitle>
                  {allDone ? <Trans>You’re set up</Trans> : <Trans>Your first steps</Trans>}
                </DrawerTitle>
                <div className="text-xs text-muted-foreground">
                  <Trans>
                    {doneCount} of {total} done
                  </Trans>
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0"
                aria-label={t`Hide first steps`}
                onClick={() => {
                  setDrawerOpen(false);
                  dismissFirstSteps(spaceId);
                }}
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

  return (
    <Card className={cn('gap-0 py-0', className)} data-testid="first-steps">
      <CardContent className="p-4">
        <div className="mb-3 flex items-start justify-between gap-2">
          <div>{header}</div>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0"
            aria-label={t`Hide first steps`}
            onClick={() => dismissFirstSteps(spaceId)}
          >
            <X className="h-4 w-4" />
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
}: {
  items: StepItem[];
  steps: FirstStepsState;
  openIds: Set<FirstStepId>;
  onNavigate: () => void;
}) {
  const { t } = useLingui();
  const shared = steps.done.share ?? false;
  return (
    <>
      <ol className="space-y-3">
        {items.map((item) => {
          const done = steps.done[item.id];
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
                  <div className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {item.body}
                    {item.action}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      <div className="mt-3 flex gap-2.5 border-t pt-3">
        {shared ? (
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
        ) : (
          <Users className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        )}
        <div className="min-w-0 text-xs leading-relaxed text-muted-foreground">
          <span className={cn('text-sm', shared ? 'line-through' : 'font-medium text-foreground')}>
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
    </>
  );
}
