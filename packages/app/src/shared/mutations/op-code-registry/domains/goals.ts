import { GoalPurpose, type Goal, type GoalService, type GoalType } from '@budgero/core/browser';
import { asMilli } from '@budgero/core/browser';
import { S, safeCapture, type OpCall, type OpCodeEntry } from '../shared';

function readCycleMonths(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const n = Number(value);
  // A garbled value in a replayed payload must not fail the whole mutation:
  // treat it as "not specified" and let the service keep/default.
  return Number.isFinite(n) ? n : undefined;
}

function findGoal(args: Record<string, unknown>): Goal | undefined {
  if (typeof args.categoryId === 'number') {
    return S().goals.getGoalsByCategoryIDs([args.categoryId])[0];
  }
  return S()
    .goals.getAllGoals()
    .find((goal) => goal.ID === args.goalId);
}

function recreateGoalOp(goal: Goal): OpCall {
  return {
    op: 'goals.create',
    args: {
      goalType: goal.Type,
      categoryId: goal.CategoryID,
      target: goal.Target,
      startDate: goal.StartDate,
      endDate: goal.TargetDate ?? '',
      purpose: goal.Purpose,
      recurring: Boolean(goal.Recurring),
      cycleMonths: goal.CycleMonths ?? null,
    },
  };
}

export const goalOps = {
  'goals.create': {
    execute: async (args) => {
      return await S().goals.createGoal(
        args.goalType as GoalType,
        args.categoryId as number,
        asMilli(Number(args.target ?? 0)),
        args.startDate as string,
        args.endDate as string,
        (args.purpose as GoalPurpose | undefined) || GoalPurpose.SPENDING,
        (args.recurring as boolean | undefined) ?? false,
        // undefined = not specified (older payloads); null = explicit default.
        // Never Number() this: Number(null) === 0 would fail validation.
        readCycleMonths(args.cycleMonths)
      );
    },
    invalidates: [
      ['categories', '*'], // Will match ["categories", budgetId]
      ['goals', '*'], // Will match ["goals", budgetId]
      ['goal', '*'], // Will match ["goal", categoryId]
      ['monthlyBudget', '*'],
    ],
    // Undo by category: a category has at most one goal, and undo/redo
    // recreate it under a new ID.
    undo: {
      build: (args) => [{ op: 'goals.delete', args: { categoryId: args.categoryId } }],
    },
  },

  // useUpdateGoal
  'goals.update': {
    execute: async (args) => {
      return await S().goals.updateGoal(
        args.categoryId as number,
        asMilli(Number(args.target ?? 0)),
        args.goalType as GoalType,
        args.endDate as string,
        (args.purpose as GoalPurpose | undefined) || GoalPurpose.SPENDING,
        args.recurring as boolean | undefined,
        readCycleMonths(args.cycleMonths),
        (args.startDate as string | null | undefined) ?? null
      );
    },
    invalidates: [
      ['categories', '*'], // Will match ["categories", budgetId]
      ['goals', '*'], // Will match ["goals", budgetId]
      ['goal', '*'], // Will match ["goal", categoryId]
      ['monthlyBudget', '*'],
    ],
    undo: {
      capture: async (args) => safeCapture(() => findGoal({ categoryId: args.categoryId })),
      build: (_args, _result, before) => {
        const goal = before as Goal | null | undefined;
        if (!goal) return [];
        const { args } = recreateGoalOp(goal);
        return [{ op: 'goals.update', args }];
      },
    },
  },

  // useDeleteGoal
  'goals.delete': {
    execute: async (args) => {
      // Undo/redo address the goal by category, since recreating it changes its ID.
      const goalId = typeof args.categoryId === 'number' ? findGoal(args)?.ID : args.goalId;
      if (typeof goalId !== 'number') return;
      return await S().goals.deleteGoal(goalId);
    },
    invalidates: [
      ['goals', '*'], // Will match ["goals", categoryId]
      ['goal', '*'], // Will match ["goal", categoryId]
      ['monthlyBudget', '*'],
    ],
    undo: {
      capture: async (args) => safeCapture(() => findGoal(args)),
      build: (_args, _result, before) => {
        const goal = before as Goal | null | undefined;
        if (!goal) return [];
        // The row as it was, under its own ID; services without restore recreate it.
        return typeof (S().goals as Partial<GoalService>).restoreGoal === 'function'
          ? [{ op: 'goals.restore', args: { goal } }]
          : [recreateGoalOp(goal)];
      },
    },
  },

  /** Undo of goals.delete. */
  'goals.restore': {
    execute: async (args) => {
      if (!args.goal || typeof args.goal !== 'object') throw new Error('"goal" is required.');
      S().goals.restoreGoal(args.goal as Parameters<GoalService['restoreGoal']>[0]);
    },
    invalidates: [
      ['categories', '*'],
      ['goals', '*'],
      ['goal', '*'],
      ['monthlyBudget', '*'],
    ],
  },
} satisfies Record<string, OpCodeEntry>;
