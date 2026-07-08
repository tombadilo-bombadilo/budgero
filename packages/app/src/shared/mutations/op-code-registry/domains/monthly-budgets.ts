import { asMilli } from '@budgero/core/browser';
import {
  S,
  type ExtendedMonthlyBudgetService,
  type MonthlyBudgetRow,
  type OpCodeEntry,
} from '../shared';

/**
 * Reads a category's assigned value for a month (used by undo capture to
 * restore the previous assignment). Uses the service method when available,
 * else scans the monthly budget rows.
 */
async function getMonthlyAssignmentValue(
  categoryId: number,
  month: string,
  budgetId: number
): Promise<number> {
  const svc = S().monthlyBudgets as ExtendedMonthlyBudgetService;
  if (typeof svc.getMonthlyAssignmentValue === 'function') {
    return svc.getMonthlyAssignmentValue(categoryId, month, budgetId);
  }
  const rows = (await S().monthlyBudgets!.getMonthlyBudget(month, budgetId)) as MonthlyBudgetRow[];
  const row = rows.find((r) =>
    [r.CategoryID, r.category_id, r.categoryId].some((v) => v === categoryId)
  );
  const assigned = row?.Assigned ?? row?.assigned ?? row?.assigned_amount ?? 0;
  return Number(assigned) || 0;
}

export const monthlyBudgetOps = {
  'monthlyBudgets.upsertAssignment': {
    execute: async (args) => {
      return await S().monthlyBudgets!.upsertMonthlyAssignment(
        args.categoryId as number,
        asMilli(Number(args.amount ?? 0)),
        args.month as string,
        args.budgetId as number
      );
    },
    invalidates: [
      ['monthlyBudget', '*'],
      ['readyToAssign', '*'], // Will match ["readyToAssign", budgetId]
      ['totalAssignedForBudgetPace', '*'], // Will match ["totalAssignedForBudgetPace", months, budgetId]
      ['categoryAssignmentHelpers', '*'], // last-month/average helpers depend on assignments
      ['assignmentsByMonthForCategories', '*'], // assignment history charts
    ],
    undo: {
      capture: async (args) => {
        try {
          const val = await getMonthlyAssignmentValue(
            args.categoryId as number,
            args.month as string,
            args.budgetId as number
          );
          return { prev: val };
        } catch {
          return { prev: 0 };
        }
      },
      build: (args, _result, before) => {
        const snapshot = before as { prev?: number } | null | undefined;
        return [
          {
            op: 'monthlyBudgets.upsertAssignment',
            args: {
              categoryId: args.categoryId,
              amount: snapshot?.prev ?? 0,
              month: args.month,
              budgetId: args.budgetId,
            },
          },
        ];
      },
    },
  },

  // useBatchUpsertAssignments
  'monthlyBudgets.batchUpsertAssignments': {
    execute: async (args) => {
      const svc = S().monthlyBudgets as ExtendedMonthlyBudgetService;
      if (!svc.batchUpsertMonthlyAssignments) {
        throw new Error('batchUpsertMonthlyAssignments not available');
      }
      return svc.batchUpsertMonthlyAssignments(
        args.assignments as {
          categoryId: number;
          amount: number;
          month: string;
          budgetId: number;
        }[]
      );
    },
    invalidates: [
      ['monthlyBudget', '*'],
      ['readyToAssign', '*'],
      ['totalAssignedForBudgetPace', '*'],
      ['categoryAssignmentHelpers', '*'], // last-month/average helpers depend on assignments
      ['assignmentsByMonthForCategories', '*'], // assignment history charts
    ],
    undo: {
      capture: async (args) => {
        interface AssignmentInput {
          categoryId: number;
          month: string;
          budgetId: number;
        }
        const list = (args.assignments as AssignmentInput[]) || [];
        const prev: { categoryId: number; month: string; budgetId: number; amount: number }[] = [];
        for (const a of list) {
          try {
            const amount = await getMonthlyAssignmentValue(a.categoryId, a.month, a.budgetId);
            prev.push({
              categoryId: a.categoryId,
              month: a.month,
              budgetId: a.budgetId,
              amount: Number(amount) || 0,
            });
          } catch {
            prev.push({
              categoryId: a.categoryId,
              month: a.month,
              budgetId: a.budgetId,
              amount: 0,
            });
          }
        }
        return { prev };
      },
      build: (_args, _result, before) => {
        const snapshot = before as
          | {
              prev?: {
                categoryId: number;
                month: string;
                budgetId: number;
                amount: number;
              }[];
            }
          | null
          | undefined;
        return [
          {
            op: 'monthlyBudgets.batchUpsertAssignments',
            args: { assignments: snapshot?.prev || [] },
          },
        ];
      },
    },
  },

  // useUpdateAssignment
  'monthlyBudgets.updateAssignment': {
    execute: async (args) => {
      return await S().monthlyBudgets!.upsertMonthlyAssignment(
        args.categoryId as number,
        asMilli(Number(args.amount ?? 0)),
        args.month as string,
        args.budgetId as number
      );
    },
    invalidates: [
      ['monthlyBudget', '*'],
      ['readyToAssign', '*'], // Will match ["readyToAssign", budgetId]
      ['totalAssignedForBudgetPace', '*'], // Will match ["totalAssignedForBudgetPace", months, budgetId]
    ],
    undo: {
      capture: async (args) => {
        try {
          const val = await getMonthlyAssignmentValue(
            args.categoryId as number,
            args.month as string,
            args.budgetId as number
          );
          return { prev: val };
        } catch {
          return { prev: 0 };
        }
      },
      build: (args, _result, before) => {
        const snapshot = before as { prev?: number } | null | undefined;
        return [
          {
            op: 'monthlyBudgets.updateAssignment',
            args: {
              categoryId: args.categoryId,
              amount: snapshot?.prev ?? 0,
              month: args.month,
              budgetId: args.budgetId,
            },
          },
        ];
      },
    },
  },

  // useReassignAssignments
  'monthlyBudgets.reassignAssignment': {
    execute: async (args) => {
      const svc = S().monthlyBudgets as ExtendedMonthlyBudgetService;
      if (!svc.reassignAssignment) throw new Error('reassignAssignment not available');
      return svc.reassignAssignment(args.newCategoryId as number, args.oldCategoryId as number);
    },
    invalidates: [
      ['monthlyBudget', '*'],
      ['readyToAssign', '*'],
      ['categoryAssignmentHelpers'],
      ['categoryAssignmentHelpers', '*'],
      ['assignmentsByMonthForCategories'],
      ['assignmentsByMonthForCategories', '*'],
      ['assignedLastMonth'],
      ['assignedLastMonth', '*'],
      ['totalAssignedForBudgetPace', '*'],
    ],
  },
} satisfies Record<string, OpCodeEntry>;
