/**
 * Tailwind text-color helpers for signed monetary values.
 *
 * Centralizes the red/green sign-coloring repeated across budget rows, trend
 * cards, and reports so the palette lives in one place.
 */

/** Color for a signed trend/delta: green when ≥ 0, red when negative. */
export function trendTextClass(value: number): string {
  return value >= 0 ? 'text-green-600' : 'text-red-600';
}

/**
 * Color for an "available" balance that turns red when negative. Returns
 * `neutral` (default `text-foreground`) when the value is ≥ 0.
 */
export function availableAmountClass(value: number, neutral = 'text-foreground'): string {
  return value < 0 ? 'text-red-600 dark:text-red-300' : neutral;
}

/**
 * Three-way color for a category "activity" amount: red when spending (< 0),
 * green when inflow (> 0), and neutral `text-foreground` at zero.
 */
export function activityTextClass(value: number): string {
  if (value < 0) return 'text-red-600 dark:text-red-300';
  if (value > 0) return 'text-green-600 dark:text-green-300';
  return 'text-foreground';
}
