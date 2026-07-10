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
          <div className="mt-2 flex items-end justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xl md:text-2xl font-bold truncate">
                {formatMilli(globalLocalizer, totalSpent)}
              </div>
              <div className="text-[11px] text-muted-foreground">Total Spent</div>
            </div>

            {goalStatus && (
              <div className="flex flex-col items-end gap-1 shrink-0 text-right">
                <span
                  className={cn(
                    'px-2 py-0.5 rounded-full text-[11px] font-medium border whitespace-nowrap',
                    goalStatus.isOver
                      ? 'bg-red-500/10 text-red-500 dark:text-red-400 border-red-500/30'
                      : 'bg-primary/10 text-primary border-primary/30'
                  )}
                >
                  {goalStatus.percentage}% of goal
                </span>
                {goalStatus.isOver && (
                  <span className="text-[11px] text-destructive whitespace-nowrap">
                    Over by {formatMilli(globalLocalizer, asMilli(0 - goalStatus.remaining))}
                  </span>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
});
