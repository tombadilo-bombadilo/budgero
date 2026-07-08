/**
 * Activity Button Component
 *
 * The "Activity" amount button (opens the spending drawer / CC activity
 * dialog) shared by the category-row layout forks. Layout-specific styling
 * comes in via className props computed at the call site.
 *
 * The desktop table's DesktopBudgetCategoryRow keeps its own version
 * (font-mono cell chrome, stopPropagation for row selection).
 */

import { ExternalLink } from 'lucide-react';
import { AnimatedNumber } from '@shared/ui/animated-number';
import { useFormatMaskedMilli } from '@features/budget-planning/lib/useFormatMaskedMilli';
import type { BudgetRow } from '@features/budget-planning/lib/budget-transforms';

export interface ActivityButtonProps {
  item: BudgetRow;
  globalLocalizer: Intl.NumberFormat;
  onActivityClick: (categoryId: number, categoryName: string) => void;
  /** Full class string for the button (including activity color classes). */
  className: string;
  iconClassName?: string;
  withTestId?: boolean;
  /** Card layout's compact section renders a plain (non-animated) amount. */
  animated?: boolean;
}

export function ActivityButton({
  item,
  globalLocalizer,
  onActivityClick,
  className,
  iconClassName = 'h-3 w-3',
  withTestId = false,
  animated = true,
}: ActivityButtonProps) {
  const formatAmount = useFormatMaskedMilli(globalLocalizer);

  return (
    <button
      onClick={() => onActivityClick(item.categoryId, item.name)}
      data-testid={
        withTestId ? `activity-${item.name.toLowerCase().replace(/\s+/g, '-')}` : undefined
      }
      className={className}
    >
      {animated ? (
        <AnimatedNumber
          value={Math.abs(item.activity)}
          formatter={formatAmount}
          className="tabular-nums"
        />
      ) : (
        formatAmount(Math.abs(item.activity))
      )}
      <ExternalLink className={`${iconClassName} text-muted-foreground`} />
    </button>
  );
}
