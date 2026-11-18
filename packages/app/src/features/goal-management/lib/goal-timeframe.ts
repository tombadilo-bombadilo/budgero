import {
  effectiveFromForStartDate,
  goalEffectiveFrom,
  goalEffectiveTo,
  goalTimeframeSpan,
  type Goal,
  type GoalTimeframeChange,
} from '@budgero/core/browser';

/**
 * The months a goal edit applies to. `from` null: the default for a
 * category's first goal (it covers every month, starting in its StartDate's
 * month); `to` null: ongoing.
 */
export interface GoalTimeframeChoice {
  from: string | null;
  to: string | null;
}

/** What saving the goal form does. */
export type GoalSaveAction =
  /** The category's first goal (goals.create). */
  | { kind: 'create'; effectiveFrom: string | null; effectiveTo: string | null }
  /** The timeframe starting in `effectiveFrom`, edited in place (goals.update). */
  | { kind: 'update'; effectiveFrom: string }
  /** The goal from `from` to `to` (goals.setFrom). */
  | { kind: 'setFrom'; from: string; to: string | null };

/**
 * The form's starting choice. Editing from a later month than the goal's
 * start defaults to "from this month onwards" (earlier months keep the goal
 * they had); from the start month itself, the timeframe is edited in place.
 * A first goal needs no dates; a goal added after an ended one starts in the
 * viewed month.
 */
export function defaultGoalTimeframe(
  goal: Goal | null | undefined,
  timeframes: readonly Goal[],
  viewedMonth: string
): GoalTimeframeChoice {
  if (!goal)
    return timeframes.length === 0 ? { from: null, to: null } : { from: viewedMonth, to: null };
  const start = goalEffectiveFrom(goal);
  const from = viewedMonth > start ? viewedMonth : start;
  const end = goalEffectiveTo(goal);
  return { from, to: end !== null && end >= from ? end : null };
}

/** The mutation that saves `choice` for `goal` (the goal of the viewed month, if any). */
export function goalSaveAction(
  goal: Goal | null | undefined,
  timeframes: readonly Goal[],
  choice: GoalTimeframeChoice,
  viewedMonth: string
): GoalSaveAction {
  if (!goal) {
    if (timeframes.length === 0) {
      return { kind: 'create', effectiveFrom: choice.from, effectiveTo: choice.to };
    }
    return { kind: 'setFrom', from: choice.from ?? viewedMonth, to: choice.to };
  }
  const start = goalEffectiveFrom(goal);
  const from = choice.from ?? start;
  if (from === start && choice.to === goalEffectiveTo(goal)) {
    return { kind: 'update', effectiveFrom: start };
  }
  return { kind: 'setFrom', from, to: choice.to };
}

/** The chain change behind `action`, for describeGoalTimeframeChange. */
export function timeframeChangeOf(
  action: GoalSaveAction,
  goal: Goal | null | undefined,
  startDate: string
): GoalTimeframeChange {
  switch (action.kind) {
    case 'create':
      return {
        kind: 'set',
        from: action.effectiveFrom ?? effectiveFromForStartDate(startDate),
        to: action.effectiveTo,
      };
    case 'update':
      return { kind: 'set', from: action.effectiveFrom, to: goal ? goalEffectiveTo(goal) : null };
    default:
      return { kind: 'set', from: action.from, to: action.to };
  }
}

/** The months `goal` applies to in its chain: from null = since the start, to null = ongoing. */
export function goalTimeframeRange(
  goal: Goal,
  timeframes: readonly Goal[]
): { from: string | null; to: string | null } {
  const chain = timeframes.some((entry) => entry.ID === goal.ID) ? timeframes : [goal];
  const own = chain.find((entry) => entry.ID === goal.ID) ?? goal;
  const span = goalTimeframeSpan(chain, own);
  return span ? { from: span.from, to: span.to } : { from: null, to: null };
}
