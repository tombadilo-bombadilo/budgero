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
  Calendar,
  AlertCircle,
  CheckCircle2,
  Clock,
  Info,
  ChevronDown,
  ChevronUp,
  Wallet,
  ArrowUpFromLine,
  CalendarClock,
} from 'lucide-react';
import { cn } from '@shared/lib/utils';
import { formatMilli, toDecimal } from '@shared/lib/currency/milli';
import { roundMilli } from '@shared/lib/currency/round-amount';
import {
  type Goal,
  type CategoryFinancials,
  type GoalProgress,
  GoalCalculations,
} from '@budgero/core/browser';
import { Popover, PopoverContent, PopoverTrigger } from '@shared/ui/popover';
import { AnimatedNumber } from '@shared/ui/animated-number';
import { GoalMessageFormatter } from '@features/goal-management/ui/GoalMessageFormatter';

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
        'inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium shadow-sm',
        getStatusColor(progress.status),
        className
      )}
    >
      {getStatusIcon(progress.status)}
      <GoalMessageFormatter
        message={progress.statusMessage}
        values={progress.statusValues}
        formatter={formatter}
      />
    </div>
  );
}

interface BreakdownItemsListProps {
  items: GoalProgress['breakdown']['items'];
  formatter: Intl.NumberFormat;
  /** Full-view variant: larger rows, muted labels, optional per-item descriptions. */
  showDescriptions?: boolean;
}

function BreakdownItemsList({
  items,
  formatter,
  showDescriptions = false,
}: BreakdownItemsListProps) {
  return (
    <div className="space-y-1">
      {items.map((item, idx) => {
        const isMonthsCount = item.label === 'Months Left' || item.label === 'Months Remaining';
        // Currency values are milliunits; month counts are dimensionless.
        const animatedValue = (
          <AnimatedNumber
            value={item.value}
            formatter={(v) =>
              isMonthsCount ? `${Math.round(v)}` : formatter.format(toDecimal(roundMilli(v)))
            }
            rounding={isMonthsCount ? 'integer' : 'none'}
            className="font-mono tabular-nums"
          />
        );
        return showDescriptions ? (
          <div key={idx} className="flex justify-between text-sm">
            <span className="text-muted-foreground">{item.label}:</span>
            <div className="text-right">
              {animatedValue}
              {item.description && (
                <div className="text-xs text-muted-foreground">{item.description}</div>
              )}
            </div>
          </div>
        ) : (
          <div key={idx} className="flex justify-between">
            <span>{item.label}:</span>
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
            <div className="text-sm font-medium">{progress.breakdown.title}</div>

            <div className="space-y-3 text-xs">
              <div className="space-y-2 rounded-lg bg-muted/50 p-3">
                <BreakdownItemsList items={progress.breakdown.items} formatter={formatter} />
              </div>

              <div className="text-muted-foreground">
                <div className="mb-2 font-medium">How it works:</div>
                <ul className="space-y-1 text-xs">
                  {progress.breakdown.explanation.map((item, idx) => (
                    <li key={idx}>• {item}</li>
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
        title="Show detailed view"
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
}: GoalCardProps) {
  const [localExpanded, setLocalExpanded] = useState(false);

  // Use GoalCalculations for pure calculations without database access
  const progress = GoalCalculations.calculateProgress(goal, finances, currentMonth);
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
          <span>No goal set for {categoryName}</span>
        </div>
        {onCreate && (
          <Button onClick={onCreate} variant="ghost" size="sm" className="h-6 px-2 text-xs">
            Create Goal
          </Button>
        )}
      </div>
    );
  }

  const getGoalTypeLabel = () => {
    switch (goal.Type) {
      case 'monthly':
        return 'Monthly Available Target';
      case 'monthly-savings':
        return 'Monthly Allocation Target';
      case 'target-date':
        return 'Yearly Allocation Target';
      case 'yearly':
        return 'Yearly Available Target';
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
        return <CalendarClock className="h-4 w-4" />;
      case 'yearly':
        return <PiggyBank className="h-4 w-4" />;
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
          <div className="flex items-center gap-1 text-[11px] leading-tight font-medium md:text-xs md:flex-grow md:min-w-0 md:order-1">
            {getGoalTypeIcon()}
            <span className="truncate">{getGoalTypeLabel()}</span>
            {!!goal.Recurring && (
              <Badge
                variant="outline"
                className="hidden text-[9px] uppercase tracking-wide md:inline-flex"
              >
                Recurring
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

          <div className="hidden md:flex md:flex-wrap md:items-center md:gap-2 md:order-3 lg:order-2 md:text-[11px] leading-tight font-semibold text-muted-foreground dark:text-white md:basis-full lg:basis-auto">
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

  // Full view (no card wrapper)
  return (
    <div className={className}>
      <div className="pb-3">
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              {getGoalTypeIcon()}
              {getGoalTypeLabel()}
              {!!goal.Recurring && (
                <Badge variant="outline" className="text-[9px] uppercase tracking-wide">
                  Recurring
                </Badge>
              )}
            </CardTitle>
            <p className="text-sm text-muted-foreground mt-1">{categoryName}</p>
          </div>
          <div className="flex items-center gap-1">
            {(compact || localExpanded) && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => setLocalExpanded(false)}
                title="Show compact view"
              >
                <ChevronUp className="h-4 w-4" />
              </Button>
            )}
            {onEdit && (
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onEdit}>
                <Edit3 className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="space-y-4">
        {/* Main Progress */}
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Progress</span>
            <AnimatedNumber
              value={progress.percentage}
              formatter={(v) => `${Math.round(v)}%`}
              rounding="integer"
              className="font-semibold tabular-nums"
            />
          </div>
          <div className="flex justify-between text-sm">
            <AnimatedNumber
              value={progress.amountSaved}
              formatter={(v) => formatter.format(toDecimal(roundMilli(v)))}
              className="tabular-nums"
            />
            <span className="text-muted-foreground">of {formatMilli(formatter, goal.Target)}</span>
          </div>
        </div>

        {/* Status Message & Recommendation */}
        <div className="space-y-2">
          <div className={cn('rounded-lg p-3 text-sm', getStatusColor(progress.status))}>
            <div className="flex items-start gap-2">
              {getStatusIcon(progress.status)}
              <div className="space-y-1">
                <div className="font-medium">
                  <GoalMessageFormatter
                    message={progress.statusMessage}
                    values={progress.statusValues}
                    formatter={formatter}
                  />
                </div>
                <div className="text-xs opacity-90">
                  <GoalMessageFormatter
                    message={progress.recommendation}
                    values={progress.recommendationValues}
                    formatter={formatter}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Breakdown Details - Always show when expanded */}
        <div className="space-y-3 pt-2 border-t">
          <div className="space-y-2">
            <h4 className="text-sm font-medium">{progress.breakdown.title}</h4>
            <BreakdownItemsList
              items={progress.breakdown.items}
              formatter={formatter}
              showDescriptions
            />
          </div>

          {/* Time Metrics */}
          {progress.timeMetrics && (
            <div className="space-y-2 pt-2 border-t">
              <h4 className="text-sm font-medium flex items-center gap-1">
                <Calendar className="h-4 w-4" />
                Timeline
              </h4>
              <div className="space-y-1 text-sm">
                {progress.timeMetrics.targetDate && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Target Date:</span>
                    <span>{progress.timeMetrics.targetDate.toLocaleDateString()}</span>
                  </div>
                )}
                {progress.timeMetrics.monthsRemaining !== undefined && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Months Remaining:</span>
                    <span>{progress.timeMetrics.monthsRemaining}</span>
                  </div>
                )}
                {progress.timeMetrics.currentStreak !== undefined &&
                  progress.timeMetrics.currentStreak > 0 && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Current Streak:</span>
                      <span>{progress.timeMetrics.currentStreak} months</span>
                    </div>
                  )}
              </div>
            </div>
          )}

          {/* Explanation */}
          <div className="space-y-2 pt-2 border-t">
            <h4 className="text-sm font-medium">How it works</h4>
            <ul className="space-y-1 text-xs text-muted-foreground">
              {progress.breakdown.explanation.map((item, idx) => (
                <li key={idx}>• {item}</li>
              ))}
            </ul>
          </div>
        </div>

        {/* Action Buttons */}
        {(onEdit || onDelete) && (
          <div className="flex justify-end gap-2 pt-2 border-t">
            {onDelete && (
              <Button variant="outline" size="sm" onClick={onDelete}>
                <Trash2 className="h-4 w-4 mr-2" />
                Delete
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
