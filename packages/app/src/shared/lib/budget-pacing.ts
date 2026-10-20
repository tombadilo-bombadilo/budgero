import { getDaysInMonth } from 'date-fns';
import { asMilli, type MilliUnits } from '@shared/lib/currency/milli';

export interface DailyAllowance {
  /** What can still be spent per day to end the month at the goal (0 once over it). */
  perDay: MilliUnits;
  /** Days left in the month, today included. */
  daysLeft: number;
  /** Goal minus spent; negative when over the goal. */
  remaining: MilliUnits;
}

/**
 * How much of a monthly goal is left per day for `month` (YYYY-MM) as of
 * `today`. A future month spreads the whole remainder over all its days; a past
 * month has no days left, so it returns null.
 */
export function calculateDailyAllowance(
  goal: MilliUnits | number | undefined,
  spent: MilliUnits | number,
  month: string,
  today: Date = new Date()
): DailyAllowance | null {
  if (!goal || goal <= 0) return null;
  const [year, monthNumber] = month.split('-').map(Number);
  if (!year || !monthNumber) return null;

  const todayKey = today.getFullYear() * 12 + today.getMonth();
  const monthKey = year * 12 + (monthNumber - 1);
  if (monthKey < todayKey) return null;

  const daysInMonth = getDaysInMonth(new Date(year, monthNumber - 1, 1));
  const daysLeft = monthKey > todayKey ? daysInMonth : daysInMonth - today.getDate() + 1;
  const remaining = goal - spent;

  return {
    // Floor so following the allowance every day never ends above the goal.
    perDay: asMilli(remaining > 0 ? Math.floor(remaining / daysLeft) : 0),
    daysLeft,
    remaining: asMilli(remaining),
  };
}
