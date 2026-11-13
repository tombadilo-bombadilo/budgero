import { Plural, Trans } from '@lingui/react/macro';
import { memo } from 'react';
import { cn } from '@shared/lib/utils';
import { formatMonthLabel } from '@shared/lib/date-utils';
import { asMilli, formatMilli } from '@shared/lib/currency/milli';
import type { CategoryHeaderProps } from './types';

export const CategoryHeader = memo(function CategoryHeader({
  selectedCategory,
  currentMonth,
  loading,
  totalSpent,
  goalStatus,
  dailyAllowance,
  globalLocalizer,
}: CategoryHeaderProps) {
  return (
    <div className="pb-4">
      <div className="rounded-xl border border-border/30 dark:border-white/10 ring-1 ring-black/5 dark:ring-white/5 bg-gradient-to-b from-background/70 to-background/50 dark:from-white/5 dark:to-white/[0.03] p-3 shadow-sm">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-base md:text-lg font-semibold truncate">{selectedCategory?.name}</h3>
          <span className="px-2 py-0.5 rounded-full text-[10px] md:text-xs bg-muted/60 dark:bg-white/10 border border-border/30 dark:border-white/10 whitespace-nowrap">
            {formatMonthLabel(currentMonth)}
          </span>
        </div>

        {!loading && (
          <div className="mt-2 min-w-0">
            {/* The total takes the full row and wraps as a last resort: money is never truncated. */}
            <div
              data-testid="spending-total"
              className="text-lg sm:text-xl md:text-2xl font-bold leading-tight tabular-nums break-words [overflow-wrap:anywhere]"
            >
              {formatMilli(globalLocalizer, asMilli(Math.abs(totalSpent)))}
            </div>
            <div className="mt-1 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
              <span className="text-[11px] text-muted-foreground">
                <Trans>Total Spent</Trans>
              </span>
              {goalStatus && (
                <span
                  className={cn(
                    'px-2 py-0.5 rounded-full text-[11px] font-medium border whitespace-nowrap',
                    goalStatus.isOver
                      ? 'bg-red-500/10 text-red-500 dark:text-red-400 border-red-500/30'
                      : 'bg-primary/10 text-primary border-primary/30'
                  )}
                >
                  <Trans>{goalStatus.percentage}% of goal</Trans>
                </span>
              )}
            </div>
            {goalStatus?.isOver && (
              <div
                data-testid="spending-goal-detail"
                className="mt-1 text-[11px] text-destructive tabular-nums break-words [overflow-wrap:anywhere]"
              >
                <Trans>
                  Over by {formatMilli(globalLocalizer, asMilli(0 - goalStatus.remaining))}
                </Trans>
              </div>
            )}
            {goalStatus && !goalStatus.isOver && dailyAllowance && dailyAllowance.remaining > 0 && (
              <div
                data-testid="spending-goal-detail"
                className="mt-1 text-[11px] text-muted-foreground tabular-nums break-words [overflow-wrap:anywhere]"
              >
                <Plural
                  value={dailyAllowance.daysLeft}
                  one={`${formatMilli(globalLocalizer, dailyAllowance.perDay)}/day left · # day`}
                  other={`${formatMilli(globalLocalizer, dailyAllowance.perDay)}/day left · # days`}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
});
