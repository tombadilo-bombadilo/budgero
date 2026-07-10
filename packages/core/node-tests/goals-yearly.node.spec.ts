import { describe, it, expect } from 'vitest';
import { GoalCalculations, CategoryFinancials } from '../src/services/goals/calculations';
import { Goal, GoalType, GoalPurpose } from '../src/services/goals/types';
import { asMilli, MILLIS_PER_CENT } from '../src/money/index.js';

/** Mirrors the implementation: split paces are rounded to a whole cent. */
function centPace(rawMilli: number): number {
  return Math.round(rawMilli / MILLIS_PER_CENT) * MILLIS_PER_CENT;
}

/**
 * Characterization spec for the two yearly goal calculators
 * (calculateYearlyAllocationGoal / calculateYearlyAvailableGoal), exercised
 * through the public calculateProgress entry point.
 *
 * Every scenario asserts the FULL returned GoalProgress object, including all
 * user-facing strings. The expected values were captured from the
 * implementation before the two calculators were merged into a shared
 * skeleton, and must stay byte-identical afterwards.
 *
 * All monetary amounts are integer milliunits (1/1000 currency unit), both in
 * fixtures and in expectations. Division-derived paces are rounded to integer
 * milliunits by the implementation, so expectations mirror that rounding.
 *
 * Environment-dependent pieces (Intl currency formatting, toLocaleDateString,
 * timezone-sensitive day counts) are computed with the same primitives the
 * implementation uses, so the spec is portable across locales/timezones.
 */

/** Mirrors GoalCalculations.formatCurrency for USD (takes milliunits). */
function usd(value: number): string {
  const absValue = Math.abs(value) / 1000;
  const hasDecimals = Math.abs(absValue - Math.round(absValue)) > 0.005;
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    currencyDisplay: 'code',
    minimumFractionDigits: hasDecimals ? 2 : 0,
    maximumFractionDigits: hasDecimals ? 2 : 0,
  }).format(absValue);
}

function firstOfMonth(month: string): Date {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m - 1, 1);
}

function daysUntil(currentMonth: string, target: Date): number {
  return Math.round(
    (target.getTime() - firstOfMonth(currentMonth).getTime()) / (1000 * 60 * 60 * 24)
  );
}

// Fixed cycle used by the non-recurring scenarios: Jan 2026 → Dec 31 2026,
// evaluated in July 2026 (6 months remaining including July).
const MONTH = '2026-07';
const TARGET_DATE = new Date(2026, 11, 31);
const START_DATE = new Date(2026, 0, 15);

// Recurring scenarios: target date 2026-03-31 has passed by July 2026, so the
// cycle advances to 2027-03-31 with a 2026-05 … 2027-03 window (9 months left).
const RECURRING_TARGET = (() => {
  const d = new Date(2026, 2, 31);
  d.setFullYear(2027);
  return d;
})();

const allocationGoal = (overrides: Partial<Goal> = {}): Goal => ({
  ID: 1,
  Type: GoalType.TARGET_DATE,
  Purpose: GoalPurpose.SAVINGS,
  CategoryID: 1,
  Target: asMilli(1200000),
  StartDate: '2026-01-15',
  TargetDate: '2026-12-31',
  ...overrides,
});

const availableGoal = (overrides: Partial<Goal> = {}): Goal => ({
  ID: 2,
  Type: GoalType.YEARLY,
  Purpose: GoalPurpose.SPENDING,
  CategoryID: 1,
  Target: asMilli(2400000),
  StartDate: '2026-01-15',
  TargetDate: '2026-12-31',
  ...overrides,
});

// Six months of 100 (= 100,000 milli) assigned each, Jan–Jun 2026 (all inside the cycle).
const HISTORY_6X100 = [
  { month: '2026-01', amount: 100000 },
  { month: '2026-02', amount: 100000 },
  { month: '2026-03', amount: 100000 },
  { month: '2026-04', amount: 100000 },
  { month: '2026-05', amount: 100000 },
  { month: '2026-06', amount: 100000 },
];

const finances = (overrides: Partial<CategoryFinancials> = {}): CategoryFinancials => ({
  available: 0,
  assigned: 0,
  activity: 0,
  currencyCode: 'USD',
  ...overrides,
});

describe('Yearly allocation goal (savings, target-date)', () => {
  it('on-track: this month meets the monthly pace', () => {
    const result = GoalCalculations.calculateProgress(
      allocationGoal(),
      finances({ assigned: 110000, historicalAssignments: HISTORY_6X100 }),
      MONTH
    );
    expect(result).toEqual({
      percentage: 100,
      amountSaved: 710000,
      amountNeeded: 490000,
      monthlyTarget: 100000,
      overfundedAmount: 10000,
      isFunded: true,
      isOnTrack: true,
      status: 'on-track',
      statusMessage: `✓ ${usd(110000)} allocated this month — on track!`,
      recommendation: `On track — ${usd(490000)} still needed over 5 more months.`,
      breakdown: {
        title: 'Yearly Allocation Target',
        items: [
          { label: 'Goal Amount', value: 1200000, description: 'Total to allocate' },
          { label: 'Total Allocated', value: 710000, description: 'Sum of assignments in cycle' },
          { label: 'Still Needed', value: 490000, description: 'Remaining to allocate' },
          { label: 'Allocated This Month', value: 110000, description: 'Current progress' },
          { label: 'Monthly Pace', value: 100000, description: 'Target per remaining month' },
          { label: 'Allocate This Month', value: 0, description: 'To stay on pace' },
        ],
        explanation: [
          `Target: allocate ${usd(1200000)} by ${TARGET_DATE.toLocaleDateString()}`,
          `Allocated so far: ${usd(710000)} of ${usd(1200000)} (59%)`,
          'Tracks total assignments — spending does not affect progress',
          '6 months remaining',
        ],
      },
      timeMetrics: {
        monthsRemaining: 6,
        daysRemaining: daysUntil(MONTH, TARGET_DATE),
        startDate: START_DATE,
        targetDate: TARGET_DATE,
      },
    });
  });

  it('behind: monthly progress between 40% and 70%', () => {
    const result = GoalCalculations.calculateProgress(
      allocationGoal(),
      finances({ assigned: 50000, historicalAssignments: HISTORY_6X100 }),
      MONTH
    );
    expect(result).toEqual({
      percentage: 50,
      amountSaved: 650000,
      amountNeeded: 550000,
      monthlyTarget: 100000,
      overfundedAmount: 0,
      isFunded: false,
      isOnTrack: false,
      status: 'behind',
      statusMessage: `Allocate ${usd(50000)} more this month`,
      recommendation: `Allocate ${usd(50000)} more to complete this month's target`,
      breakdown: {
        title: 'Yearly Allocation Target',
        items: [
          { label: 'Goal Amount', value: 1200000, description: 'Total to allocate' },
          { label: 'Total Allocated', value: 650000, description: 'Sum of assignments in cycle' },
          { label: 'Still Needed', value: 550000, description: 'Remaining to allocate' },
          { label: 'Allocated This Month', value: 50000, description: 'Current progress' },
          { label: 'Monthly Pace', value: 100000, description: 'Target per remaining month' },
          { label: 'Allocate This Month', value: 50000, description: 'To stay on pace' },
        ],
        explanation: [
          `Target: allocate ${usd(1200000)} by ${TARGET_DATE.toLocaleDateString()}`,
          `Allocated so far: ${usd(650000)} of ${usd(1200000)} (54%)`,
          'Tracks total assignments — spending does not affect progress',
          '6 months remaining',
        ],
      },
      timeMetrics: {
        monthsRemaining: 6,
        daysRemaining: daysUntil(MONTH, TARGET_DATE),
        startDate: START_DATE,
        targetDate: TARGET_DATE,
      },
    });
  });

  it('at-risk: monthly progress below 40%', () => {
    const result = GoalCalculations.calculateProgress(
      allocationGoal(),
      finances({ assigned: 20000, historicalAssignments: HISTORY_6X100 }),
      MONTH
    );
    expect(result).toEqual({
      percentage: 20,
      amountSaved: 620000,
      amountNeeded: 580000,
      monthlyTarget: 100000,
      overfundedAmount: 0,
      isFunded: false,
      isOnTrack: false,
      status: 'at-risk',
      statusMessage: `Allocate ${usd(80000)} more this month`,
      recommendation: `Allocate ${usd(80000)} more to complete this month's target`,
      breakdown: {
        title: 'Yearly Allocation Target',
        items: [
          { label: 'Goal Amount', value: 1200000, description: 'Total to allocate' },
          { label: 'Total Allocated', value: 620000, description: 'Sum of assignments in cycle' },
          { label: 'Still Needed', value: 580000, description: 'Remaining to allocate' },
          { label: 'Allocated This Month', value: 20000, description: 'Current progress' },
          { label: 'Monthly Pace', value: 100000, description: 'Target per remaining month' },
          { label: 'Allocate This Month', value: 80000, description: 'To stay on pace' },
        ],
        explanation: [
          `Target: allocate ${usd(1200000)} by ${TARGET_DATE.toLocaleDateString()}`,
          `Allocated so far: ${usd(620000)} of ${usd(1200000)} (52%)`,
          'Tracks total assignments — spending does not affect progress',
          '6 months remaining',
        ],
      },
      timeMetrics: {
        monthsRemaining: 6,
        daysRemaining: daysUntil(MONTH, TARGET_DATE),
        startDate: START_DATE,
        targetDate: TARGET_DATE,
      },
    });
  });

  it('complete: cycle target fully allocated (ahead of schedule)', () => {
    const result = GoalCalculations.calculateProgress(
      allocationGoal(),
      finances({ assigned: 650000, historicalAssignments: HISTORY_6X100 }),
      MONTH
    );
    expect(result).toEqual({
      percentage: 100,
      amountSaved: 1250000,
      amountNeeded: 0,
      monthlyTarget: 100000,
      overfundedAmount: 550000,
      isFunded: true,
      isOnTrack: true,
      status: 'completed',
      statusMessage: '✓ Fully allocated!',
      recommendation: 'Target amount fully allocated for this cycle.',
      breakdown: {
        title: 'Yearly Allocation Target',
        items: [
          { label: 'Goal Amount', value: 1200000, description: 'Total to allocate' },
          { label: 'Total Allocated', value: 1250000, description: 'Sum of assignments in cycle' },
          { label: 'Still Needed', value: 0, description: 'Remaining to allocate' },
        ],
        explanation: [
          `Target: allocate ${usd(1200000)} by ${TARGET_DATE.toLocaleDateString()}`,
          `Allocated so far: ${usd(1250000)} of ${usd(1200000)} (100%)`,
          'Tracks total assignments — spending does not affect progress',
          '6 months remaining',
        ],
      },
      timeMetrics: {
        monthsRemaining: 6,
        daysRemaining: daysUntil(MONTH, TARGET_DATE),
        startDate: START_DATE,
        targetDate: TARGET_DATE,
      },
    });
  });

  it('month-boundary: final month of the cycle', () => {
    const result = GoalCalculations.calculateProgress(
      allocationGoal(),
      finances({ assigned: 30000, historicalAssignments: HISTORY_6X100 }),
      '2026-12'
    );
    expect(result).toEqual({
      percentage: 5,
      amountSaved: 630000,
      amountNeeded: 570000,
      monthlyTarget: 600000,
      overfundedAmount: 0,
      isFunded: false,
      isOnTrack: false,
      status: 'at-risk',
      statusMessage: `Final month! Allocate ${usd(570000)} to complete`,
      recommendation: `Allocate ${usd(570000)} more to complete this month's target`,
      breakdown: {
        title: 'Yearly Allocation Target',
        items: [
          { label: 'Goal Amount', value: 1200000, description: 'Total to allocate' },
          { label: 'Total Allocated', value: 630000, description: 'Sum of assignments in cycle' },
          { label: 'Still Needed', value: 570000, description: 'Remaining to allocate' },
          { label: 'Allocated This Month', value: 30000, description: 'Current progress' },
          { label: 'Allocate This Month', value: 570000, description: 'To complete the goal' },
        ],
        explanation: [
          `Target: allocate ${usd(1200000)} by ${TARGET_DATE.toLocaleDateString()}`,
          `Allocated so far: ${usd(630000)} of ${usd(1200000)} (53%)`,
          'Tracks total assignments — spending does not affect progress',
          'This is your final month!',
        ],
      },
      timeMetrics: {
        monthsRemaining: 1,
        daysRemaining: daysUntil('2026-12', TARGET_DATE),
        startDate: START_DATE,
        targetDate: TARGET_DATE,
      },
    });
  });

  it('month-boundary: target date has passed', () => {
    const result = GoalCalculations.calculateProgress(
      allocationGoal(),
      finances({ assigned: 0, historicalAssignments: HISTORY_6X100 }),
      '2027-02'
    );
    expect(result).toEqual({
      percentage: 0,
      amountSaved: 600000,
      amountNeeded: 600000,
      monthlyTarget: 600000,
      overfundedAmount: 0,
      isFunded: false,
      isOnTrack: false,
      status: 'at-risk',
      statusMessage: `⚠️ Target date passed - need ${usd(600000)} more`,
      recommendation: `Allocate ${usd(600000)} more to complete this month's target`,
      breakdown: {
        title: 'Yearly Allocation Target',
        items: [
          { label: 'Goal Amount', value: 1200000, description: 'Total to allocate' },
          { label: 'Total Allocated', value: 600000, description: 'Sum of assignments in cycle' },
          { label: 'Still Needed', value: 600000, description: 'Remaining to allocate' },
          { label: 'Allocated This Month', value: 0, description: 'Current progress' },
          { label: 'Allocate This Month', value: 600000, description: 'To complete the goal' },
        ],
        explanation: [
          `Target: allocate ${usd(1200000)} by ${TARGET_DATE.toLocaleDateString()}`,
          `Allocated so far: ${usd(600000)} of ${usd(1200000)} (50%)`,
          'Tracks total assignments — spending does not affect progress',
          'Target date has passed',
        ],
      },
      timeMetrics: {
        monthsRemaining: 0,
        daysRemaining: daysUntil('2027-02', TARGET_DATE),
        startDate: START_DATE,
        targetDate: TARGET_DATE,
      },
    });
  });

  it('recurring: cycle advances past the original target date', () => {
    const result = GoalCalculations.calculateProgress(
      allocationGoal({ StartDate: '2025-06-10', TargetDate: '2026-03-31', Recurring: true }),
      finances({
        assigned: 40000,
        historicalAssignments: [
          { month: '2026-04', amount: 500000 }, // outside the advanced cycle
          { month: '2026-05', amount: 100000 },
          { month: '2026-06', amount: 100000 },
        ],
      }),
      MONTH
    );
    const monthlyTarget = centPace(1000000 / 9);
    expect(result).toEqual({
      percentage: (40000 / monthlyTarget) * 100,
      amountSaved: 240000,
      amountNeeded: 960000,
      monthlyTarget,
      overfundedAmount: 0,
      isFunded: false,
      isOnTrack: false,
      status: 'at-risk',
      statusMessage: `Allocate ${usd(monthlyTarget - 40000)} more this month`,
      recommendation: `Allocate ${usd(monthlyTarget - 40000)} more to complete this month's target`,
      breakdown: {
        title: 'Recurring Yearly Allocation Target',
        items: [
          { label: 'Goal Amount', value: 1200000, description: 'Total to allocate' },
          { label: 'Total Allocated', value: 240000, description: 'Sum of assignments in cycle' },
          { label: 'Still Needed', value: 960000, description: 'Remaining to allocate' },
          { label: 'Allocated This Month', value: 40000, description: 'Current progress' },
          {
            label: 'Monthly Pace',
            value: monthlyTarget,
            description: 'Target per remaining month',
          },
          {
            label: 'Allocate This Month',
            value: monthlyTarget - 40000,
            description: 'To stay on pace',
          },
        ],
        explanation: [
          `Target: allocate ${usd(1200000)} by ${RECURRING_TARGET.toLocaleDateString()}`,
          `Allocated so far: ${usd(240000)} of ${usd(1200000)} (20%)`,
          'Tracks total assignments — spending does not affect progress',
          '9 months remaining',
          'Cycle: 2026-05 to 2027-03',
        ],
      },
      timeMetrics: {
        monthsRemaining: 9,
        daysRemaining: daysUntil(MONTH, RECURRING_TARGET),
        startDate: new Date(2025, 5, 10),
        targetDate: RECURRING_TARGET,
      },
    });
  });

  it('planned future assignments inside the cycle are reported', () => {
    const result = GoalCalculations.calculateProgress(
      allocationGoal(),
      finances({
        assigned: 50000,
        historicalAssignments: HISTORY_6X100,
        plannedAssignments: [
          { month: '2026-08', amount: 40000 },
          { month: '2026-11', amount: 25000 },
          { month: '2027-01', amount: 999000 }, // beyond the target date
          { month: '2026-06', amount: 50000 }, // not in the future
        ],
      }),
      MONTH
    );
    expect(result).toEqual({
      percentage: 50,
      amountSaved: 650000,
      amountNeeded: 550000,
      monthlyTarget: 100000,
      overfundedAmount: 0,
      isFunded: false,
      isOnTrack: false,
      status: 'behind',
      statusMessage: `Allocate ${usd(50000)} more this month`,
      recommendation: `Allocate ${usd(50000)} more to complete this month's target`,
      breakdown: {
        title: 'Yearly Allocation Target',
        items: [
          { label: 'Goal Amount', value: 1200000, description: 'Total to allocate' },
          { label: 'Total Allocated', value: 650000, description: 'Sum of assignments in cycle' },
          { label: 'Still Needed', value: 550000, description: 'Remaining to allocate' },
          { label: 'Allocated This Month', value: 50000, description: 'Current progress' },
          { label: 'Monthly Pace', value: 100000, description: 'Target per remaining month' },
          { label: 'Allocate This Month', value: 50000, description: 'To stay on pace' },
          { label: 'Planned Future', value: 65000, description: 'Already scheduled' },
        ],
        explanation: [
          `Target: allocate ${usd(1200000)} by ${TARGET_DATE.toLocaleDateString()}`,
          `Allocated so far: ${usd(650000)} of ${usd(1200000)} (54%)`,
          'Tracks total assignments — spending does not affect progress',
          '6 months remaining',
        ],
      },
      timeMetrics: {
        monthsRemaining: 6,
        daysRemaining: daysUntil(MONTH, TARGET_DATE),
        startDate: START_DATE,
        targetDate: TARGET_DATE,
      },
    });
  });
});

describe('Yearly available goal (spending, yearly with target date)', () => {
  it('on-track: this month meets the monthly pace', () => {
    const result = GoalCalculations.calculateProgress(
      availableGoal(),
      finances({ available: 1410000, assigned: 220000, activity: -10000 }),
      MONTH
    );
    expect(result).toEqual({
      percentage: 100,
      amountSaved: 1410000,
      amountNeeded: 990000,
      monthlyTarget: 200000,
      overfundedAmount: 20000,
      isFunded: true,
      isOnTrack: true,
      status: 'on-track',
      statusMessage: `✓ This month's ${usd(200000)} allocated!`,
      recommendation: `This month's target met! Continue with ${usd(200000)}/month to stay on track`,
      breakdown: {
        title: 'Yearly Available Target',
        items: [
          { label: 'Target Available', value: 2400000, description: 'Amount needed available' },
          { label: 'Currently Available', value: 1410000, description: 'Current balance' },
          { label: 'Still Needed', value: 990000, description: 'Gap to target' },
          { label: 'Allocated This Month', value: 220000, description: 'Current progress' },
          { label: 'Monthly Pace', value: 200000, description: 'Target per remaining month' },
          { label: 'Allocate This Month', value: 0, description: 'To stay on pace' },
        ],
        explanation: [
          `Target: ${usd(2400000)} available by ${TARGET_DATE.toLocaleDateString()}`,
          `Progress: ${usd(1410000)} of ${usd(2400000)} (59%)`,
          'Tracks the actual balance — spending reduces progress',
          '6 months remaining',
        ],
      },
      timeMetrics: {
        monthsRemaining: 6,
        daysRemaining: daysUntil(MONTH, TARGET_DATE),
        startDate: START_DATE,
        targetDate: TARGET_DATE,
      },
    });
  });

  it('behind: monthly progress between 40% and 70%', () => {
    const result = GoalCalculations.calculateProgress(
      availableGoal(),
      finances({ available: 1280000, assigned: 90000, activity: -10000 }),
      MONTH
    );
    expect(result).toEqual({
      percentage: 45,
      amountSaved: 1280000,
      amountNeeded: 1120000,
      monthlyTarget: 200000,
      overfundedAmount: 0,
      isFunded: false,
      isOnTrack: false,
      status: 'behind',
      statusMessage: `Allocate ${usd(110000)} more this month`,
      recommendation: `Allocate ${usd(110000)} more to complete this month's target`,
      breakdown: {
        title: 'Yearly Available Target',
        items: [
          { label: 'Target Available', value: 2400000, description: 'Amount needed available' },
          { label: 'Currently Available', value: 1280000, description: 'Current balance' },
          { label: 'Still Needed', value: 1120000, description: 'Gap to target' },
          { label: 'Allocated This Month', value: 90000, description: 'Current progress' },
          { label: 'Monthly Pace', value: 200000, description: 'Target per remaining month' },
          { label: 'Allocate This Month', value: 110000, description: 'To stay on pace' },
        ],
        explanation: [
          `Target: ${usd(2400000)} available by ${TARGET_DATE.toLocaleDateString()}`,
          `Progress: ${usd(1280000)} of ${usd(2400000)} (53%)`,
          'Tracks the actual balance — spending reduces progress',
          '6 months remaining',
        ],
      },
      timeMetrics: {
        monthsRemaining: 6,
        daysRemaining: daysUntil(MONTH, TARGET_DATE),
        startDate: START_DATE,
        targetDate: TARGET_DATE,
      },
    });
  });

  it('at-risk: monthly progress below 40%', () => {
    const result = GoalCalculations.calculateProgress(
      availableGoal(),
      finances({ available: 1220000, assigned: 30000, activity: -10000 }),
      MONTH
    );
    expect(result).toEqual({
      percentage: 15,
      amountSaved: 1220000,
      amountNeeded: 1180000,
      monthlyTarget: 200000,
      overfundedAmount: 0,
      isFunded: false,
      isOnTrack: false,
      status: 'at-risk',
      statusMessage: `Allocate ${usd(170000)} more this month`,
      recommendation: `Allocate ${usd(170000)} more to complete this month's target`,
      breakdown: {
        title: 'Yearly Available Target',
        items: [
          { label: 'Target Available', value: 2400000, description: 'Amount needed available' },
          { label: 'Currently Available', value: 1220000, description: 'Current balance' },
          { label: 'Still Needed', value: 1180000, description: 'Gap to target' },
          { label: 'Allocated This Month', value: 30000, description: 'Current progress' },
          { label: 'Monthly Pace', value: 200000, description: 'Target per remaining month' },
          { label: 'Allocate This Month', value: 170000, description: 'To stay on pace' },
        ],
        explanation: [
          `Target: ${usd(2400000)} available by ${TARGET_DATE.toLocaleDateString()}`,
          `Progress: ${usd(1220000)} of ${usd(2400000)} (51%)`,
          'Tracks the actual balance — spending reduces progress',
          '6 months remaining',
        ],
      },
      timeMetrics: {
        monthsRemaining: 6,
        daysRemaining: daysUntil(MONTH, TARGET_DATE),
        startDate: START_DATE,
        targetDate: TARGET_DATE,
      },
    });
  });

  it('complete: target amount fully available', () => {
    const result = GoalCalculations.calculateProgress(
      availableGoal(),
      finances({ available: 2500000, assigned: 100000, activity: 0 }),
      MONTH
    );
    expect(result).toEqual({
      percentage: 100,
      amountSaved: 2500000,
      amountNeeded: 0,
      monthlyTarget: 0,
      overfundedAmount: 100000,
      isFunded: true,
      isOnTrack: true,
      status: 'completed',
      statusMessage: '✓ Target amount available!',
      recommendation: 'Target amount is available and ready to use.',
      breakdown: {
        title: 'Yearly Available Target',
        items: [
          { label: 'Target Available', value: 2400000, description: 'Amount needed available' },
          { label: 'Currently Available', value: 2500000, description: 'Current balance' },
          { label: 'Still Needed', value: 0, description: 'Gap to target' },
        ],
        explanation: [
          `Target: ${usd(2400000)} available by ${TARGET_DATE.toLocaleDateString()}`,
          `Progress: ${usd(2500000)} of ${usd(2400000)} (100%)`,
          'Tracks the actual balance — spending reduces progress',
          '6 months remaining',
        ],
      },
      timeMetrics: {
        monthsRemaining: 6,
        daysRemaining: daysUntil(MONTH, TARGET_DATE),
        startDate: START_DATE,
        targetDate: TARGET_DATE,
      },
    });
  });

  it('month-boundary: final month of the cycle', () => {
    const result = GoalCalculations.calculateProgress(
      availableGoal(),
      finances({ available: 2000000, assigned: 40000, activity: 0 }),
      '2026-12'
    );
    expect(result).toEqual({
      percentage: (40000 / 440000) * 100,
      amountSaved: 2000000,
      amountNeeded: 400000,
      monthlyTarget: 440000,
      overfundedAmount: 0,
      isFunded: false,
      isOnTrack: true,
      status: 'at-risk',
      statusMessage: `Final month! Allocate ${usd(400000)} to complete`,
      recommendation: `Allocate ${usd(400000)} more to complete this month's target`,
      breakdown: {
        title: 'Yearly Available Target',
        items: [
          { label: 'Target Available', value: 2400000, description: 'Amount needed available' },
          { label: 'Currently Available', value: 2000000, description: 'Current balance' },
          { label: 'Still Needed', value: 400000, description: 'Gap to target' },
          { label: 'Allocated This Month', value: 40000, description: 'Current progress' },
          {
            label: 'Allocate This Month',
            value: 400000,
            description: 'To reach target available',
          },
        ],
        explanation: [
          `Target: ${usd(2400000)} available by ${TARGET_DATE.toLocaleDateString()}`,
          `Progress: ${usd(2000000)} of ${usd(2400000)} (83%)`,
          'Tracks the actual balance — spending reduces progress',
          'This is your final month!',
        ],
      },
      timeMetrics: {
        monthsRemaining: 1,
        daysRemaining: daysUntil('2026-12', TARGET_DATE),
        startDate: START_DATE,
        targetDate: TARGET_DATE,
      },
    });
  });

  it('month-boundary: target date has passed', () => {
    const result = GoalCalculations.calculateProgress(
      availableGoal(),
      finances({ available: 2000000, assigned: 0, activity: 0 }),
      '2027-02'
    );
    expect(result).toEqual({
      percentage: 0,
      amountSaved: 2000000,
      amountNeeded: 400000,
      monthlyTarget: 400000,
      overfundedAmount: 0,
      isFunded: false,
      isOnTrack: true,
      status: 'at-risk',
      statusMessage: `⚠️ Target date passed - need ${usd(400000)} more available`,
      recommendation: `Allocate ${usd(400000)} more to complete this month's target`,
      breakdown: {
        title: 'Yearly Available Target',
        items: [
          { label: 'Target Available', value: 2400000, description: 'Amount needed available' },
          { label: 'Currently Available', value: 2000000, description: 'Current balance' },
          { label: 'Still Needed', value: 400000, description: 'Gap to target' },
          { label: 'Allocated This Month', value: 0, description: 'Current progress' },
          {
            label: 'Allocate This Month',
            value: 400000,
            description: 'To reach target available',
          },
        ],
        explanation: [
          `Target: ${usd(2400000)} available by ${TARGET_DATE.toLocaleDateString()}`,
          `Progress: ${usd(2000000)} of ${usd(2400000)} (83%)`,
          'Tracks the actual balance — spending reduces progress',
          'Target date has passed',
        ],
      },
      timeMetrics: {
        monthsRemaining: 0,
        daysRemaining: daysUntil('2027-02', TARGET_DATE),
        startDate: START_DATE,
        targetDate: TARGET_DATE,
      },
    });
  });

  it('recurring: cycle advances past the original target date', () => {
    const result = GoalCalculations.calculateProgress(
      availableGoal({ StartDate: '2025-06-10', TargetDate: '2026-03-31', Recurring: true }),
      finances({ available: 300000, assigned: 40000, activity: -20000 }),
      MONTH
    );
    const monthlyTarget = centPace(2120000 / 9);
    expect(result).toEqual({
      percentage: (40000 / monthlyTarget) * 100,
      amountSaved: 300000,
      amountNeeded: 2100000,
      monthlyTarget,
      overfundedAmount: 0,
      isFunded: false,
      isOnTrack: false,
      status: 'at-risk',
      statusMessage: `Allocate ${usd(monthlyTarget - 40000)} more this month`,
      recommendation: `Allocate ${usd(monthlyTarget - 40000)} more to complete this month's target`,
      breakdown: {
        title: 'Recurring Yearly Available Target',
        items: [
          { label: 'Target Available', value: 2400000, description: 'Amount needed available' },
          { label: 'Currently Available', value: 300000, description: 'Current balance' },
          { label: 'Still Needed', value: 2100000, description: 'Gap to target' },
          { label: 'Allocated This Month', value: 40000, description: 'Current progress' },
          {
            label: 'Monthly Pace',
            value: monthlyTarget,
            description: 'Target per remaining month',
          },
          {
            label: 'Allocate This Month',
            value: monthlyTarget - 40000,
            description: 'To stay on pace',
          },
        ],
        explanation: [
          `Target: ${usd(2400000)} available by ${RECURRING_TARGET.toLocaleDateString()}`,
          `Progress: ${usd(300000)} of ${usd(2400000)} (13%)`,
          'Tracks the actual balance — spending reduces progress',
          '9 months remaining',
          'Cycle: 2026-05 to 2027-03',
        ],
      },
      timeMetrics: {
        monthsRemaining: 9,
        daysRemaining: daysUntil(MONTH, RECURRING_TARGET),
        startDate: new Date(2025, 5, 10),
        targetDate: RECURRING_TARGET,
      },
    });
  });

  it('planned future assignments inside the cycle are reported', () => {
    const result = GoalCalculations.calculateProgress(
      availableGoal(),
      finances({
        available: 1280000,
        assigned: 90000,
        activity: -10000,
        plannedAssignments: [
          { month: '2026-08', amount: 40000 },
          { month: '2026-11', amount: 25000 },
          { month: '2027-01', amount: 999000 }, // beyond the target date
          { month: '2026-06', amount: 50000 }, // not in the future
        ],
      }),
      MONTH
    );
    expect(result).toEqual({
      percentage: 45,
      amountSaved: 1280000,
      amountNeeded: 1120000,
      monthlyTarget: 200000,
      overfundedAmount: 0,
      isFunded: false,
      isOnTrack: false,
      status: 'behind',
      statusMessage: `Allocate ${usd(110000)} more this month`,
      recommendation: `Allocate ${usd(110000)} more to complete this month's target`,
      breakdown: {
        title: 'Yearly Available Target',
        items: [
          { label: 'Target Available', value: 2400000, description: 'Amount needed available' },
          { label: 'Currently Available', value: 1280000, description: 'Current balance' },
          { label: 'Still Needed', value: 1120000, description: 'Gap to target' },
          { label: 'Allocated This Month', value: 90000, description: 'Current progress' },
          { label: 'Monthly Pace', value: 200000, description: 'Target per remaining month' },
          { label: 'Allocate This Month', value: 110000, description: 'To stay on pace' },
          { label: 'Planned Future', value: 65000, description: 'Already scheduled' },
        ],
        explanation: [
          `Target: ${usd(2400000)} available by ${TARGET_DATE.toLocaleDateString()}`,
          `Progress: ${usd(1280000)} of ${usd(2400000)} (53%)`,
          'Tracks the actual balance — spending reduces progress',
          '6 months remaining',
        ],
      },
      timeMetrics: {
        monthsRemaining: 6,
        daysRemaining: daysUntil(MONTH, TARGET_DATE),
        startDate: START_DATE,
        targetDate: TARGET_DATE,
      },
    });
  });

  // Regression: a target that doesn't divide evenly into the remaining months
  // (2500 / 7 = 357.142857…) produced a sub-cent monthly pace. Funding the
  // cent-displayed amount (€357.14) left a 3-milliunit gap, so the goal stayed
  // "not funded this month" and nagged the user to allocate €0.00 more.
  it('cent-aligned pace: funding the displayed amount fully funds the month (2500/7)', () => {
    const goal = allocationGoal({
      Target: asMilli(2500000), // €2,500
      TargetDate: '2027-01-31', // evaluated in 2026-07 → 7 months remaining
    });

    // 2,500,000 / 7 = 357,142.857 → cent-rounded pace = 357,140 (€357.14).
    const pace = centPace(2500000 / 7);
    expect(pace).toBe(357140);

    // Assign exactly the displayed/cent amount for this month, nothing before.
    const result = GoalCalculations.calculateProgress(
      goal,
      finances({ assigned: 357140, historicalAssignments: [] }),
      MONTH
    );

    // Pace is a whole cent, so funding the displayed amount meets it exactly.
    expect(result.monthlyTarget).toBe(357140);
    // The month reads as funded — the on-track message, NOT a "€0.00 more" nag.
    expect(result.statusMessage).toContain('allocated this month');
    expect(result.statusMessage).not.toContain('Allocate');
  });

  it('cent-aligned pace: a real cent short still nags for that cent', () => {
    const goal = allocationGoal({ Target: asMilli(2500000), TargetDate: '2027-01-31' });
    const result = GoalCalculations.calculateProgress(
      goal,
      finances({ assigned: 357130, historicalAssignments: [] }), // €357.13, a real cent short
      MONTH
    );
    // A genuine whole-cent gap is actionable, so it correctly asks for €0.01.
    expect(result.monthlyTarget).toBe(357140);
    expect(result.statusMessage).toContain('Allocate');
  });
});
