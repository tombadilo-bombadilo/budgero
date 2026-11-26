import { Trans, useLingui } from '@lingui/react/macro';
import { useState } from 'react';
import { CardTitle } from '@shared/ui/card';
import { Button } from '@shared/ui/button';
import { Badge } from '@shared/ui/badge';
import {
  Target,
  Edit3,
  Trash2,
  TrendingUp,
  PiggyBank,
  Repeat,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Clock,
  Info,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Wallet,
  ArrowUpFromLine,
  CalendarClock,
  Flag,
} from 'lucide-react';
import { cn } from '@shared/lib/utils';
import { formatMilli, toDecimal } from '@shared/lib/currency/milli';
import { roundMilli } from '@shared/lib/currency/round-amount';
import {
  type Goal,
  type CategoryFinancials,
  type GoalProgress,
  GoalCalculations,
  getCycleMonths,
} from '@budgero/core/browser';
import { Popover, PopoverContent, PopoverTrigger } from '@shared/ui/popover';
import { Progress } from '@shared/ui/progress';
import { HelpTooltip } from '@shared/ui/HelpTooltip';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@shared/ui/collapsible';
import { AnimatedNumber } from '@shared/ui/animated-number';
import { GoalMessageFormatter } from '@features/goal-management/ui/GoalMessageFormatter';
import { translateGoalText } from '@features/goal-management/lib/core-goal-text';
import { useUiStore } from '@shared/store/useUiStore';
import { describeLocalizedGoalCycle } from '../lib/goal-cycle-label';
import { describeGoalTarget } from '../lib/goal-currency';
import { formatGoalText } from '../lib/format-goal-text';
import {
  goalCardDetailItems,
  goalCardHeadline,
  goalRecommendationAddsInfo,
} from '../lib/goal-card-view';

function getStatusColor(status: string) {
  switch (status) {
    case 'completed':
      return 'bg-green-100 text-green-700 dark:bg-emerald-500/30 dark:text-emerald-50';
    case 'on-track':
    case 'ahead':
      return 'bg-blue-100 text-blue-700 dark:bg-sky-500/30 dark:text-sky-50';
    case 'behind':
      return 'bg-amber-100 text-amber-700 dark:bg-amber-500/30 dark:text-amber-50';
    case 'at-risk':
      return 'bg-red-100 text-red-700 dark:bg-rose-500/30 dark:text-rose-50';
    default:
      return 'bg-gray-100 text-gray-700 dark:bg-slate-500/30 dark:text-slate-50';
  }
}

function getStatusIcon(status: string) {
  switch (status) {
    case 'completed':
      return <CheckCircle2 className="h-4 w-4" />;
    case 'on-track':
    case 'ahead':
      return <TrendingUp className="h-4 w-4" />;
    case 'at-risk':
      return <AlertCircle className="h-4 w-4" />;
    default:
      return <Clock className="h-4 w-4" />;
  }
}

interface GoalStatusBadgeProps {
  progress: GoalProgress;
  formatter: Intl.NumberFormat;
  className?: string;
}

function GoalStatusBadge({ progress, formatter, className = '' }: GoalStatusBadgeProps) {
  return (
    <div
      className={cn(
        'inline-flex items-center gap-1 rounded-md px-2 py-1 text-[0.6875rem] font-medium shadow-sm',
        getStatusColor(progress.status),
        className
      )}
    >
      {getStatusIcon(progress.status)}
      <GoalMessageFormatter
        message={translateGoalText(progress.statusMessage)}
        values={progress.statusValues}
        formatter={formatter}
      />
    </div>
  );
}

interface BreakdownItemsListProps {
  items: GoalProgress['breakdown']['items'];
  values?: GoalProgress['breakdown']['values'];
  formatter: Intl.NumberFormat;
  /** Full-view variant: larger rows, muted labels, descriptions as hover hints. */
  showDescriptions?: boolean;
}

function BreakdownItemsList({
  items,
  values,
  formatter,
  showDescriptions = false,
}: BreakdownItemsListProps) {
  return (
    <div className="space-y-1">
      {items.map((item, idx) => {
        // Currency values are milliunits; counts and percentages are dimensionless.
        const animatedValue = (
          <AnimatedNumber
            value={item.value}
            formatter={(v) =>
              item.unit === 'months'
                ? `${Math.round(v)}`
                : item.unit === 'percent'
                  ? `${Math.round(v)}%`
                  : formatter.format(toDecimal(roundMilli(v)))
            }
            rounding={item.unit ? 'integer' : 'none'}
            className="font-mono tabular-nums"
          />
        );
        return showDescriptions ? (
          // Card variant: label and value on one line. The helper text is a
          // hover hint, not a second line under every row.
          <div key={idx} className="flex items-baseline justify-between gap-3 text-sm">
            <span
              className="min-w-0 text-muted-foreground"
              title={
                item.description
                  ? formatGoalText(translateGoalText(item.description), values, formatter)
                  : undefined
              }
            >
              {translateGoalText(item.label)}
            </span>
            <span className="shrink-0 text-right">{animatedValue}</span>
          </div>
        ) : (
          <div key={idx} className="flex justify-between">
            <span>{translateGoalText(item.label)}:</span>
            {animatedValue}
          </div>
        );
      })}
    </div>
  );
}

interface GoalControlsProps {
  progress: GoalProgress;
  formatter: Intl.NumberFormat;
  onEdit?: () => void;
  onExpand: () => void;
  className?: string;
}

function GoalControls({
  progress,
  formatter,
  onEdit,
  onExpand,
  className = '',
}: GoalControlsProps) {
  const { t } = useLingui();

  return (
    <div className={cn('flex items-center gap-1 text-muted-foreground', className)}>
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="rounded-full p-1 transition-colors hover:text-foreground"
          >
            <Info className="h-3 w-3" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-4" side="top" align="start" modal>
          <div className="space-y-3">
            <div className="text-sm font-medium">{translateGoalText(progress.breakdown.title)}</div>

            <div className="space-y-3 text-xs">
              <div className="space-y-2 rounded-lg bg-muted/50 p-3">
                <BreakdownItemsList
                  items={progress.breakdown.items}
                  values={progress.breakdown.values}
                  formatter={formatter}
                />
              </div>

              <div className="text-muted-foreground">
                <div className="mb-2 font-medium">
                  <Trans>How it works:</Trans>
                </div>
                <ul className="space-y-1 text-xs">
                  {progress.breakdown.explanation.map((item, idx) => (
                    <li key={idx}>
                      •{' '}
                      <GoalMessageFormatter
                        message={translateGoalText(item)}
                        values={progress.breakdown.values}
                        formatter={formatter}
                      />
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </PopoverContent>
      </Popover>

      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        onClick={onExpand}
        title={t`Show detailed view`}
      >
        <ChevronDown className="h-3 w-3" />
      </Button>
      {onEdit && (
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onEdit}>
          <Edit3 className="h-3 w-3" />
        </Button>
      )}
    </div>
  );
}

interface GoalCardProps {
  goal: Goal | null;
  categoryName: string;
  finances: CategoryFinancials;
  currentMonth: string;
  formatter: Intl.NumberFormat;
  onEdit?: () => void;
  onDelete?: () => void;
  onCreate?: () => void;
  compact?: boolean;
  className?: string;
  highlightCreate?: boolean;
  /** The months this goal applies to, when it doesn't apply to all of them. */
  timeframeLabel?: string;
}

/**
 * GoalCard - A standalone component for displaying goal information
 * Can be used in any context (budget table, dashboard, reports, etc.)
 */
export function GoalCard({
  goal,
  categoryName,
  finances,
  currentMonth,
  formatter,
  onEdit,
  onDelete,
  onCreate,
  compact = false,
  className,
  highlightCreate = false,
  timeframeLabel,
}: GoalCardProps) {
  const { t } = useLingui();

  const [localExpanded, setLocalExpanded] = useState(false);
  const [howOpen, setHowOpen] = useState(false);
  const numberFormat = useUiStore((state) => state.selectedBudget?.NumberFormat);

  // Use GoalCalculations for pure calculations without database access
  const progress = GoalCalculations.calculateProgress(goal, finances, currentMonth);
  // A goal in another currency: its own amount, plus what it is in the budget currency.
  const targetDisplay = goal ? describeGoalTarget(goal, formatter, numberFormat) : null;
  const cycleMonths = goal ? getCycleMonths(goal) : null;
  const cadenceLabel = cycleMonths === null ? null : describeLocalizedGoalCycle(cycleMonths);
  const roundedPercentage = Math.round(progress.percentage);

  if (!goal) {
    return (
      <div
        className={cn(
          'rounded-md border border-dashed border-border/40 dark:border-white/10 bg-muted/10 dark:bg-white/[0.03] px-2.5 py-1.5 text-xs flex items-center justify-between',
          highlightCreate && 'ring-2 ring-primary/40',
          className
        )}
      >
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <Target className="h-3.5 w-3.5" />
          <span>
            <Trans>No goal set for {categoryName}</Trans>
          </span>
        </div>
        {onCreate && (
          <Button
            onClick={onCreate}
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            data-goal-create={highlightCreate ? 'highlighted' : undefined}
          >
            <Trans>Create Goal</Trans>
          </Button>
        )}
      </div>
    );
  }

  const isPeriodic = cycleMonths !== null && cycleMonths !== 12;
  const getGoalTypeLabel = () => {
    switch (goal.Type) {
      case 'monthly':
        return t`Monthly Available Target`;
      case 'monthly-savings':
        return t`Monthly Allocation Target`;
      case 'target-date':
        return isPeriodic ? t`Periodic Allocation Target` : t`Yearly Allocation Target`;
      case 'yearly':
        return isPeriodic ? t`Periodic Available Target` : t`Yearly Available Target`;
      case 'target-balance':
        return t`Target Balance`;
      default:
        return 'Goal';
    }
  };

  const getGoalTypeIcon = () => {
    switch (goal.Type) {
      case 'monthly':
        return <Wallet className="h-4 w-4" />;
      case 'monthly-savings':
        return <ArrowUpFromLine className="h-4 w-4" />;
      case 'target-date':
        return isPeriodic ? <Repeat className="h-4 w-4" /> : <CalendarClock className="h-4 w-4" />;
      case 'yearly':
        return isPeriodic ? <RefreshCw className="h-4 w-4" /> : <PiggyBank className="h-4 w-4" />;
      case 'target-balance':
        return <Flag className="h-4 w-4" />;
      default:
        return <Target className="h-4 w-4" />;
    }
  };

  // Compact view for embedded use (like in budget table)
  if (compact && !localExpanded) {
    return (
      <div
        className={cn(
          'rounded-md border border-border/40 bg-muted/20 px-2.5 py-2 text-xs text-muted-foreground dark:border-white/10 dark:bg-white/[0.06]',
          className
        )}
      >
        <div className="flex flex-wrap items-center gap-0 text-foreground">
          <div className="flex items-center gap-1 text-[0.6875rem] leading-tight font-medium md:text-xs md:flex-grow md:min-w-0 md:order-1">
            {getGoalTypeIcon()}
            <span className="truncate">{getGoalTypeLabel()}</span>
            {cadenceLabel && (
              <Badge
                variant="outline"
                className="hidden text-[0.5625rem] uppercase tracking-wide md:inline-flex"
                title={t`Repeats ${cadenceLabel}`}
              >
                {cadenceLabel}
              </Badge>
            )}
            {targetDisplay?.currency && (
              <Badge
                variant="outline"
                className="text-[0.5625rem] uppercase tracking-wide"
                title={t`Goal set in ${targetDisplay.currency}: ${targetDisplay.target}`}
                data-testid="goal-card-currency-badge"
              >
                {targetDisplay.currency}
              </Badge>
            )}
          </div>

          <div className="ml-auto md:hidden">
            <GoalControls
              progress={progress}
              formatter={formatter}
              onEdit={onEdit}
              onExpand={() => setLocalExpanded(true)}
            />
          </div>

          <div className="flex w-full items-center justify-between gap-2 md:hidden">
            <GoalStatusBadge progress={progress} formatter={formatter} />
          </div>

          <div className="hidden md:flex md:items-center md:gap-1.5 md:ml-auto md:order-2 md:flex-shrink-0 lg:order-3">
            <GoalControls
              progress={progress}
              formatter={formatter}
              onEdit={onEdit}
              onExpand={() => setLocalExpanded(true)}
            />
          </div>

          <div className="hidden md:flex md:flex-wrap md:items-center md:gap-2 md:order-3 lg:order-2 md:text-[0.6875rem] leading-tight font-semibold text-muted-foreground dark:text-white md:basis-full lg:basis-auto">
            <span className="leading-tight">{roundedPercentage}%</span>
            <GoalStatusBadge
              progress={progress}
              formatter={formatter}
              className="flex-shrink-0 leading-tight"
            />
          </div>
        </div>
      </div>
    );
  }

  // Full view (no card wrapper). Embedded (opened from the compact row inside a
  // category card): the category card's type scale, one-line title.
  const embedded = compact;
  const headline = goalCardHeadline(goal, progress, finances);
  const detailItems = goalCardDetailItems(progress, headline.amount);
  const showRecommendation = goalRecommendationAddsInfo(progress);
  const { timeMetrics } = progress;
  const hasTimeline = !!timeMetrics?.targetDate || timeMetrics?.monthsRemaining !== undefined;
  const currencyNote = targetDisplay?.currency
    ? targetDisplay.rateSource === 'missing'
      ? t`No ${targetDisplay.currency} exchange rate yet, so the target counts one to one until one is available.`
      : targetDisplay.rateSource === 'stale'
        ? t`Goal set in ${targetDisplay.currency}, converted at the last known rate (no recent rate available).`
        : t`Goal set in ${targetDisplay.currency}, converted at today's rate.`
    : null;
  // A missing or old rate changes what the numbers mean: say it out loud.
  // Today's rate is the normal case: a hint on hover is enough.
  const currencyWarning =
    targetDisplay?.rateSource === 'missing' || targetDisplay?.rateSource === 'stale';

  return (
    <div className={className}>
      {/* Title row. The category name is not repeated: the panel or row
          around the card already names it. min-w-0 + wrapping: in a narrow
          panel (or a long translation) the title must wrap instead of pushing
          the buttons out of view. */}
      <div className={cn('flex items-start justify-between gap-2', embedded ? 'pb-2' : 'pb-3')}>
        <CardTitle
          className={cn(
            'flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 break-words',
            embedded ? 'text-sm' : 'text-base'
          )}
        >
          {/* Icon and label wrap as one unit: the icon never sits alone on a line. */}
          <span className="flex min-w-0 items-start gap-2">
            <span className="mt-[0.15em] shrink-0">{getGoalTypeIcon()}</span>
            <span className={cn('min-w-0', embedded && 'truncate')}>{getGoalTypeLabel()}</span>
          </span>
          {cadenceLabel && (
            <Badge
              variant="outline"
              className="max-w-full shrink whitespace-normal text-left text-[0.5625rem] uppercase tracking-wide"
            >
              <Trans>Repeats {cadenceLabel}</Trans>
            </Badge>
          )}
        </CardTitle>
        <div className="-mt-1 flex shrink-0 items-center gap-1">
          {(compact || localExpanded) && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => setLocalExpanded(false)}
              title={t`Show compact view`}
            >
              <ChevronUp className="h-4 w-4" />
            </Button>
          )}
          {onEdit && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={onEdit}
              title={t`Edit Goal`}
            >
              <Edit3 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      <div className={embedded ? 'space-y-3' : 'space-y-4'}>
        {/* Headline: how far along, against what. */}
        <div className="space-y-1.5" data-testid="goal-card-headline">
          <div className="flex items-baseline justify-between gap-3">
            <AnimatedNumber
              value={headline.amount}
              formatter={(v) => formatter.format(toDecimal(roundMilli(v)))}
              className={cn(
                'min-w-0 font-mono font-semibold tabular-nums',
                embedded ? 'text-sm' : 'text-lg'
              )}
            />
            <AnimatedNumber
              value={headline.percentage}
              formatter={(v) => `${Math.round(v)}%`}
              rounding="integer"
              className="shrink-0 text-sm font-medium tabular-nums text-muted-foreground"
            />
          </div>
          <Progress value={headline.percentage} className="h-1.5" aria-label={t`Goal progress`} />
          <div
            className="flex flex-wrap items-center gap-x-1 text-xs text-muted-foreground"
            data-testid="goal-card-target"
          >
            {targetDisplay?.currency ? (
              <>
                <span className="whitespace-nowrap">
                  <Trans>of {targetDisplay.target}</Trans>
                </span>
                {targetDisplay.converted && (
                  <span className="whitespace-nowrap font-mono">≈ {targetDisplay.converted}</span>
                )}
                {!currencyWarning && (
                  <>
                    <HelpTooltip contentClassName="max-w-60" iconClassName="h-3 w-3">
                      {currencyNote}
                    </HelpTooltip>
                    <span className="sr-only" data-testid="goal-card-currency-note">
                      {currencyNote}
                    </span>
                  </>
                )}
              </>
            ) : (
              <span className="whitespace-nowrap">
                <Trans>of {formatMilli(formatter, goal.Target)}</Trans>
              </span>
            )}
          </div>
          {currencyWarning && (
            <p
              className="flex items-start gap-1 text-xs text-amber-700 dark:text-amber-300"
              data-testid="goal-card-currency-note"
            >
              <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
              <span>{currencyNote}</span>
            </p>
          )}
        </div>

        {/* The one thing to do (or the good news). */}
        <div
          className={cn('rounded-md px-3 py-2 text-sm', getStatusColor(progress.status))}
          data-testid="goal-card-status"
        >
          <div className="flex items-start gap-2">
            <span className="mt-0.5 shrink-0">{getStatusIcon(progress.status)}</span>
            <div className="min-w-0 space-y-0.5">
              <div className="font-medium">
                <GoalMessageFormatter
                  message={translateGoalText(progress.statusMessage)}
                  values={progress.statusValues}
                  formatter={formatter}
                />
              </div>
              {showRecommendation && (
                <div className="text-xs opacity-90">
                  <GoalMessageFormatter
                    message={translateGoalText(progress.recommendation)}
                    values={progress.recommendationValues}
                    formatter={formatter}
                  />
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Details: only rows the headline and status line don't already show. */}
        {(detailItems.length > 0 || hasTimeline) && (
          <div className="space-y-1" data-testid="goal-card-details">
            <BreakdownItemsList
              items={detailItems}
              values={progress.breakdown.values}
              formatter={formatter}
              showDescriptions
            />
            {timeMetrics?.targetDate && (
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="text-muted-foreground">
                  <Trans>Target Date</Trans>
                </span>
                <span>{timeMetrics.targetDate.toLocaleDateString()}</span>
              </div>
            )}
            {timeMetrics?.monthsRemaining !== undefined && (
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="text-muted-foreground">
                  <Trans>Months Remaining</Trans>
                </span>
                <span className="tabular-nums">{timeMetrics.monthsRemaining}</span>
              </div>
            )}
          </div>
        )}

        {timeframeLabel && (
          <p className="text-xs text-muted-foreground" data-testid="goal-timeframe-label">
            <Trans>Applies: {timeframeLabel}</Trans>
          </p>
        )}

        {/* Footer: the explanation on demand, and delete. */}
        <Collapsible open={howOpen} onOpenChange={setHowOpen}>
          <div className="flex items-center justify-between gap-2 border-t pt-2">
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="-ml-1 inline-flex items-center gap-1 rounded px-1 py-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
                data-testid="goal-card-how-it-works"
              >
                <ChevronRight
                  className={cn('h-3.5 w-3.5 transition-transform', howOpen && 'rotate-90')}
                />
                <Trans>How it works</Trans>
              </button>
            </CollapsibleTrigger>
            {onDelete && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
                onClick={onDelete}
              >
                <Trans>
                  <Trash2 className="mr-1 h-3.5 w-3.5" />
                  Delete
                </Trans>
              </Button>
            )}
          </div>
          <CollapsibleContent>
            <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
              {progress.breakdown.explanation.map((item, idx) => (
                <li key={idx}>
                  •{' '}
                  <GoalMessageFormatter
                    message={translateGoalText(item)}
                    values={progress.breakdown.values}
                    formatter={formatter}
                  />
                </li>
              ))}
            </ul>
          </CollapsibleContent>
        </Collapsible>
      </div>
    </div>
  );
}
