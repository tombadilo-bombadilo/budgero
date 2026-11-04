import { Trans, useLingui } from '@lingui/react/macro';
import { CheckCircle2, Circle, Users, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import type { GetMonthlyBudgetRow } from '@budgero/core/browser';
import { Button } from '@shared/ui/button';
import { Card, CardContent } from '@shared/ui/card';
import { cn } from '@shared/lib/utils';
import { useActiveSpaceId } from '@shared/runtime/runtime-provider';
import {
  dismissFirstSteps,
  FIRST_STEP_IDS,
  markFirstStep,
  noteFirstStepsVisit,
  useFirstSteps,
  type FirstStepId,
} from '@shared/lib/first-steps/first-steps';

interface FirstStepsCardProps {
  readyToAssign: number;
  /** Ready to Assign, formatted for display. */
  readyToAssignLabel: string;
  rows: GetMonthlyBudgetRow[];
  className?: string;
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
  className,
}: FirstStepsCardProps) {
  const { t } = useLingui();
  const spaceId = useActiveSpaceId();
  const steps = useFirstSteps(spaceId);
  const assignedAny = rows.some((row) => row.Assigned > 0);
  const assignDone = steps?.done.assign ?? false;
  const announced = useRef(false);

  useEffect(() => {
    if (spaceId) noteFirstStepsVisit(spaceId);
  }, [spaceId]);

  useEffect(() => {
    if (!spaceId || !steps || assignDone) return;
    if (readyToAssign === 0 && assignedAny) {
      markFirstStep(spaceId, 'assign');
      if (!announced.current) {
        announced.current = true;
        toast.success(t`Every coin has a job.`, {
          description: t`That’s the whole method: when money comes in, give it a job here.`,
        });
      }
    }
  }, [spaceId, steps, assignDone, readyToAssign, assignedAny, t]);

  if (!spaceId || !steps || steps.dismissed) return null;
  const doneCount = FIRST_STEP_IDS.filter((id) => steps.done[id]).length;
  const allDone = doneCount === FIRST_STEP_IDS.length;

  const items: {
    id: FirstStepId;
    title: string;
    body: React.ReactNode;
    action?: React.ReactNode;
  }[] = [
    {
      id: 'assign',
      title: t`Give every coin a job`,
      body:
        readyToAssign < 0 ? (
          <Trans>
            You assigned more than you have. Take some back until Ready to Assign shows 0.
          </Trans>
        ) : (
          <Trans>
            You have <strong className="text-foreground">{readyToAssignLabel}</strong> to assign.
            Type an amount in the Assigned column for each category until Ready to Assign shows 0.
            Only budget money you already have.
          </Trans>
        ),
    },
    {
      id: 'transaction',
      title: t`Add a transaction`,
      body: <Trans>Record something you spent today, or import a file from your bank.</Trans>,
      action: (
        <Button asChild size="sm" variant="outline" className="mt-2 h-7">
          <Link to="/accounts/all">
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
  const nextId = items.find((item) => !steps.done[item.id])?.id;
  const shared = steps.done.share ?? false;

  return (
    <Card className={cn('gap-0 py-0', className)} data-testid="first-steps">
      <CardContent className="p-4">
        <div className="mb-3 flex items-start justify-between gap-2">
          <div>
            <div className="text-sm font-semibold">
              {allDone ? <Trans>You’re set up</Trans> : <Trans>Your first steps</Trans>}
            </div>
            <div className="text-xs text-muted-foreground">
              <Trans>
                {doneCount} of {FIRST_STEP_IDS.length} done
              </Trans>
            </div>
          </div>
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
        <ol className="space-y-3">
          {items.map((item) => {
            const done = steps.done[item.id];
            const open = item.id === nextId;
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
                  <Button asChild size="sm" variant="outline" className="mt-2 h-7">
                    <Link to="/settings/workspaces" onClick={() => markFirstStep(spaceId, 'share')}>
                      <Trans>Invite someone</Trans>
                    </Link>
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
