import { TrendingUp, TrendingDown } from 'lucide-react';
import { trendTextClass } from '@shared/lib/amount-color';

interface TrendIndicatorProps {
  /** Signed change amount. The caller guards against rendering when this is 0. */
  change: number;
  /** Signed percentage change. */
  percentage: number;
  /** Formats the (absolute) change amount shown in parentheses. */
  formatAmount: (value: number) => string;
  /**
   * When false (default), "up is good": an increase is green (e.g. balance).
   * When true, "down is good": a decrease is green (e.g. spending), the
   * percentage is shown as an absolute value, and the color is computed inline
   * rather than via {@link trendTextClass}.
   */
  invert?: boolean;
  /** Center the row horizontally (mobile) instead of left-aligning (desktop). */
  center?: boolean;
}

/**
 * Up/down trend arrow with a signed percentage and the absolute change amount,
 * color-coded green/red. Shared by the dashboard balance and spending cards.
 */
export function TrendIndicator({
  change,
  percentage,
  formatAmount,
  invert = false,
  center = false,
}: TrendIndicatorProps) {
  // "Good" direction: up for balance (change >= 0), down for spending
  // (change <= 0). The arrow points along the actual change and is colored
  // green when the move is good, red otherwise.
  const isGood = invert ? change <= 0 : change >= 0;
  const arrowPointsUp = invert ? !isGood : isGood;
  const arrowColor = isGood ? 'text-green-600' : 'text-red-600';
  // Balance derives its percentage color from the shared trendTextClass helper;
  // spending computes it inline (which matches `isGood` here).
  const percentageColor = invert ? arrowColor : trendTextClass(change);
  const displayPercentage = invert ? Math.abs(percentage) : percentage;

  return (
    <div className={`flex items-center gap-1 mt-2${center ? ' justify-center' : ''}`}>
      {arrowPointsUp ? (
        <TrendingUp className={`h-4 w-4 ${arrowColor}`} />
      ) : (
        <TrendingDown className={`h-4 w-4 ${arrowColor}`} />
      )}
      <span className={`text-sm font-medium ${percentageColor}`}>
        {percentage >= 0 ? '+' : ''}
        {displayPercentage.toFixed(1)}%
      </span>
      <span className="text-xs text-muted-foreground ml-1">({formatAmount(Math.abs(change))})</span>
    </div>
  );
}
