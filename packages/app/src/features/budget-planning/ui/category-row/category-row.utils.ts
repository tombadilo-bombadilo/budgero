import type { BudgetRow } from '@features/budget-planning/lib/budget-transforms';

/**
 * Checks if an event target is an interactive element that should prevent row selection
 */
export function isInteractiveTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    target.closest('button, [role="button"], a, input, textarea, select') !== null
  );
}

/**
 * Checks if an event target is within the select handle area
 */
export function isWithinSelectHandle(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && target.closest('[data-select-handle]') !== null;
}

/**
 * Determines the status indicator color based on category state
 */
export type StatusColor = 'red' | 'green' | 'amber' | 'muted';

export interface StatusColorParams {
  available: number;
  goalStatus: BudgetRow['goalStatus'];
}

export function getStatusColor(params: StatusColorParams): StatusColor {
  const { available, goalStatus } = params;

  if (available < 0) {
    return 'red';
  }

  if (goalStatus === 'funded') return 'green';
  if (goalStatus === 'offtrack') return 'amber';
  return 'muted';
}

/**
 * Gets the CSS classes for the status indicator dot
 */
export function getStatusDotClasses(color: StatusColor): string {
  switch (color) {
    case 'red':
      return 'bg-red-500 dark:bg-red-400';
    case 'green':
      return 'bg-green-500 dark:bg-green-400';
    case 'amber':
      return 'bg-amber-500 dark:bg-amber-400';
    default:
      return 'bg-muted-foreground/40';
  }
}

/**
 * Gets the CSS classes for the card border indicator
 */
export function getCardBorderClasses(color: StatusColor): string {
  switch (color) {
    case 'red':
      return 'border-border before:bg-red-500 dark:before:bg-red-400';
    case 'green':
      return 'border-border before:bg-green-500 dark:before:bg-green-400';
    case 'amber':
      return 'border-border before:bg-amber-500 dark:before:bg-amber-400';
    default:
      return 'border-border before:bg-muted-foreground/20';
  }
}

/**
 * Validates if a move money operation is valid
 */
export function isMoveValid(
  moveAmount: number,
  available: number,
  moveTarget: number | null
): boolean {
  if (moveAmount <= 0) return false;
  if (moveAmount > Math.max(0, available || 0)) return false;
  if (moveTarget === null || moveTarget === undefined) return false;
  return true;
}
