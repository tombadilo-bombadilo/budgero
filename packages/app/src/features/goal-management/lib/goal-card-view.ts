import {
  GoalType,
  goalTargetInBudgetCurrency,
  type CategoryFinancials,
  type Goal,
  type GoalProgress,
} from '@budgero/core/browser';

type BreakdownItem = GoalProgress['breakdown']['items'][number];

const TOKEN = /\{\{(\w+)\}\}/g;

/** The numbers a goal message template shows (its {{tokens}} that are amounts). */
function shownAmounts(
  message: string,
  values: Record<string, number | string> | undefined
): Set<number> {
  const amounts = new Set<number>();
  if (!values) return amounts;
  for (const [, key] of message.matchAll(TOKEN)) {
    const value = values[key];
    if (typeof value === 'number') amounts.add(value);
  }
  return amounts;
}

export interface GoalCardHeadline {
  /** The amount the progress bar measures (milliunits, budget currency). */
  amount: number;
  /** What it is measured against: the goal's target in the budget currency. */
  target: number;
  /** amount / target, 0–100. */
  percentage: number;
}

/**
 * The card's headline: one amount, its target and the share between them, so
 * the number, the "of …" line and the progress bar always agree.
 *
 * Monthly allocation goals measure this month's assignment (the balance they
 * build up is a detail row). Every other type measures the amount the core
 * tracks toward the full target; for yearly goals that is the whole cycle,
 * while the status line covers this month's pace.
 */
export function goalCardHeadline(
  goal: Goal,
  progress: GoalProgress,
  finances: Pick<CategoryFinancials, 'assigned'>
): GoalCardHeadline {
  const target = goalTargetInBudgetCurrency(goal);
  const amount =
    goal.Type === GoalType.MONTHLY_SAVINGS ? (finances.assigned ?? 0) : progress.amountSaved;
  const percentage =
    target > 0 ? Math.min(100, Math.max(0, (amount / target) * 100)) : progress.percentage;
  return { amount, target, percentage };
}

/** Rows that can repeat the headline amount or the status line's amount. */
const HEADLINE_LABELS = new Set(['Currently Available', 'Total Allocated', 'Saved This Month']);
const NEEDED_LABELS = new Set(['Still Needed', 'Allocate This Month']);

/**
 * The breakdown rows worth showing under the card's headline and status line.
 *
 * The headline already shows the target (always the first breakdown row) and
 * progress toward it; the status line shows the amount to act on. Rows that
 * repeat either are dropped so each number appears once.
 */
export function goalCardDetailItems(
  progress: GoalProgress,
  headlineAmount: number
): BreakdownItem[] {
  const statusAmounts = shownAmounts(progress.statusMessage, progress.statusValues);
  return progress.breakdown.items.filter((item, idx) => {
    if (idx === 0) return false; // the target: shown in the headline
    if (item.unit) return true;
    if (HEADLINE_LABELS.has(item.label) && item.value === headlineAmount) return false;
    if (NEEDED_LABELS.has(item.label) && statusAmounts.has(item.value)) return false;
    return true;
  });
}

/**
 * Whether the recommendation says something the status line doesn't.
 * "Need $43 more available" + "Assign $43 to reach your target" is one fact
 * twice; "On track" + "$300 still needed over 4 more months" is two.
 */
export function goalRecommendationAddsInfo(progress: GoalProgress): boolean {
  if (!progress.recommendation) return false;
  const recAmounts = shownAmounts(progress.recommendation, progress.recommendationValues);
  if (recAmounts.size === 0) {
    // A plain sentence. Once the goal is met the status already says so.
    return !progress.isFunded;
  }
  const statusAmounts = shownAmounts(progress.statusMessage, progress.statusValues);
  for (const amount of recAmounts) {
    if (statusAmounts.has(amount)) return false;
  }
  return true;
}
