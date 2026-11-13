import type { Goal, GetMonthlyBudgetRow } from '@budgero/core/browser';
import { calculateUnderfundedGoals } from '@features/budget-planning/ui/assign-dropdown/assign-dropdown.utils';
import { asMilli, type MilliUnits } from '@shared/lib/currency/milli';

/** Categories a first goal (or a first assignment) can go to: not income, not a card payment. */
export function spendingRows(rows: GetMonthlyBudgetRow[]): GetMonthlyBudgetRow[] {
  return rows.filter(
    (row) =>
      row.CategoryID > 0 &&
      row.Category !== 'Income' &&
      row.cardBalance === undefined &&
      row.paymentCalculation === undefined
  );
}

export interface GoalToFund {
  categoryId: number;
  categoryName: string;
  /** What the goal still needs this month (0: funded). */
  needed: MilliUnits;
}

/**
 * The goal the "fund it" step talks about: the newest goal this month still
 * needs money for, else the newest goal. Null without goals on this page.
 */
export function pickGoalToFund(
  goals: Goal[],
  rows: GetMonthlyBudgetRow[],
  currentMonth: string
): GoalToFund | null {
  const shown = goals.filter((goal) => rows.some((row) => row.CategoryID === goal.CategoryID));
  if (shown.length === 0) return null;
  const newestFirst = [...shown].sort((a, b) => b.ID - a.ID);
  // Only the amounts are used; the currency only shapes formatted strings.
  const underfunded = calculateUnderfundedGoals(newestFirst, rows, 'USD', currentMonth);
  const pick =
    newestFirst.find((goal) => underfunded.some((u) => u.categoryId === goal.CategoryID)) ??
    newestFirst[0];
  const row = rows.find((r) => r.CategoryID === pick.CategoryID)!;
  return {
    categoryId: pick.CategoryID,
    categoryName: row.Category,
    needed: underfunded.find((u) => u.categoryId === pick.CategoryID)?.needed ?? asMilli(0),
  };
}
