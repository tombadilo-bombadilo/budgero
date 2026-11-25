import { Trans, useLingui } from '@lingui/react/macro';
import { useState } from 'react';
import { AlertTriangle, CalendarRange } from 'lucide-react';
import {
  goalEffectiveFrom,
  nextGoalMonth,
  type Goal,
  type GoalTimeframeNotice,
} from '@budgero/core/browser';
import { Button } from '@shared/ui/button';
import { Label } from '@shared/ui/label';
import { Checkbox } from '@shared/ui/checkbox';
import { cn } from '@shared/lib/utils';
import MonthPickerPopover from '@shared/ui/MonthPickerPopover';
import { useUiStore } from '@shared/store/useUiStore';
import { goalTimeframeRange, type GoalTimeframeChoice } from '../lib/goal-timeframe';
import { goalMonthLabel, useGoalRangeLabel } from '../lib/goal-timeframe-labels';
import { describeGoalTarget } from '../lib/goal-currency';

interface GoalTimeframeNoticesProps {
  notices: GoalTimeframeNotice<Goal>[];
  formatter: Intl.NumberFormat;
}

/** What a save or delete does to the goal's other months, shown before it happens. */
export function GoalTimeframeNotices({ notices, formatter }: GoalTimeframeNoticesProps) {
  const { t } = useLingui();
  const numberFormat = useUiStore((state) => state.selectedBudget?.NumberFormat);
  if (notices.length === 0) return null;
  // In the goal's own currency (a timeframe can be set in another one).
  const amount = (goal: Goal) => describeGoalTarget(goal, formatter, numberFormat).target;
  const text = (notice: GoalTimeframeNotice<Goal>): string => {
    switch (notice.kind) {
      case 'shortened':
        return t`The goal of ${amount(notice.goal)} will now end in ${goalMonthLabel(notice.to)}.`;
      case 'replaced':
        return t`Replaces the goal of ${amount(notice.goal)} that starts in ${goalMonthLabel(goalEffectiveFrom(notice.goal))}.`;
      case 'removed':
        return t`Also removes the later goal of ${amount(notice.goal)} from ${goalMonthLabel(goalEffectiveFrom(notice.goal))}.`;
      case 'supersededBy':
        return t`From ${goalMonthLabel(notice.from)}, the existing goal of ${amount(notice.goal)} takes over.`;
      case 'noGoal':
        return notice.until
          ? t`No goal from ${goalMonthLabel(notice.from)} to ${goalMonthLabel(notice.until)}.`
          : t`No goal from ${goalMonthLabel(notice.from)} onwards.`;
      case 'rewritesEarlier':
        return notice.from === null
          ? t`This also changes the goal in every month before ${goalMonthLabel(nextGoalMonth(notice.to))}.`
          : t`This also changes the goal for ${goalMonthLabel(notice.from)} – ${goalMonthLabel(notice.to)}.`;
      default:
        return '';
    }
  };
  return (
    <div
      className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs text-amber-900 dark:text-amber-200"
      data-testid="goal-timeframe-notices"
      role="status"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <ul className="space-y-0.5">
          {notices.map((notice, index) => (
            <li key={index}>{text(notice)}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

interface GoalTimeframeFieldsProps {
  /** The goal of the viewed month, when editing. */
  goal: Goal | null | undefined;
  /** Every timeframe of the category's goal. */
  timeframes: readonly Goal[];
  viewedMonth: string;
  value: GoalTimeframeChoice;
  onChange: (next: GoalTimeframeChoice) => void;
  /** The months the saved goal will cover (from null = since the start). */
  range: { from: string | null; to: string | null };
}

/**
 * When the goal applies. One summary line by default; editing from a later
 * month than the goal's start offers "from this month onwards" (the default)
 * or the whole timeframe, and "Change months" picks a start and an end month.
 */
export function GoalTimeframeFields({
  goal,
  timeframes,
  viewedMonth,
  value,
  onChange,
  range,
}: GoalTimeframeFieldsProps) {
  const { t } = useLingui();
  const rangeLabel = useGoalRangeLabel();
  const [expanded, setExpanded] = useState(false);
  const start = goal ? goalEffectiveFrom(goal) : null;
  const canSplit = start !== null && viewedMonth > start;
  // A category's first goal covers every month whatever its start: only an end month matters.
  const firstGoal = !goal && timeframes.length === 0;
  const fromValue = value.from ?? start ?? viewedMonth;
  const whole = goal ? goalTimeframeRange(goal, timeframes) : null;

  return (
    <div className="space-y-2" data-testid="goal-timeframe">
      <Label className="text-xs uppercase tracking-wider text-muted-foreground">
        <Trans>Applies</Trans>
      </Label>
      {canSplit && (
        <div className="grid gap-1.5 sm:grid-cols-2" role="group" aria-label={t`Applies`}>
          {(
            [
              {
                key: 'onwards',
                from: viewedMonth,
                title: t`From ${goalMonthLabel(viewedMonth)} onwards`,
                hint: t`Earlier months keep the goal they had.`,
              },
              {
                key: 'whole',
                from: start,
                title: t`Every month of this goal`,
                hint: whole ? rangeLabel(whole.from, whole.to) : '',
              },
            ] as const
          ).map((option) => {
            const active = value.from === option.from;
            return (
              <button
                key={option.key}
                type="button"
                aria-pressed={active}
                data-testid={`goal-timeframe-${option.key}`}
                onClick={() => onChange({ ...value, from: option.from })}
                className={cn(
                  'rounded-lg border px-2.5 py-1.5 text-left text-sm transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  active
                    ? 'border-primary bg-primary/[0.04] ring-1 ring-primary/20 dark:bg-primary/10'
                    : 'border-border/60 hover:border-border hover:bg-muted/30'
                )}
              >
                <span className="block font-medium leading-tight">{option.title}</span>
                <span className="block text-xs text-muted-foreground">{option.hint}</span>
              </button>
            );
          })}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm" data-testid="goal-timeframe-summary">
          <CalendarRange className="h-4 w-4 shrink-0 text-muted-foreground" />
          {firstGoal && range.to === null
            ? t`Every month, until you change it`
            : rangeLabel(range.from, range.to)}
        </p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          aria-expanded={expanded}
          onClick={() => setExpanded((open) => !open)}
          data-testid="goal-timeframe-toggle"
        >
          {expanded ? t`Done` : t`Change months`}
        </Button>
      </div>
      {expanded && (
        <div className="grid gap-3 rounded-lg border border-border/60 p-2.5 sm:grid-cols-2">
          {!firstGoal && (
            <div className="space-y-1">
              <span className="block text-xs text-muted-foreground">
                <Trans>Applies from</Trans>
              </span>
              <MonthPickerPopover
                value={fromValue}
                onChange={(month) =>
                  onChange({
                    from: month,
                    to: value.to !== null && value.to < month ? month : value.to,
                  })
                }
                align="start"
                labelFormat="MMM yyyy"
                triggerClassName="h-8 rounded-md border px-2 text-sm"
              />
            </div>
          )}
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Checkbox
                id="goal-timeframe-ends"
                checked={value.to !== null}
                onCheckedChange={(checked) =>
                  onChange({
                    ...value,
                    to: checked ? (fromValue > viewedMonth ? fromValue : viewedMonth) : null,
                  })
                }
                data-testid="goal-timeframe-ends"
              />
              <Label htmlFor="goal-timeframe-ends" className="text-xs font-normal">
                <Trans>Ends after</Trans>
              </Label>
            </div>
            {value.to !== null ? (
              <MonthPickerPopover
                value={value.to}
                onChange={(month) =>
                  onChange({ ...value, to: month < fromValue ? fromValue : month })
                }
                align="start"
                labelFormat="MMM yyyy"
                triggerClassName="h-8 rounded-md border px-2 text-sm"
              />
            ) : (
              <p className="text-xs text-muted-foreground">
                <Trans>Ongoing</Trans>
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
