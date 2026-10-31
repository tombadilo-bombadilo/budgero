import { roundMilli } from '@shared/lib/currency/round-amount';
import type { BudgetRow } from '../../lib/budget-transforms';

/**
 * This month's goal target for a category: the amount the goal asks for this
 * month (the full target for monthly goals, the monthly pace for yearly and
 * target-date goals). Null when the category has no goal.
 */
export function getMonthlyTarget(row: BudgetRow): number | null {
  if (!row.goal || !row.goalProgress) return null;
  return roundMilli(row.goalProgress.monthlyTarget);
}

export function getAvailableColorByGoalStatus(status: string): string {
  switch (status) {
    case 'completed':
    case 'ahead':
    case 'overfunded':
      return 'text-green-600 dark:text-green-300';
    case 'on-track':
      return 'text-blue-600 dark:text-blue-300';
    case 'behind':
      return 'text-amber-600 dark:text-amber-300';
    case 'at-risk':
    case 'overspent':
      return 'text-red-600 dark:text-red-300';
    default:
      return ''; // Return empty to use fallback logic
  }
}

export const shouldPreventRowSelection = (target: EventTarget | null) => {
  return (
    target instanceof HTMLElement && target.closest('[data-budget-prevent-row-select]') !== null
  );
};
