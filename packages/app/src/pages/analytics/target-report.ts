import {
  GoalCalculations,
  GoalType,
  type CategoryFinancials,
  type Goal,
} from '@budgero/core/browser';
import { roundMilli } from '@shared/lib/currency/round-amount';

/** One category in one month, as the Planning page saw it (milliunits). */
export interface TargetMonthRow {
  categoryId: number;
  category: string;
  group: string;
  assigned: number;
  /** Spending as a positive number. */
  spent: number;
  /** The goal's target for this month; null when the category had no goal. */
  target: number | null;
  /** Funded part of `target` (0..target). */
  funded: number;
}

export interface TargetMonthInput {
  monthKey: string;
  rows: TargetMonthRow[];
}

export interface TargetTotals {
  /** Sum of monthly targets; null when nothing in the row/group had a goal. */
  target: number | null;
  funded: number;
  assigned: number;
  spent: number;
}

export interface TargetReportRow extends TargetTotals {
  categoryId: number;
  name: string;
  /** Months in the range the goal applied to, and how many of them were fully funded. */
  monthsWithTarget: number;
  monthsMet: number;
}

export interface TargetReportGroup extends TargetTotals {
  name: string;
  rows: TargetReportRow[];
}

export interface TargetReport {
  groups: TargetReportGroup[];
  total: TargetTotals;
}

function addTarget(current: number | null, value: number | null): number | null {
  if (value === null) return current;
  return (current ?? 0) + value;
}

/**
 * The goal's target for one month and how much of it was funded, using the
 * same calculation as the Planning page's goal progress: the full target for
 * monthly goals, the monthly pace for yearly and target-date goals. Months
 * before the goal's start date have no target.
 */
export function monthTarget(
  goal: Goal | undefined,
  monthKey: string,
  finances: CategoryFinancials
): { target: number | null; funded: number } {
  if (!goal || monthKey < goal.StartDate.slice(0, 7)) return { target: null, funded: 0 };
  const progress = GoalCalculations.calculateProgress(goal, finances, monthKey);
  const target = roundMilli(progress.monthlyTarget);
  const percent = progress.isFunded ? 100 : Math.min(100, Math.max(0, progress.percentage));
  return { target, funded: roundMilli((target * percent) / 100) };
}

/** Goal types whose monthly target depends on assignments in other months. */
export function needsCycleHistory(goal: Goal | undefined): boolean {
  return goal?.Type === GoalType.YEARLY || goal?.Type === GoalType.TARGET_DATE;
}

/**
 * Sum target, funded, assigned and spent per category over the range, with
 * group subtotals, keeping the budget's group and category order.
 */
export function buildTargetReport(inputs: TargetMonthInput[]): TargetReport {
  const groups = new Map<string, TargetReportGroup>();
  const rows = new Map<number, TargetReportRow>();
  const total: TargetTotals = { target: null, funded: 0, assigned: 0, spent: 0 };

  for (const input of inputs) {
    for (const row of input.rows) {
      let group = groups.get(row.group);
      if (!group) {
        group = { name: row.group, rows: [], target: null, funded: 0, assigned: 0, spent: 0 };
        groups.set(row.group, group);
      }
      let entry = rows.get(row.categoryId);
      if (!entry) {
        entry = {
          categoryId: row.categoryId,
          name: row.category,
          target: null,
          funded: 0,
          assigned: 0,
          spent: 0,
          monthsWithTarget: 0,
          monthsMet: 0,
        };
        rows.set(row.categoryId, entry);
        group.rows.push(entry);
      }
      for (const sum of [entry, group, total]) {
        sum.target = addTarget(sum.target, row.target);
        sum.funded += row.funded;
        sum.assigned += row.assigned;
        sum.spent += row.spent;
      }
      if (row.target !== null) {
        entry.monthsWithTarget += 1;
        if (row.funded >= row.target) entry.monthsMet += 1;
      }
    }
  }

  return { groups: [...groups.values()], total };
}

/** Funded share of a target, 0–100 (0 when there is no target). */
export function fundedPercent(totals: Pick<TargetTotals, 'target' | 'funded'>): number {
  if (!totals.target) return totals.target === 0 ? 100 : 0;
  return Math.min(100, (totals.funded / totals.target) * 100);
}
