import {
  GoalCalculations,
  type CategoryFinancials,
  GetMonthlyBudgetRow,
  GoalPurpose,
  GoalType,
  type Goal,
} from '@budgero/core/browser';
import { asMilli, formatMilli, sumMilli, type MilliUnits } from '@shared/lib/currency/milli';
import { roundMilli } from '@shared/lib/currency/round-amount';

// Types for calculated category data. All amounts are integer milliunits.
export interface UnderfundedGoal {
  categoryId: number;
  categoryName: string;
  needed: MilliUnits;
  target: MilliUnits;
  current: MilliUnits;
  type: GoalType;
  purpose: GoalPurpose;
}

export interface OverspentCategory {
  categoryId: number;
  categoryName: string;
  overspent: MilliUnits;
  available: MilliUnits;
}

export interface OverfundedCategory {
  categoryId: number;
  categoryName: string;
  currentAssigned: MilliUnits;
  available: MilliUnits;
  excess: MilliUnits;
  safeReduction: MilliUnits;
  target: MilliUnits;
  type: GoalType;
  purpose: GoalPurpose;
}

export interface AssignmentSummary {
  categoryName: string;
  amount: MilliUnits;
}

export interface ResetSummary {
  categoryName: string;
  amount: MilliUnits;
  newAssigned: MilliUnits;
}

export interface ChangeSummary {
  categoryName: string;
  delta: MilliUnits;
}

/**
 * Historical/planned assignments per category. Required for yearly and
 * target-date goals — without it their cycle totals only see the current
 * month and report already-funded goals as underfunded.
 */
export type CycleFinancialsMap = Record<number, CategoryFinancials>;

function buildFinances(
  row: GetMonthlyBudgetRow,
  categoryId: number,
  currencyCode: string,
  cycleFinancials?: CycleFinancialsMap
): CategoryFinancials {
  const cycle = cycleFinancials?.[categoryId];
  return {
    available: row.Available || 0,
    assigned: row.Assigned || 0,
    activity: row.Activity || 0,
    currencyCode,
    historicalAssignments: cycle?.historicalAssignments,
    plannedAssignments: cycle?.plannedAssignments,
  };
}

export function calculateUnderfundedGoals(
  goals: Goal[],
  budgetData: GetMonthlyBudgetRow[],
  currencyCode: string,
  currentMonth: string,
  cycleFinancials?: CycleFinancialsMap
): UnderfundedGoal[] {
  return goals
    .map((goal) => {
      const row = budgetData.find((r) => r.CategoryID === goal.CategoryID);
      if (!row) return null;

      const finances = buildFinances(row, goal.CategoryID, currencyCode, cycleFinancials);
      const progress = GoalCalculations.calculateProgress(goal, finances, currentMonth);

      if (progress.isFunded) return null;

      // Each goal type returns the correct amountNeeded from its calculation:
      // - Monthly Available: max(0, target - available)
      // - Monthly Allocation: max(0, target - assigned)
      // - Yearly Allocation: monthly milestone (max(0, monthlyTarget - assigned))
      // - Yearly Available: monthly milestone (max(0, monthlyTarget - assigned))
      // Progress values may be float milli (pace math divides the target), so
      // round back to integer milliunits before they feed assignments.
      let needed: MilliUnits;
      if (goal.Type === 'target-date' || goal.Type === 'yearly') {
        // Yearly goals: fund the monthly milestone, not the entire remaining amount
        needed = roundMilli(Math.max(0, progress.monthlyTarget - (row.Assigned || 0)));
      } else {
        // Monthly goals: amountNeeded is already what's needed this month
        needed = roundMilli(progress.amountNeeded);
      }

      return {
        categoryId: row.CategoryID,
        categoryName: row.Category,
        needed,
        target: roundMilli(progress.monthlyTarget),
        current: roundMilli(progress.amountSaved),
        type: goal.Type,
        purpose: goal.Purpose,
      };
    })
    .filter((g): g is UnderfundedGoal => g !== null && g.needed > 0)
    .sort((a, b) => b.needed - a.needed);
}

export function calculateOverspentCategories(
  budgetData: GetMonthlyBudgetRow[]
): OverspentCategory[] {
  return budgetData
    .filter((row) => row.CategoryID > 0 && row.Available < 0)
    .map((row) => ({
      categoryId: row.CategoryID,
      categoryName: row.Category,
      overspent: asMilli(Math.abs(row.Available)),
      available: row.Available,
    }))
    .sort((a, b) => b.overspent - a.overspent);
}

export function calculateOverfundedCategories(
  goals: Goal[],
  budgetData: GetMonthlyBudgetRow[],
  currencyCode: string,
  currentMonth: string,
  cycleFinancials?: CycleFinancialsMap
): OverfundedCategory[] {
  return goals
    .map((goal) => {
      const row = budgetData.find((r) => r.CategoryID === goal.CategoryID);
      if (!row) return null;

      const finances = buildFinances(row, goal.CategoryID, currencyCode, cycleFinancials);
      const progress = GoalCalculations.calculateProgress(goal, finances, currentMonth);

      // overfundedAmount is computed per goal type by the core calculation.
      // Reducing the assignment can't go below zero assigned and shouldn't
      // push available negative, so cap the suggestion at both.
      const excess = roundMilli(progress.overfundedAmount);
      const safeReduction = asMilli(Math.min(excess, row.Assigned || 0, row.Available || 0));

      if (safeReduction <= 0) return null;

      return {
        categoryId: row.CategoryID,
        categoryName: row.Category,
        currentAssigned: asMilli(row.Assigned || 0),
        available: asMilli(row.Available || 0),
        excess,
        safeReduction,
        target: roundMilli(progress.monthlyTarget),
        type: goal.Type,
        purpose: goal.Purpose,
      };
    })
    .filter((c): c is OverfundedCategory => c !== null)
    .sort((a, b) => b.safeReduction - a.safeReduction);
}

export function calculateTotals(
  underfundedGoals: UnderfundedGoal[],
  overspentCategories: OverspentCategory[],
  overfundedCategories: OverfundedCategory[]
) {
  return {
    totalUnderfunded: sumMilli(underfundedGoals.map((g) => g.needed)),
    totalOverspent: sumMilli(overspentCategories.map((c) => c.overspent)),
    totalSafeReduction: sumMilli(overfundedCategories.map((c) => c.safeReduction)),
  };
}

export function prepareUnderfundedAssignments(
  underfundedGoals: UnderfundedGoal[],
  readyToAssign: number,
  budgetData: GetMonthlyBudgetRow[]
): {
  assignments: AssignmentSummary[];
  remaining: number;
  batchAssignments: { categoryId: number; amount: number }[];
} {
  let remaining = readyToAssign;
  const assignments: AssignmentSummary[] = [];
  const batchAssignments: { categoryId: number; amount: number }[] = [];

  for (const goal of underfundedGoals) {
    if (remaining <= 0) break;

    const amountToAssign = asMilli(Math.min(goal.needed, remaining));
    const currentAssigned = budgetData.find((r) => r.CategoryID === goal.categoryId)?.Assigned || 0;
    const newAssignment = currentAssigned + amountToAssign;

    batchAssignments.push({
      categoryId: goal.categoryId,
      amount: newAssignment,
    });

    remaining -= amountToAssign;
    assignments.push({
      categoryName: goal.categoryName,
      amount: amountToAssign,
    });
  }

  return { assignments, remaining, batchAssignments };
}

export function prepareOverspentAssignments(
  overspentCategories: OverspentCategory[],
  readyToAssign: number,
  budgetData: GetMonthlyBudgetRow[]
): {
  assignments: AssignmentSummary[];
  remaining: number;
  batchAssignments: { categoryId: number; amount: number }[];
} {
  let remaining = readyToAssign;
  const assignments: AssignmentSummary[] = [];
  const batchAssignments: { categoryId: number; amount: number }[] = [];

  for (const category of overspentCategories) {
    if (remaining <= 0) break;

    const amountToAssign = asMilli(Math.min(category.overspent, remaining));
    const currentAssigned =
      budgetData.find((r) => r.CategoryID === category.categoryId)?.Assigned || 0;
    const newAssignment = currentAssigned + amountToAssign;

    batchAssignments.push({
      categoryId: category.categoryId,
      amount: newAssignment,
    });

    remaining -= amountToAssign;
    assignments.push({
      categoryName: category.categoryName,
      amount: amountToAssign,
    });
  }

  return { assignments, remaining, batchAssignments };
}

export function prepareOverfundedReductions(overfundedCategories: OverfundedCategory[]): {
  reductions: AssignmentSummary[];
  totalReduced: MilliUnits;
  batchAssignments: { categoryId: number; amount: number }[];
} {
  const reductions: AssignmentSummary[] = [];

  const batchAssignments = overfundedCategories.map((category) => {
    const amountToReduce = category.safeReduction;
    const newAssignment = category.currentAssigned - amountToReduce;

    reductions.push({
      categoryName: category.categoryName,
      amount: amountToReduce,
    });

    return {
      categoryId: category.categoryId,
      amount: Math.max(0, newAssignment),
    };
  });

  const totalReduced = sumMilli(reductions.map((r) => r.amount));
  return { reductions, totalReduced, batchAssignments };
}

export function prepareResetAvailableAssignments(budgetData: GetMonthlyBudgetRow[]): {
  resets: ResetSummary[];
  batchAssignments: { categoryId: number; amount: number }[];
} {
  const categoriesToReset = budgetData.filter((row) => row.CategoryID > 0);
  const resets: ResetSummary[] = [];

  const allAssignments = categoriesToReset.map((category) => {
    const currentAssigned = category.Assigned || 0;
    const currentAvailable = category.Available || 0;
    const newAssignment = asMilli(currentAssigned - currentAvailable);

    resets.push({
      categoryName: category.Category,
      amount: asMilli(newAssignment - currentAssigned),
      newAssigned: newAssignment,
    });

    return {
      categoryId: category.CategoryID,
      amount: newAssignment,
    };
  });

  // Filter out categories that don't need changes (amounts are exact integers)
  const changedIndices = resets.map((r, i) => (r.amount !== 0 ? i : -1)).filter((i) => i !== -1);

  const batchAssignments = changedIndices.map((i) => allAssignments[i]);

  return { resets, batchAssignments };
}

export function prepareResetAssignedAssignments(budgetData: GetMonthlyBudgetRow[]): {
  changes: ChangeSummary[];
  batchAssignments: { categoryId: number; amount: number }[];
} {
  const categoriesToProcess = budgetData.filter((row) => row.CategoryID > 0);
  const changes: ChangeSummary[] = [];

  const batchAssignments = categoriesToProcess.map((category) => {
    const currentAssigned = category.Assigned || 0;
    const delta = asMilli(0 - currentAssigned);
    if (delta !== 0) {
      changes.push({ categoryName: category.Category, delta });
    }
    return {
      categoryId: category.CategoryID,
      amount: 0,
    };
  });

  return { changes, batchAssignments };
}

// Format assignment details for toast
export function formatAssignmentDetails(
  assignments: AssignmentSummary[],
  globalLocalizer: Intl.NumberFormat,
  maxItems = 5
): { details: string; moreText: string } {
  const details = assignments
    .slice(0, maxItems)
    .map((a) => `${a.categoryName}: ${formatMilli(globalLocalizer, a.amount)}`)
    .join('\n');

  const moreText =
    assignments.length > maxItems ? `\n...and ${assignments.length - maxItems} more` : '';

  return { details, moreText };
}

// Format reduction details for toast
export function formatReductionDetails(
  reductions: AssignmentSummary[],
  globalLocalizer: Intl.NumberFormat,
  maxItems = 5
): { details: string; moreText: string } {
  const details = reductions
    .slice(0, maxItems)
    .map((r) => `${r.categoryName}: -${formatMilli(globalLocalizer, r.amount)}`)
    .join('\n');

  const moreText =
    reductions.length > maxItems ? `\n...and ${reductions.length - maxItems} more` : '';

  return { details, moreText };
}

// Format reset details for toast
export function formatResetDetails(
  resets: ResetSummary[],
  globalLocalizer: Intl.NumberFormat,
  maxItems = 5
): { details: string; moreText: string; totalChange: MilliUnits } {
  const changedResets = resets.filter((r) => r.amount !== 0);

  const details = changedResets
    .slice(0, maxItems)
    .map((r) => {
      const changeStr =
        r.amount >= 0
          ? `+${formatMilli(globalLocalizer, r.amount)}`
          : formatMilli(globalLocalizer, r.amount);
      return `${r.categoryName}: ${changeStr} -> ${formatMilli(globalLocalizer, r.newAssigned)}`;
    })
    .join('\n');

  const moreText =
    changedResets.length > maxItems ? `\n...and ${changedResets.length - maxItems} more` : '';
  const totalChange = sumMilli(changedResets.map((r) => r.amount));

  return { details, moreText, totalChange };
}

// Format change details for reset assigned toast
export function formatChangeDetails(
  changes: ChangeSummary[],
  globalLocalizer: Intl.NumberFormat,
  maxItems = 5
): { details: string; moreText: string; netChange: MilliUnits } {
  const details = changes
    .slice(0, maxItems)
    .map((c) => {
      const changeStr =
        c.delta >= 0
          ? `+${formatMilli(globalLocalizer, c.delta)}`
          : formatMilli(globalLocalizer, c.delta);
      return `${c.categoryName}: ${changeStr} -> 0`;
    })
    .join('\n');

  const moreText = changes.length > maxItems ? `\n...and ${changes.length - maxItems} more` : '';
  const netChange = sumMilli(changes.map((c) => c.delta));

  return { details, moreText, netChange };
}

// Get category counts for reset available description. Available amounts are
// exact integer milliunits, so plain sign checks replace the old cent-sized
// float thresholds.
export function getResetAvailableCounts(budgetData: GetMonthlyBudgetRow[]) {
  const nonZeroCount = budgetData.filter((r) => r.CategoryID > 0 && r.Available !== 0).length;
  const overspentCount = budgetData.filter((r) => r.CategoryID > 0 && r.Available < 0).length;
  const overfundedCount = budgetData.filter((r) => r.CategoryID > 0 && r.Available > 0).length;

  return { nonZeroCount, overspentCount, overfundedCount };
}

export function getResetAssignedCounts(budgetData: GetMonthlyBudgetRow[]) {
  const changed = budgetData.filter((r) => r.CategoryID > 0 && (r.Assigned || 0) !== 0);
  const count = changed.length;
  const totalAbs = sumMilli(changed.map((r) => asMilli(Math.abs(r.Assigned || 0))));

  return { count, totalAbs };
}
