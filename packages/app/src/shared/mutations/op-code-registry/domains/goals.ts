import {
  GoalPurpose,
  goalEffectiveFrom,
  goalRow,
  type Goal,
  type GoalService,
  type GoalType,
} from '@budgero/core/browser';
import { asMilli } from '@budgero/core/browser';
import {
  S,
  executeJournaled,
  journaledUndo,
  safeCapture,
  type OpCall,
  type OpCodeEntry,
} from '../shared';

function readCycleMonths(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const n = Number(value);
  // A garbled value in a replayed payload must not fail the whole mutation:
  // treat it as "not specified" and let the service keep/default.
  return Number.isFinite(n) ? n : undefined;
}

/**
 * The goal target's currency arg: a code, or null for the budget currency.
 * Absent (payloads from builds before goal currencies) also means the budget
 * currency: those builds' targets are always budget-currency amounts.
 */
function readTargetCurrency(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

/** A YYYY-MM month arg, or null when absent. */
function readMonth(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function findGoal(args: Record<string, unknown>): Goal | undefined {
  if (typeof args.categoryId === 'number') {
    const chain = S().goals.getGoalTimeframes?.(args.categoryId);
    if (chain) {
      const from = readMonth(args.effectiveFrom);
      return from
        ? chain.find((goal) => goalEffectiveFrom(goal) === from)
        : chain[chain.length - 1];
    }
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
      ...(goal.EffectiveFrom ? { effectiveFrom: goal.EffectiveFrom } : {}),
      ...(goal.EffectiveTo ? { effectiveTo: goal.EffectiveTo } : {}),
      ...(goal.TargetCurrency ? { targetCurrency: goal.TargetCurrency } : {}),
    },
  };
}

const GOAL_INVALIDATIONS: string[][] = [
  ['categories', '*'], // Will match ["categories", budgetId]
  ['goals', '*'], // Will match ["goals", budgetId]
  ['goal', '*'], // Will match ["goal", categoryId]
  ['goalTimeframes', '*'],
  ['monthlyBudget', '*'],
];

/**
 * Goal ops. A category's goal is a chain of timeframes (core
 * services/goals/timeframes.ts); every op names the months it changes
 * explicitly (never "the current month" resolved when it runs), so a replay
 * or a redo on another device writes the same rows. Each op is one undo
 * entry: undo restores exactly the rows it wrote (row journal).
 *
 * goals.create / goals.update / goals.delete are the ops v1.21 builds know;
 * calls they would apply differently (a second timeframe, an end month, a
 * start month that isn't the StartDate's) ask for mutation format 7 (see
 * legacy-format.ts). goals.setFrom and goals.endFrom are format 7. A target
 * in another currency (`targetCurrency`) asks for format 8: older builds
 * would store the amount as budget currency.
 */
export const goalOps = {
  'goals.create': {
    execute: async (args, context) =>
      executeJournaled(args, context, () =>
        S().goals.createGoal(
          args.goalType as GoalType,
          args.categoryId as number,
          asMilli(Number(args.target ?? 0)),
          args.startDate as string,
          args.endDate as string,
          (args.purpose as GoalPurpose | undefined) || GoalPurpose.SPENDING,
          (args.recurring as boolean | undefined) ?? false,
          // undefined = not specified (older payloads); null = explicit default.
          // Never Number() this: Number(null) === 0 would fail validation.
          readCycleMonths(args.cycleMonths),
          { from: readMonth(args.effectiveFrom), to: readMonth(args.effectiveTo) },
          readTargetCurrency(args.targetCurrency)
        )
      ),
    invalidates: GOAL_INVALIDATIONS,
    // Without a journal (mocked services): the category had no goal before.
    undo: journaledUndo({
      build: (args) => [{ op: 'goals.delete', args: { categoryId: args.categoryId } }],
    }),
  },

  // useUpdateGoal: one timeframe (effectiveFrom) in place.
  'goals.update': {
    execute: async (args, context) =>
      executeJournaled(args, context, () =>
        S().goals.updateGoal(
          args.categoryId as number,
          asMilli(Number(args.target ?? 0)),
          args.goalType as GoalType,
          args.endDate as string,
          (args.purpose as GoalPurpose | undefined) || GoalPurpose.SPENDING,
          args.recurring as boolean | undefined,
          readCycleMonths(args.cycleMonths),
          (args.startDate as string | null | undefined) ?? null,
          readMonth(args.effectiveFrom),
          readTargetCurrency(args.targetCurrency)
        )
      ),
    invalidates: GOAL_INVALIDATIONS,
    undo: journaledUndo({
      capture: async (args) => safeCapture(() => findGoal(args)),
      build: (_args, _result, before) => {
        const goal = before as Goal | null | undefined;
        if (!goal) return [];
        const { args } = recreateGoalOp(goal);
        return [{ op: 'goals.update', args }];
      },
    }),
  },

  /**
   * The goal from `fromMonth` (to `toMonth`, inclusive; null = ongoing).
   * Replaces the timeframe starting in fromMonth, or adds one; the timeframe
   * before keeps the earlier months.
   */
  'goals.setFrom': {
    execute: async (args, context) =>
      executeJournaled(args, context, () =>
        S().goals.setGoalFrom(
          args.categoryId as number,
          args.fromMonth as string,
          readMonth(args.toMonth),
          {
            type: args.goalType as GoalType,
            purpose: (args.purpose as GoalPurpose | undefined) || GoalPurpose.SPENDING,
            target: asMilli(Number(args.target ?? 0)),
            startDate: args.startDate as string,
            targetDate: (args.endDate as string | undefined) ?? '',
            recurring: (args.recurring as boolean | undefined) ?? false,
            cycleMonths: readCycleMonths(args.cycleMonths),
            targetCurrency: readTargetCurrency(args.targetCurrency),
          }
        )
      ),
    invalidates: GOAL_INVALIDATIONS,
    undo: journaledUndo(),
  },

  /** No goal from `month` onwards; earlier months keep theirs. */
  'goals.endFrom': {
    execute: async (args, context) =>
      executeJournaled(args, context, () =>
        S().goals.endGoalFrom(args.categoryId as number, args.month as string)
      ),
    invalidates: GOAL_INVALIDATIONS,
    undo: journaledUndo(),
  },

  /** By categoryId: the goal of every month (all timeframes); by goalId: that row. */
  'goals.delete': {
    execute: async (args, context) =>
      executeJournaled(args, context, () => {
        const goals = S().goals as Partial<GoalService> & GoalService;
        if (typeof args.categoryId === 'number') {
          if (typeof goals.deleteGoalsForCategory === 'function') {
            goals.deleteGoalsForCategory(args.categoryId);
            return;
          }
          const goal = findGoal(args);
          if (goal) goals.deleteGoal(goal.ID);
          return;
        }
        if (typeof args.goalId === 'number') goals.deleteGoal(args.goalId);
      }),
    invalidates: GOAL_INVALIDATIONS,
    undo: journaledUndo({
      capture: async (args) =>
        safeCapture(() =>
          typeof args.categoryId === 'number' && S().goals.getGoalTimeframes
            ? S().goals.getGoalTimeframes(args.categoryId)
            : [findGoal(args)].filter(Boolean)
        ),
      build: (_args, _result, before) => {
        const goals = (before as Goal[] | null | undefined) ?? [];
        if (!goals.length) return [];
        // The rows as they were, under their own IDs; services without restore recreate them.
        // Stored columns only: reads add computed currency conversions.
        return goals.map((goal) =>
          typeof (S().goals as Partial<GoalService>).restoreGoal === 'function'
            ? { op: 'goals.restore', args: { goal: goalRow(goal) } }
            : recreateGoalOp(goal)
        );
      },
    }),
  },

  /** Undo of goals.delete. */
  'goals.restore': {
    execute: async (args) => {
      if (!args.goal || typeof args.goal !== 'object') throw new Error('"goal" is required.');
      S().goals.restoreGoal(args.goal as Parameters<GoalService['restoreGoal']>[0]);
    },
    invalidates: GOAL_INVALIDATIONS,
  },
} satisfies Record<string, OpCodeEntry>;
