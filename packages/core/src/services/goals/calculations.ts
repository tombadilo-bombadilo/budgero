import {
  Goal,
  GoalType,
  GoalPurpose,
  getCycleMonths,
  describeGoalCycle,
  isValidCycleMonths,
  GOAL_CYCLE_MONTHS_ERROR,
} from './types.js';
import { getLocalDateString, parseDateOnlyLocal } from '../../utils/date.js';
import { MILLIS_PER_CENT } from '../../money/index.js';

/**
 * Goal Progress Calculation Result
 * Contains all information needed to display goal progress in the UI
 */
export interface GoalProgress {
  // Core progress metrics
  percentage: number;
  amountSaved: number;
  amountNeeded: number;
  monthlyTarget: number;
  isFunded: boolean;
  isOnTrack: boolean;
  /**
   * How much the goal exceeds its target, per goal-type semantics:
   * - Monthly available: effective available beyond the target
   * - Monthly savings: this month's assignment beyond the monthly target
   * - Yearly allocation/available: this month's assignment beyond the monthly
   *   pace — the symmetric counterpart of "underfunded" for yearly goals.
   *   Once the cycle target is met the pace is 0, so the whole current-month
   *   assignment counts as reducible.
   * 0 when not overfunded. Callers decide how much of it is safe to reduce.
   */
  overfundedAmount: number;

  // Status and messaging
  status: GoalStatus;
  statusMessage: string;
  recommendation: string;

  // Raw values for frontend formatting
  // These allow the frontend to format currency values using the proper localizer
  statusValues?: Record<string, number | string>;
  recommendationValues?: Record<string, number | string>;

  // Detailed breakdown for UI display
  breakdown: GoalBreakdown;

  // Time-based metrics
  timeMetrics?: TimeMetrics;
}

export type GoalStatus =
  | 'not-started'
  | 'on-track'
  | 'ahead'
  | 'behind'
  | 'at-risk'
  | 'completed'
  | 'overfunded'
  | 'overspent';

export interface GoalBreakdown {
  title: string;
  items: {
    label: string;
    value: number;
    /** How the value should be rendered; currency when omitted. */
    unit?: 'months' | 'percent';
    description?: string;
  }[];
  explanation: string[];
  /**
   * Placeholder values for {{tokens}} in descriptions and explanations.
   * Numbers are milliunits the frontend formats with its localizer;
   * strings (counts, ISO dates) pass through.
   */
  values?: Record<string, number | string>;
}

export interface TimeMetrics {
  monthsRemaining?: number;
  daysRemaining?: number;
  startDate: Date;
  targetDate?: Date;
  projectedCompletionDate?: Date;

  // Historical performance
  monthsActive?: number;
  successfulMonths?: number; // Months where goal was met
  currentStreak?: number; // Consecutive successful months
  longestStreak?: number;
  averageMonthlyContribution?: number;
}

export interface CategoryFinancials {
  available: number;
  assigned: number; // Current month's assignment
  activity: number; // Current month's activity
  previousBalance?: number;
  currencyCode?: string;

  // Historical data for tracking trends
  historicalAssignments?: MonthlyAssignment[];
  historicalActivity?: MonthlyActivity[];

  // Future planned assignments (for target-date goals)
  plannedAssignments?: MonthlyAssignment[];
}

export interface MonthlyAssignment {
  month: string; // YYYY-MM format
  amount: number;
}

export interface MonthlyActivity {
  month: string; // YYYY-MM format
  amount: number; // Negative for spending, positive for income
}

/** Numbers handed to a yearly goal flavor's text builder. */
interface YearlyGoalTextContext {
  target: number;
  metricValue: number;
  currentMonthAssigned: number;
  monthlyTarget: number;
  amountNeeded: number;
  monthsRemaining: number;
  overallPercentage: number;
  cycleTargetDate: Date;
}

/** The user-facing strings that differ between the two yearly goal flavors. */
interface YearlyGoalTexts {
  fundedStatusMessage: string;
  monthlyFundedStatusMessage: string;
  datePassedStatusMessage: string;
  monthDoneStatusMessage: string;
  fundedRecommendation: string;
  monthlyFundedRecommendation: string;
  breakdownTitle: string;
  recurringBreakdownTitle: string;
  targetItem: { label: string; description: string };
  metricItem: { label: string; description: string };
  stillNeededDescription: string;
  targetExplanation: string;
  progressExplanation: string;
  trackingExplanation: string;
  finalMonthDescription: string;
}

/**
 * GoalCalculations - Handles all goal-related calculations
 * Centralizes business logic for goal progress, recommendations, and analysis
 */
export class GoalCalculations {
  /**
   * Calculate progress for any goal type
   * This is the main entry point for goal calculations
   *
   * Note: Status messages and recommendations include placeholder values that
   * should be formatted by the frontend using the appropriate currency formatter.
   * Example: "Need {{amount}} more" with statusValues: { amount: 150.50 }
   */
  static calculateProgress(
    goal: Goal | null,
    finances: CategoryFinancials,
    currentMonth: string
  ): GoalProgress {
    const currencyCode = finances.currencyCode ?? 'USD';

    if (!goal) {
      return this.getEmptyProgress();
    }

    if (goal.Purpose === GoalPurpose.SAVINGS) {
      return this.calculateSavingsProgress(goal, finances, currentMonth, currencyCode);
    }
    return this.calculateSpendingProgress(goal, finances, currentMonth, currencyCode);
  }

  /**
   * Calculate progress for spending goals (budget limits)
   */
  private static calculateSpendingProgress(
    goal: Goal,
    finances: CategoryFinancials,
    currentMonth: string,
    currencyCode = 'USD'
  ): GoalProgress {
    const target = Math.max(0, goal.Target || 0);
    const available = Math.max(0, finances.available);

    if (target === 0) {
      return this.getEmptyProgress('No target set');
    }

    if (goal.Type === GoalType.YEARLY && goal.TargetDate) {
      return this.calculateYearlyAvailableGoal(goal, finances, currentMonth, currencyCode);
    }

    // Monthly Available Target:
    // "Start each month with X available"
    // Progress tracks what was available BEFORE this month's spending — so once
    // you hit the target, burning through it during the month doesn't regenerate
    // a need to top back up. Leftover balance rolls into next month.
    //
    // Use raw finances.available (not the >=0 clamp) as the base: if a prior
    // month left a deficit, that deficit must still be covered before spending
    // can be added back. Only THEN clamp to 0.
    const spentThisMonth = Math.max(0, -(finances.activity || 0));
    const effectiveAvailable = Math.max(0, finances.available + spentThisMonth);
    const percentage = this.clampPercentage((effectiveAvailable / target) * 100);
    const amountNeeded = Math.max(0, target - effectiveAvailable);
    const isFunded = effectiveAvailable >= target;

    let status: GoalStatus;
    if (isFunded) {
      status = effectiveAvailable > target * 1.2 ? 'overfunded' : 'completed';
    } else if (percentage >= 80) {
      status = 'on-track';
    } else if (percentage >= 50) {
      status = 'behind';
    } else {
      status = 'at-risk';
    }

    let statusMessage: string;
    const statusValues: Record<string, number | string> = {};
    if (status === 'completed') {
      statusMessage = '✓ Target available!';
    } else if (status === 'overfunded') {
      const excess = effectiveAvailable - target;
      statusMessage = '✓ Goal exceeded by {{excess}}';
      statusValues.excess = excess;
    } else {
      statusMessage = 'Need {{needed}} more available';
      statusValues.needed = amountNeeded;
    }

    const recommendation =
      amountNeeded > 0
        ? 'Assign {{needed}} to reach your target'
        : 'Target met — category is fully funded';
    const recommendationValues: Record<string, number | string> =
      amountNeeded > 0 ? { needed: amountNeeded } : {};

    const breakdown: GoalBreakdown = {
      title: 'Monthly Available Target',
      items: [
        { label: 'Target Available', value: target, description: 'Amount to start the month with' },
        { label: 'Currently Available', value: available, description: 'Current balance' },
        {
          label: 'Assigned This Month',
          value: finances.assigned,
          description: 'Allocated this month',
        },
      ],
      explanation: [
        'Goal: start each month with this amount available',
        "Spending during the month doesn't reduce progress — only what you assign matters",
        'Leftover balance rolls into next month',
      ],
    };

    if (amountNeeded > 0) {
      breakdown.items.push({
        label: 'Still Needed',
        value: amountNeeded,
        description: 'Assign this to reach target',
      });
    }

    if (finances.activity !== 0) {
      breakdown.items.push({
        label: 'Activity',
        value: Math.abs(finances.activity),
        description: finances.activity < 0 ? 'Spending this month' : 'Income this month',
      });
    }

    return {
      percentage,
      amountSaved: effectiveAvailable,
      amountNeeded,
      monthlyTarget: target, // The full target is the "monthly target" — user wants this much available
      overfundedAmount: Math.max(0, effectiveAvailable - target),
      isFunded,
      isOnTrack: percentage >= 80,
      status,
      statusMessage,
      recommendation,
      breakdown,
      statusValues,
      recommendationValues,
    };
  }

  private static calculateSavingsProgress(
    goal: Goal,
    finances: CategoryFinancials,
    currentMonth: string,
    currencyCode = 'USD'
  ): GoalProgress {
    const target = Math.max(0, goal.Target || 0);

    if (target === 0) {
      return this.getEmptyProgress('No savings target set');
    }

    if (goal.Type === GoalType.TARGET_DATE) {
      return this.calculateYearlyAllocationGoal(goal, finances, currentMonth, currencyCode);
    }
    if (goal.Type === GoalType.MONTHLY_SAVINGS) {
      return this.calculateMonthlySavings(goal, finances, currentMonth, currencyCode);
    }
    if (goal.Type === GoalType.TARGET_BALANCE) {
      return this.calculateTargetBalance(goal, finances);
    }

    return this.getEmptyProgress('Unknown savings type');
  }

  /**
   * Target Balance: "have X available", with no date and no repeat.
   * Progress is the category's available balance, so spending creates a need
   * again; an overspent balance has to be covered before it counts.
   */
  private static calculateTargetBalance(goal: Goal, finances: CategoryFinancials): GoalProgress {
    const target = Math.max(0, goal.Target || 0);
    const { available } = finances;
    const amountNeeded = Math.max(0, target - available);
    const percentage = this.clampPercentage((Math.max(0, available) / target) * 100);
    const isFunded = available >= target;

    let status: GoalStatus;
    if (available < 0) {
      status = 'overspent';
    } else if (isFunded) {
      status = available > target ? 'overfunded' : 'completed';
    } else if (available === 0) {
      status = 'not-started';
    } else if (percentage >= 80) {
      status = 'on-track';
    } else if (percentage >= 50) {
      status = 'behind';
    } else {
      status = 'at-risk';
    }

    let statusMessage: string;
    const statusValues: Record<string, number | string> = {};
    if (status === 'overspent') {
      statusMessage = 'Overspent by {{overspent}}';
      statusValues.overspent = Math.abs(available);
    } else if (status === 'completed') {
      statusMessage = '✓ Target available!';
    } else if (status === 'overfunded') {
      statusMessage = '✓ Goal exceeded by {{excess}}';
      statusValues.excess = available - target;
    } else {
      statusMessage = 'Need {{needed}} more available';
      statusValues.needed = amountNeeded;
    }

    const breakdown: GoalBreakdown = {
      title: 'Target Balance',
      items: [
        { label: 'Target Available', value: target, description: 'Balance to reach' },
        { label: 'Currently Available', value: available, description: 'Current balance' },
        {
          label: 'Assigned This Month',
          value: finances.assigned,
          description: 'Allocated this month',
        },
      ],
      explanation: [
        'Goal: have this amount available, with no date and no repeat',
        'Spending lowers the balance, so assign again to top it back up',
      ],
    };
    if (amountNeeded > 0) {
      breakdown.items.push({
        label: 'Still Needed',
        value: amountNeeded,
        description: 'Assign this to reach target',
      });
    }

    return {
      percentage,
      amountSaved: available,
      amountNeeded,
      monthlyTarget: target,
      overfundedAmount: Math.max(0, available - target),
      isFunded,
      isOnTrack: isFunded || percentage >= 80,
      status,
      statusMessage,
      recommendation:
        amountNeeded > 0
          ? 'Assign {{needed}} to reach your target'
          : 'Target met — category is fully funded',
      recommendationValues: amountNeeded > 0 ? { needed: amountNeeded } : {},
      breakdown,
      statusValues,
    };
  }

  /**
   * Calculate monthly savings progress (save X each month)
   */
  private static calculateMonthlySavings(
    goal: Goal,
    finances: CategoryFinancials,
    currentMonth: string,
    _currencyCode = 'USD'
  ): GoalProgress {
    const monthlyTarget = goal.Target;
    const currentMonthAssigned = finances.assigned; // This month's assignment
    const totalSaved = finances.available; // Total accumulated (can be negative if overspent)

    const historicalStats = this.calculateHistoricalStats(
      finances.historicalAssignments,
      monthlyTarget,
      goal.StartDate
    );

    // For MONTHLY_SAVINGS, we track the cumulative balance
    // but evaluate progress based on meeting the monthly assignment target
    const amountSaved = totalSaved; // Use actual balance, including negative

    const percentage = this.clampPercentage((currentMonthAssigned / monthlyTarget) * 100);

    // If overspent (negative balance), need to cover deficit PLUS monthly target
    const amountNeeded =
      totalSaved < 0
        ? Math.abs(totalSaved) + monthlyTarget // Cover deficit + monthly target
        : Math.max(0, monthlyTarget - currentMonthAssigned); // Just need to meet monthly target

    const isFunded = currentMonthAssigned >= monthlyTarget && totalSaved >= 0;
    const isOnTrack = percentage >= 75 && totalSaved >= 0; // Consider on-track if 75% through and not overspent

    let status: GoalStatus;
    if (totalSaved < 0) {
      status = 'overspent';
    } else if (currentMonthAssigned > monthlyTarget) {
      status = 'overfunded';
    } else if (isFunded) {
      status = 'completed';
    } else if (percentage >= 75) {
      status = 'on-track';
    } else if (percentage >= 50) {
      status = 'behind';
    } else if (percentage > 0) {
      status = 'at-risk';
    } else {
      status = 'not-started';
    }

    let statusMessage: string;
    const statusValues: Record<string, number | string> = {};
    if (status === 'overspent') {
      statusMessage = 'Overspent by {{overspent}}';
      statusValues.overspent = Math.abs(totalSaved);
    } else if (status === 'overfunded') {
      statusMessage = 'Exceeded target! Saved {{saved}} this month';
      statusValues.saved = currentMonthAssigned;
    } else if (status === 'completed') {
      statusMessage = "✓ This month's {{monthlyTarget}} saved!";
      statusValues.monthlyTarget = monthlyTarget;
    } else if (status === 'not-started') {
      statusMessage = 'Start saving {{monthlyTarget}} this month';
      statusValues.monthlyTarget = monthlyTarget;
    } else {
      statusMessage = 'Save {{needed}} more this month';
      statusValues.needed = amountNeeded;
    }

    const { message: recommendation, values: recommendationValues } =
      this.getMonthlySavingsRecommendation(
        percentage,
        currentMonthAssigned,
        monthlyTarget,
        totalSaved
      );

    const breakdown: GoalBreakdown = {
      title: 'Monthly Savings Goal',
      items: [
        { label: 'Monthly Target', value: monthlyTarget, description: 'Save each month' },
        { label: 'Saved This Month', value: currentMonthAssigned, description: 'Current progress' },
        { label: 'Still Needed', value: amountNeeded, description: 'For this month' },
        { label: 'Total Saved', value: totalSaved, description: 'All-time total' },
      ],
      explanation: [
        'Goal: Save {{monthlyTarget}} every month',
        'Progress resets at the start of each month',
        'Build consistent savings habits',
        "You've saved {{totalSaved}} total",
      ],
      values: { monthlyTarget, totalSaved },
    };

    if (historicalStats.monthsTracked > 0) {
      breakdown.items.push({
        label: 'Success Rate',
        value: historicalStats.successRate,
        unit: 'percent',
        description: '{{successfulMonths}}/{{monthsTracked}} months',
      });
      breakdown.values = {
        ...breakdown.values,
        successfulMonths: String(historicalStats.successfulMonths),
        monthsTracked: String(historicalStats.monthsTracked),
      };

      if (historicalStats.currentStreak > 1) {
        breakdown.items.push({
          label: 'Current Streak',
          value: historicalStats.currentStreak,
          unit: 'months',
          description: 'Consecutive months',
        });
      }

      if (historicalStats.averageContribution > 0) {
        breakdown.items.push({
          label: 'Average Saved',
          value: historicalStats.averageContribution,
          description: 'Per month historically',
        });
      }

      if (historicalStats.successRate >= 80) {
        breakdown.explanation.push('🌟 Excellent consistency! Keep it up!');
      } else if (historicalStats.successRate >= 60) {
        breakdown.explanation.push('Good progress - aim for more consistency');
      } else if (historicalStats.monthsTracked > 2) {
        breakdown.explanation.push('Building habits takes time - keep trying!');
      }
    }

    return {
      percentage,
      amountSaved, // Use the actual balance (totalSaved), not just current month
      amountNeeded,
      monthlyTarget,
      // Overfunded means this month's assignment exceeds the monthly target;
      // an overspent (negative) balance is never overfunded.
      overfundedAmount: totalSaved >= 0 ? Math.max(0, currentMonthAssigned - monthlyTarget) : 0,
      isFunded,
      isOnTrack,
      status,
      statusMessage,
      statusValues,
      recommendation,
      recommendationValues,
      breakdown,
      timeMetrics: {
        startDate: parseDateOnlyLocal(goal.StartDate) ?? new Date(),
        monthsActive: historicalStats.monthsTracked,
        successfulMonths: historicalStats.successfulMonths,
        currentStreak: historicalStats.currentStreak,
        longestStreak: historicalStats.longestStreak,
        averageMonthlyContribution: historicalStats.averageContribution,
      },
    };
  }

  private static getMonthlySavingsRecommendation(
    percentage: number,
    currentSaved: number,
    target: number,
    totalSaved: number
  ): { message: string; values: Record<string, number | string> } {
    if (percentage >= 100) {
      return {
        message: 'Great job! Monthly goal achieved. Total saved: {{totalSaved}}',
        values: { totalSaved },
      };
    }

    if (percentage === 0) {
      return { message: "Start this month's savings - aim for {{target}}", values: { target } };
    }

    if (percentage >= 75) {
      return { message: 'Nearly there! Complete this month to maintain your streak', values: {} };
    }

    if (percentage >= 50) {
      const needed = target - currentSaved;
      return { message: 'Halfway there! Save {{needed}} more this month', values: { needed } };
    }

    return {
      message: 'Increase savings to reach your {{target}} monthly goal',
      values: { target },
    };
  }

  private static parseTargetDate(targetDate: string | undefined, currentMonth: string): Date {
    if (!targetDate) {
      // Default to end of current year
      const [year] = currentMonth.split('-');
      return new Date(parseInt(year), 11, 31);
    }

    // Handle MM-DD format (legacy)
    if (/^\d{2}-\d{2}$/.test(targetDate)) {
      const [month, day] = targetDate.split('-').map(Number);
      const currentYear = new Date().getFullYear();
      const date = new Date(currentYear, month - 1, day);

      // If date is in the past, assume next year
      if (date < new Date()) {
        date.setFullYear(currentYear + 1);
      }
      return date;
    }

    // ISO date: local anchor for date-only strings, instant for timestamps
    return parseDateOnlyLocal(targetDate) ?? new Date();
  }

  private static calculateMonthsRemaining(from: Date, to: Date): number {
    const months = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
    return Math.max(0, months + 1); // +1 to include current month
  }

  private static clampPercentage(value: number): number {
    if (!isFinite(value) || isNaN(value)) return 0;
    return Math.min(100, Math.max(0, value));
  }

  private static calculatePlannedContributions(
    plannedAssignments: MonthlyAssignment[] | undefined,
    currentMonth: string,
    targetDate: string | undefined
  ): number {
    if (!plannedAssignments || plannedAssignments.length === 0) {
      return 0;
    }

    const target = targetDate ? parseDateOnlyLocal(targetDate) : null;
    const targetMonthStr = target ? this.dateToMonth(target) : null;

    return plannedAssignments
      .filter((assignment) => {
        // Only count future assignments
        if (assignment.month <= currentMonth) return false;
        // If we have a target date, only count up to that date
        if (targetMonthStr && assignment.month > targetMonthStr) return false;
        return true;
      })
      .reduce((sum, assignment) => sum + assignment.amount, 0);
  }

  private static dateToMonth(date: Date): string {
    return getLocalDateString(date).slice(0, 7);
  }

  /**
   * Compute the current cycle boundaries for a target-date goal.
   *
   * Non-recurring: one cycle, [StartDate month .. TargetDate month].
   *
   * Recurring: cycles of `cycleMonths` (default 12) are tiled in BOTH
   * directions from the target date, which acts as the cadence anchor —
   * exactly like a recurring transaction's start date. The current cycle is
   * the one containing `currentMonth`: its end `E` is the smallest grid month
   * `T + k·N` (k any integer) with `E >= currentMonth`, and the window is
   * `[E − (N−1) .. E]`. StartDate is not used for recurring goals.
   *
   * The cycle target *date* keeps the target's day-of-month, clamped to the
   * length of the cycle-end month (Jan 31 → Apr 30, Feb 29 → Feb 28). All
   * arithmetic is on month indexes — never `Date.setMonth`, which overflows
   * (Mar 31 − 1 year + 1 month used to land on May 1 and shrink the window
   * to 11 months).
   *
   * Public so the goal editor can preview the exact same cycle the progress
   * calculation will use.
   */
  static computeCycle(
    goal: Goal,
    currentMonth: string
  ): { cycleStart: string; cycleEnd: string; cycleTargetDate: Date; cycleMonths: number | null } {
    const targetDate = this.parseTargetDate(goal.TargetDate, currentMonth);
    const cycleMonths = getCycleMonths(goal);

    if (cycleMonths === null) {
      const startMonth = goal.StartDate.substring(0, 7);
      const endMonth = this.dateToMonth(targetDate);
      return {
        cycleStart: startMonth,
        cycleEnd: endMonth,
        cycleTargetDate: targetDate,
        cycleMonths,
      };
    }

    // Local calendar fields of the (locally parsed) target date.
    const anchorYear = targetDate.getFullYear();
    const anchorMonth = targetDate.getMonth(); // 0-based
    const anchorDay = targetDate.getDate();
    const anchorIndex = anchorYear * 12 + anchorMonth;

    const [curYear, curMonth] = currentMonth.split('-').map(Number);
    const currentIndex = curYear * 12 + (curMonth - 1);

    // Smallest k with anchor + k·N >= current (k may be negative — the grid
    // tiles backwards too), but never a phantom cycle before the goal's start
    // month: viewing months before StartDate shows the first cycle instead.
    let k = Math.ceil((currentIndex - anchorIndex) / cycleMonths);
    const start = parseDateOnlyLocal(goal.StartDate);
    if (start) {
      const startIndex = start.getFullYear() * 12 + start.getMonth();
      if (currentIndex < startIndex) k = Math.max(k, 0);
    }
    const endIndex = anchorIndex + k * cycleMonths;
    const startIndex = endIndex - (cycleMonths - 1);

    const endYear = Math.floor(endIndex / 12);
    const endMonth0 = endIndex - endYear * 12;
    const daysInEndMonth = new Date(endYear, endMonth0 + 1, 0).getDate();
    const cycleTargetDate = new Date(endYear, endMonth0, Math.min(anchorDay, daysInEndMonth));

    return {
      cycleStart: this.monthIndexToKey(startIndex),
      cycleEnd: this.monthIndexToKey(endIndex),
      cycleTargetDate,
      cycleMonths,
    };
  }

  private static monthIndexToKey(index: number): string {
    const year = Math.floor(index / 12);
    const month = index - year * 12 + 1;
    return `${year}-${String(month).padStart(2, '0')}`;
  }

  /**
   * Compute total assignments within a goal cycle.
   * Sums historicalAssignments filtered to cycle months + current month's assigned.
   */
  private static computeAssignmentsInCycle(
    finances: CategoryFinancials,
    cycleStart: string,
    cycleEnd: string,
    currentMonth: string
  ): number {
    let total = 0;

    if (finances.historicalAssignments) {
      for (const entry of finances.historicalAssignments) {
        if (entry.month >= cycleStart && entry.month <= cycleEnd) {
          total += entry.amount;
        }
      }
    }

    // Add current month's assignment if within cycle
    if (currentMonth >= cycleStart && currentMonth <= cycleEnd) {
      total += finances.assigned || 0;
    }
    return total;
  }

  /**
   * Yearly Allocation Target calculation.
   * "Allocate X total by date" — tracks cumulative assignments in the cycle.
   * Spending is irrelevant; only how much money was PUT IN matters.
   * Supports recurring goals.
   */
  private static calculateYearlyAllocationGoal(
    goal: Goal,
    finances: CategoryFinancials,
    currentMonth: string,
    currencyCode = 'USD'
  ): GoalProgress {
    return this.buildYearlyGoalProgress({
      goal,
      finances,
      currentMonth,
      currencyCode,
      // Total assignments in cycle — the core metric for this goal type
      metric: ({ cycleStart, cycleEnd }) =>
        this.computeAssignmentsInCycle(finances, cycleStart, cycleEnd, currentMonth),
      // totalAssigned includes current month — subtract it to get the start-of-month total
      metricAtMonthStart: (totalAssigned) => totalAssigned - (finances.assigned || 0),
      texts: ({ monthsRemaining }) => ({
        fundedStatusMessage: '✓ Fully allocated!',
        monthlyFundedStatusMessage: '✓ {{assigned}} allocated this month — on track!',
        datePassedStatusMessage: '⚠️ Target date passed - need {{needed}} more',
        monthDoneStatusMessage: '✓ This month done! {{totalAssigned}} of {{target}} allocated',
        fundedRecommendation: 'Target amount fully allocated for this cycle.',
        monthlyFundedRecommendation:
          monthsRemaining === 2
            ? 'On track — {{needed}} still needed over 1 more month.'
            : 'On track — {{needed}} still needed over {{monthsMore}} more months.',
        breakdownTitle: 'Yearly Allocation Target',
        recurringBreakdownTitle: 'Recurring Yearly Allocation Target',
        targetItem: { label: 'Goal Amount', description: 'Total to allocate' },
        metricItem: { label: 'Total Allocated', description: 'Sum of assignments in cycle' },
        stillNeededDescription: 'Remaining to allocate',
        targetExplanation: 'Target: allocate {{target}} by {{targetDate}}',
        progressExplanation: 'Allocated so far: {{totalAssigned}} of {{target}} ({{pct}})',
        trackingExplanation: 'Tracks total assignments — spending does not affect progress',
        finalMonthDescription: 'To complete the goal',
      }),
    });
  }

  /**
   * Yearly Available Target calculation.
   * "Have X available by date" — tracks actual balance toward target.
   * Supports recurring goals that auto-advance their cycle each year.
   */
  private static calculateYearlyAvailableGoal(
    goal: Goal,
    finances: CategoryFinancials,
    currentMonth: string,
    currencyCode = 'USD'
  ): GoalProgress {
    const available = Math.max(0, finances.available);

    return this.buildYearlyGoalProgress({
      goal,
      finances,
      currentMonth,
      currencyCode,
      // Progress based on available balance — is the money actually there?
      metric: () => available,
      // Start-of-month balance: remove this month's assignments and activity.
      metricAtMonthStart: () =>
        Math.max(0, finances.available - (finances.assigned || 0) - (finances.activity || 0)),
      texts: () => ({
        fundedStatusMessage: '✓ Target amount available!',
        monthlyFundedStatusMessage: "✓ This month's {{monthlyTarget}} allocated!",
        datePassedStatusMessage: '⚠️ Target date passed - need {{needed}} more available',
        monthDoneStatusMessage: '✓ This month funded! {{available}}/{{target}} available',
        fundedRecommendation: 'Target amount is available and ready to use.',
        monthlyFundedRecommendation:
          "This month's target met! Continue with {{monthlyTarget}}/month to stay on track",
        breakdownTitle: 'Yearly Available Target',
        recurringBreakdownTitle: 'Recurring Yearly Available Target',
        targetItem: { label: 'Target Available', description: 'Amount needed available' },
        metricItem: { label: 'Currently Available', description: 'Current balance' },
        stillNeededDescription: 'Gap to target',
        targetExplanation: 'Target: {{target}} available by {{targetDate}}',
        progressExplanation: 'Progress: {{available}} of {{target}} ({{pct}})',
        trackingExplanation: 'Tracks the actual balance — spending reduces progress',
        finalMonthDescription: 'To reach target available',
      }),
    });
  }

  /**
   * Shared skeleton for the two yearly goal flavors (allocation / available).
   * The time math, monthly pace, status ladder, breakdown structure and return
   * shape are identical; the flavors differ only in their progress metric, how
   * that metric looked at the start of the month, and the user-facing strings.
   */
  private static buildYearlyGoalProgress(args: {
    goal: Goal;
    finances: CategoryFinancials;
    currentMonth: string;
    currencyCode: string;
    /** Core progress metric (allocation: cycle assignments; available: balance). */
    metric: (cycle: { cycleStart: string; cycleEnd: string }) => number;
    /** The metric with the current month's effect removed (start-of-month state). */
    metricAtMonthStart: (metricValue: number) => number;
    /** Flavor-specific strings, built from the computed numbers. */
    texts: (ctx: YearlyGoalTextContext) => YearlyGoalTexts;
  }): GoalProgress {
    const { goal, finances, currentMonth } = args;
    const target = goal.Target;
    const currentMonthAssigned = finances.assigned || 0;

    const { cycleStart, cycleEnd, cycleTargetDate, cycleMonths } = this.computeCycle(
      goal,
      currentMonth
    );

    const metricValue = args.metric({ cycleStart, cycleEnd });

    const [year, month] = currentMonth.split('-').map(Number);
    const today = new Date(year, month - 1, 1);
    const monthsRemaining = this.calculateMonthsRemaining(today, cycleTargetDate);
    // Both anchors are local midnight, so the quotient is a whole number of
    // days ± a DST hour; round() absorbs the DST drift where ceil() would
    // overcount by a day.
    const daysRemaining = Math.round(
      (cycleTargetDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
    );

    const plannedFutureContributions = this.calculatePlannedContributions(
      finances.plannedAssignments,
      currentMonth,
      cycleTargetDate.toISOString()
    );

    const overallPercentage = this.clampPercentage((metricValue / target) * 100);
    const amountNeeded = Math.max(0, target - metricValue);
    const isFunded = metricValue >= target;

    // Monthly target: even split of the remaining gap over the remaining
    // months, recomputed from start-of-month state. Self-correcting: the pace
    // only rises if a previous month under-assigned, and falls if a month
    // over-assigned. Planned future assignments are deliberately NOT
    // subtracted here — they reduce the gap only once they become real
    // assignments, otherwise the pace ratchets up every month as planned
    // months elapse (numerator unchanged, denominator shrinking).
    const neededAtMonthStart = Math.max(0, target - args.metricAtMonthStart(metricValue));
    // Round the pace to a whole CENT, not a milliunit. This value flows back
    // into assignments and funded checks, and the UI only displays/assigns
    // cents — so a sub-cent split remainder (e.g. 2500/7 = 357.142857…) would
    // otherwise show as €0.00 yet still fail `currentMonthAssigned >= target`,
    // nagging the user to "allocate €0.00 more". The pace self-corrects each
    // month, and cent-aligned targets land exactly on a cent-aligned goal.
    const rawPace = monthsRemaining > 0 ? neededAtMonthStart / monthsRemaining : neededAtMonthStart;
    const monthlyTarget = Math.round(rawPace / MILLIS_PER_CENT) * MILLIS_PER_CENT;
    const isMonthlyFunded = isFunded || currentMonthAssigned >= monthlyTarget;

    const monthlyProgress =
      monthlyTarget > 0
        ? this.clampPercentage((currentMonthAssigned / monthlyTarget) * 100)
        : isFunded
          ? 100
          : 0;

    const texts = args.texts({
      target,
      metricValue,
      currentMonthAssigned,
      monthlyTarget,
      amountNeeded,
      monthsRemaining,
      overallPercentage,
      cycleTargetDate,
    });

    let status: GoalStatus;
    if (isFunded) {
      status = 'completed';
    } else if (isMonthlyFunded) {
      status = 'on-track';
    } else if (monthsRemaining <= 0) {
      status = 'at-risk';
    } else if (monthlyProgress >= 70) {
      status = 'on-track';
    } else if (monthlyProgress >= 40) {
      status = 'behind';
    } else {
      status = 'at-risk';
    }

    // One shared bag: numbers are milliunits the app formats with its
    // localizer; strings (counts, dates, month keys) pass through.
    const stillNeededThisMonth = Math.max(0, monthlyTarget - currentMonthAssigned);
    const templateValues: Record<string, number | string> = {
      target,
      monthlyTarget,
      needed: amountNeeded,
      assigned: currentMonthAssigned,
      totalAssigned: metricValue,
      available: metricValue,
      stillNeeded: stillNeededThisMonth,
      monthlyNeeded: stillNeededThisMonth,
      pct: `${Math.round(overallPercentage)}%`,
      targetDate: `${cycleTargetDate.getFullYear()}-${String(cycleTargetDate.getMonth() + 1).padStart(2, '0')}-${String(cycleTargetDate.getDate()).padStart(2, '0')}`,
      monthsMore: String(Math.max(0, monthsRemaining - 1)),
      monthsRemaining: String(monthsRemaining),
      cycleStart,
      cycleEnd,
    };

    let statusMessage: string;
    if (isFunded) {
      statusMessage = texts.fundedStatusMessage;
    } else if (isMonthlyFunded) {
      statusMessage = texts.monthlyFundedStatusMessage;
    } else if (monthsRemaining <= 0) {
      statusMessage = texts.datePassedStatusMessage;
    } else if (monthsRemaining === 1) {
      statusMessage = 'Final month! Allocate {{stillNeeded}} to complete';
    } else {
      statusMessage =
        stillNeededThisMonth > 0
          ? 'Allocate {{monthlyNeeded}} more this month'
          : texts.monthDoneStatusMessage;
    }

    let recommendation: string;
    if (isFunded) {
      recommendation = texts.fundedRecommendation;
    } else if (isMonthlyFunded) {
      recommendation = texts.monthlyFundedRecommendation;
    } else {
      recommendation =
        stillNeededThisMonth > 0
          ? "Allocate {{stillNeeded}} more to complete this month's target"
          : 'Continue allocating {{monthlyTarget}} each month to reach your goal';
    }

    const isRecurring = !!goal.Recurring;
    const breakdown: GoalBreakdown = {
      title: isRecurring ? texts.recurringBreakdownTitle : texts.breakdownTitle,
      items: [
        {
          label: texts.targetItem.label,
          value: target,
          description: texts.targetItem.description,
        },
        {
          label: texts.metricItem.label,
          value: metricValue,
          description: texts.metricItem.description,
        },
        { label: 'Still Needed', value: amountNeeded, description: texts.stillNeededDescription },
      ],
      explanation: [
        texts.targetExplanation,
        texts.progressExplanation,
        texts.trackingExplanation,
        monthsRemaining > 1
          ? '{{monthsRemaining}} months remaining'
          : monthsRemaining === 1
            ? 'This is your final month!'
            : 'Target date has passed',
      ],
      values: templateValues,
    };

    if (!isFunded) {
      breakdown.items.push({
        label: 'Allocated This Month',
        value: currentMonthAssigned,
        description: 'Current progress',
      });

      const stillNeededThisMonth = Math.max(0, monthlyTarget - currentMonthAssigned);
      if (monthsRemaining > 1) {
        breakdown.items.push(
          {
            label: 'Monthly Pace',
            value: monthlyTarget,
            description: 'Target per remaining month',
          },
          {
            label: 'Allocate This Month',
            value: stillNeededThisMonth,
            description: 'To stay on pace',
          }
        );
      } else {
        // Final month or past: only one number matters — what's needed to complete
        breakdown.items.push({
          label: 'Allocate This Month',
          value: amountNeeded,
          description: texts.finalMonthDescription,
        });
      }
    }

    if (plannedFutureContributions > 0) {
      breakdown.items.push({
        label: 'Planned Future',
        value: plannedFutureContributions,
        description: 'Already scheduled',
      });
    }

    if (isRecurring) {
      breakdown.explanation.push(
        cycleMonths === 12
          ? `Cycle: ${cycleStart} to ${cycleEnd}`
          : `Cycle: ${cycleStart} to ${cycleEnd} (repeats ${describeGoalCycle(cycleMonths ?? 12)})`
      );
    }

    return {
      percentage: isFunded ? 100 : monthlyProgress,
      amountSaved: metricValue,
      amountNeeded,
      monthlyTarget,
      overfundedAmount: Math.max(0, currentMonthAssigned - monthlyTarget),
      isFunded: isFunded || isMonthlyFunded,
      isOnTrack: isFunded || isMonthlyFunded || overallPercentage >= 70,
      status,
      statusMessage,
      statusValues: templateValues,
      recommendation,
      recommendationValues: templateValues,
      breakdown,
      timeMetrics: {
        monthsRemaining,
        daysRemaining,
        startDate: parseDateOnlyLocal(goal.StartDate) ?? new Date(),
        targetDate: cycleTargetDate,
      },
    };
  }

  private static calculateHistoricalStats(
    historicalAssignments: MonthlyAssignment[] | undefined,
    monthlyTarget: number,
    startDate: string
  ): {
    monthsTracked: number;
    successfulMonths: number;
    successRate: number;
    currentStreak: number;
    longestStreak: number;
    averageContribution: number;
  } {
    if (!historicalAssignments || historicalAssignments.length === 0) {
      return {
        monthsTracked: 0,
        successfulMonths: 0,
        successRate: 0,
        currentStreak: 0,
        longestStreak: 0,
        averageContribution: 0,
      };
    }

    const relevantAssignments = historicalAssignments
      .filter((a) => a.month >= startDate)
      .sort((a, b) => a.month.localeCompare(b.month));

    if (relevantAssignments.length === 0) {
      return {
        monthsTracked: 0,
        successfulMonths: 0,
        successRate: 0,
        currentStreak: 0,
        longestStreak: 0,
        averageContribution: 0,
      };
    }

    const successfulMonths = relevantAssignments.filter((a) => a.amount >= monthlyTarget).length;
    const totalContribution = relevantAssignments.reduce((sum, a) => sum + a.amount, 0);

    let currentStreak = 0;
    let longestStreak = 0;
    let tempStreak = 0;

    for (let i = relevantAssignments.length - 1; i >= 0; i--) {
      if (relevantAssignments[i].amount >= monthlyTarget) {
        tempStreak++;
        if (i === relevantAssignments.length - 1) {
          currentStreak = tempStreak;
        }
        longestStreak = Math.max(longestStreak, tempStreak);
      } else {
        if (i === relevantAssignments.length - 1) {
          currentStreak = 0;
        }
        tempStreak = 0;
      }
    }

    return {
      monthsTracked: relevantAssignments.length,
      successfulMonths,
      successRate: (successfulMonths / relevantAssignments.length) * 100,
      currentStreak,
      longestStreak,
      // average of integer-milliunit contributions is fractional; round it
      averageContribution: Math.round(totalContribution / relevantAssignments.length),
    };
  }

  private static getEmptyProgress(message = 'No goal set'): GoalProgress {
    return {
      percentage: 0,
      amountSaved: 0,
      amountNeeded: 0,
      monthlyTarget: 0,
      overfundedAmount: 0,
      isFunded: false,
      isOnTrack: false,
      status: 'not-started',
      statusMessage: message,
      recommendation: 'Set a goal to start tracking progress',
      statusValues: {},
      recommendationValues: {},
      breakdown: {
        title: 'No Goal',
        items: [],
        explanation: ['Create a goal to track your financial progress'],
      },
    };
  }

  /**
   * Validate a goal configuration
   */
  static validateGoal(goal: Partial<Goal>): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!goal.Type) errors.push('Goal type is required');
    if (!goal.Purpose) errors.push('Goal purpose is required');
    if (!goal.Target || goal.Target <= 0) errors.push('Target must be greater than 0');
    if (!goal.CategoryID) errors.push('Category is required');

    // Validate type combinations
    // TARGET_DATE and YEARLY are valid with any purpose (unified target-date goals)
    if (goal.Purpose === GoalPurpose.SPENDING) {
      if (
        goal.Type !== GoalType.MONTHLY &&
        goal.Type !== GoalType.YEARLY &&
        goal.Type !== GoalType.TARGET_DATE
      ) {
        errors.push('Invalid type for spending goal');
      }
    } else if (goal.Purpose === GoalPurpose.SAVINGS) {
      if (
        goal.Type !== GoalType.TARGET_DATE &&
        goal.Type !== GoalType.MONTHLY_SAVINGS &&
        goal.Type !== GoalType.YEARLY &&
        goal.Type !== GoalType.TARGET_BALANCE
      ) {
        errors.push('Invalid type for savings goal');
      }
    }

    if (goal.Recurring && goal.CycleMonths != null && !isValidCycleMonths(goal.CycleMonths)) {
      errors.push(GOAL_CYCLE_MONTHS_ERROR);
    }

    if ((goal.Type === GoalType.TARGET_DATE || goal.Type === GoalType.YEARLY) && !goal.TargetDate) {
      errors.push('Target date is required for target-date goals');
    }

    if (goal.TargetDate && goal.StartDate) {
      const start = parseDateOnlyLocal(goal.StartDate);
      const target = parseDateOnlyLocal(goal.TargetDate);
      if (start && target && target <= start) {
        errors.push('Target date must be after start date');
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}
