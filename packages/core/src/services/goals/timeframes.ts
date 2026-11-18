/**
 * Goal timeframes: a category's goals form a chain ordered by EffectiveFrom
 * (YYYY-MM). Pure functions shared by the service (writes), the app (reads
 * and the goal form's notices) and the derived report tables.
 *
 * Resolution rule for a budget month M:
 * 1. No goals: no goal.
 * 2. The latest timeframe starting in or before M applies...
 * 3. ...or, when M is before every timeframe, the earliest one (the first
 *    goal also covers the months before it).
 * 4. It doesn't apply when its EffectiveTo is before M (the goal was ended):
 *    gaps are possible.
 */

import type { Goal } from './types.js';

/** The month a goal without an EffectiveFrom (rows from older builds) starts in. */
export const FALLBACK_EFFECTIVE_FROM = '1970-01';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

type TimeframeFields = Pick<Goal, 'StartDate'> & {
  ID?: number;
  CategoryID?: number;
  EffectiveFrom?: string | null;
  EffectiveTo?: string | null;
};

/** True for a YYYY-MM month. */
export function isGoalMonth(value: unknown): value is string {
  return typeof value === 'string' && MONTH.test(value);
}

/**
 * The month a goal row with this StartDate starts in when nothing else says
 * so: migration 081 and older builds' payloads. Its SQL twin lives in
 * migration 081; keep the two identical.
 */
export function effectiveFromForStartDate(startDate: unknown): string {
  return typeof startDate === 'string' && /^\d{4}-\d{2}/.test(startDate)
    ? startDate.slice(0, 7)
    : FALLBACK_EFFECTIVE_FROM;
}

/** First month of a goal's timeframe. */
export function goalEffectiveFrom(goal: TimeframeFields): string {
  const from = goal.EffectiveFrom;
  return typeof from === 'string' && from !== '' ? from : effectiveFromForStartDate(goal.StartDate);
}

/** Last month of a goal's timeframe when it was ended, else null (ongoing). */
export function goalEffectiveTo(goal: TimeframeFields): string | null {
  const to = goal.EffectiveTo;
  return typeof to === 'string' && to !== '' ? to : null;
}

function shiftMonth(month: string, delta: number): string {
  const year = Number(month.slice(0, 4));
  const index = year * 12 + Number(month.slice(5, 7)) - 1 + delta;
  const y = Math.floor(index / 12);
  return `${String(y).padStart(4, '0')}-${String((index % 12) + 1).padStart(2, '0')}`;
}

export function previousGoalMonth(month: string): string {
  return shiftMonth(month, -1);
}

export function nextGoalMonth(month: string): string {
  return shiftMonth(month, 1);
}

/** The chain in order: by EffectiveFrom, then ID. */
export function sortGoalTimeframes<T extends TimeframeFields>(goals: readonly T[]): T[] {
  return [...goals].sort((a, b) => {
    const from = goalEffectiveFrom(a).localeCompare(goalEffectiveFrom(b));
    return from !== 0 ? from : (a.ID ?? 0) - (b.ID ?? 0);
  });
}

/** The goal of one category's chain that applies in `month` (see the rule above). */
export function resolveGoalForMonth<T extends TimeframeFields>(
  timeframes: readonly T[],
  month: string
): T | null {
  if (timeframes.length === 0) return null;
  const chain = sortGoalTimeframes(timeframes);
  let selected = chain[0];
  for (const goal of chain) {
    if (goalEffectiveFrom(goal) <= month) selected = goal;
    else break;
  }
  const to = goalEffectiveTo(selected);
  return to !== null && to < month ? null : selected;
}

/** Each category's goal for `month`; categories without one are left out. */
export function resolveGoalsForMonth<T extends TimeframeFields & { CategoryID: number }>(
  goals: readonly T[],
  month: string
): T[] {
  const byCategory = new Map<number, T[]>();
  for (const goal of goals) {
    const chain = byCategory.get(goal.CategoryID);
    if (chain) chain.push(goal);
    else byCategory.set(goal.CategoryID, [goal]);
  }
  const resolved: T[] = [];
  for (const chain of byCategory.values()) {
    const goal = resolveGoalForMonth(chain, month);
    if (goal) resolved.push(goal);
  }
  return resolved;
}

/** Map of category ID → the goal that applies in `month`. */
export function goalsByCategoryForMonth<T extends TimeframeFields & { CategoryID: number }>(
  goals: readonly T[],
  month: string
): Map<number, T> {
  return new Map(resolveGoalsForMonth(goals, month).map((goal) => [goal.CategoryID, goal]));
}

/**
 * The months a timeframe applies to: `from` null = since the start of the
 * budget (the first timeframe), `to` null = ongoing. `endedBy` says why it
 * stops: its own end month, or the next timeframe taking over. A timeframe
 * that never applies (a later one starts in the same month) is `empty`.
 */
export interface GoalTimeframeSpan<T> {
  goal: T;
  from: string | null;
  to: string | null;
  endedBy: 'end' | 'next' | null;
  next: T | null;
  empty: boolean;
}

export function goalTimeframeSpans<T extends TimeframeFields>(
  timeframes: readonly T[]
): GoalTimeframeSpan<T>[] {
  const chain = sortGoalTimeframes(timeframes);
  return chain.map((goal, index) => {
    const start = goalEffectiveFrom(goal);
    const next = chain[index + 1] ?? null;
    const own = goalEffectiveTo(goal);
    const beforeNext = next ? previousGoalMonth(goalEffectiveFrom(next)) : null;
    let to: string | null = own;
    let endedBy: GoalTimeframeSpan<T>['endedBy'] = own ? 'end' : null;
    if (beforeNext !== null && (to === null || beforeNext < to)) {
      to = beforeNext;
      endedBy = 'next';
    }
    const from = index === 0 ? null : start;
    const empty = from !== null && to !== null && to < from;
    return { goal, from, to, endedBy, next: endedBy === 'next' ? next : null, empty };
  });
}

/** The span of `goal` within its chain, or null when it isn't part of it. */
export function goalTimeframeSpan<T extends TimeframeFields>(
  timeframes: readonly T[],
  goal: T
): GoalTimeframeSpan<T> | null {
  return goalTimeframeSpans(timeframes).find((span) => span.goal === goal) ?? null;
}

/** A change to one category's chain, addressed by explicit months only. */
export type GoalTimeframeChange =
  /** The goal from `from` (to `to`, inclusive; null = ongoing). Replaces a timeframe starting in `from`. */
  | { kind: 'set'; from: string; to: string | null }
  /** No goal from `month` onwards; months before keep theirs. */
  | { kind: 'endFrom'; month: string }
  /** No goal in any month. */
  | { kind: 'deleteAll' };

/** Row writes that carry out a change (applied in this order: delete, update, insert/overwrite). */
export interface GoalTimeframePlan {
  /** Rows removed. */
  delete: number[];
  /** Rows whose bounds move (goal fields unchanged). */
  bounds: { id: number; from?: string; to?: string | null }[];
  /** set: the row starting in `from` whose goal fields are replaced, if there is one. */
  overwrite: number | null;
  /** set: a new row (when no row starts in `from`). */
  insert: { from: string; to: string | null } | null;
}

export function validateGoalTimeframeChange(change: GoalTimeframeChange): string | null {
  if (change.kind === 'set') {
    if (!isGoalMonth(change.from)) return 'The goal start month must be YYYY-MM';
    if (change.to !== null && !isGoalMonth(change.to)) return 'The goal end month must be YYYY-MM';
    if (change.to !== null && change.to < change.from) {
      return 'The goal end month must not be before its start month';
    }
  }
  if (change.kind === 'endFrom' && !isGoalMonth(change.month)) {
    return 'The month to end the goal from must be YYYY-MM';
  }
  return null;
}

/** The row writes for `change` on `timeframes` (one category's rows, with IDs). */
export function planGoalTimeframeChange<T extends TimeframeFields & { ID: number }>(
  timeframes: readonly T[],
  change: GoalTimeframeChange
): GoalTimeframePlan {
  const chain = sortGoalTimeframes(timeframes);
  const plan: GoalTimeframePlan = { delete: [], bounds: [], overwrite: null, insert: null };
  if (change.kind === 'deleteAll') {
    plan.delete = chain.map((goal) => goal.ID);
    return plan;
  }
  if (change.kind === 'set') {
    const same = chain.find((goal) => goalEffectiveFrom(goal) === change.from);
    if (same) plan.overwrite = same.ID;
    else plan.insert = { from: change.from, to: change.to };
    return plan;
  }
  const { month } = change;
  const last = previousGoalMonth(month);
  const before = chain.filter((goal) => goalEffectiveFrom(goal) < month);
  const after = chain.filter((goal) => goalEffectiveFrom(goal) >= month);
  if (before.length > 0) {
    plan.delete = after.map((goal) => goal.ID);
    const prev = before[before.length - 1];
    const to = goalEffectiveTo(prev);
    if (to === null || to > last) plan.bounds.push({ id: prev.ID, to: last });
    return plan;
  }
  if (after.length === 0) return plan;
  // Every timeframe starts in or after `month`, yet the first one covers the
  // months before it: keep that one for exactly those months.
  const [first, ...rest] = after;
  plan.delete = rest.map((goal) => goal.ID);
  plan.bounds.push({ id: first.ID, from: last, to: last });
  return plan;
}

/** The chain after `plan` (inserted / overwritten rows carry `replacement`'s fields). */
export function applyGoalTimeframePlan<T extends TimeframeFields & { ID: number }>(
  timeframes: readonly T[],
  plan: GoalTimeframePlan,
  change: GoalTimeframeChange,
  replacement?: T
): T[] {
  const removed = new Set(plan.delete);
  const out: T[] = [];
  for (const goal of timeframes) {
    if (removed.has(goal.ID)) continue;
    const bounds = plan.bounds.find((entry) => entry.id === goal.ID);
    let next: T = goal;
    if (bounds) {
      next = {
        ...next,
        ...(bounds.from !== undefined ? { EffectiveFrom: bounds.from } : {}),
        ...(bounds.to !== undefined ? { EffectiveTo: bounds.to } : {}),
      };
    }
    if (plan.overwrite === goal.ID && change.kind === 'set') {
      next = {
        ...(replacement ?? next),
        ID: goal.ID,
        EffectiveFrom: change.from,
        EffectiveTo: change.to,
      };
    }
    out.push(next);
  }
  if (plan.insert && change.kind === 'set') {
    out.push({
      ...(replacement ?? ({} as T)),
      ID: replacement?.ID ?? 0,
      EffectiveFrom: plan.insert.from,
      EffectiveTo: plan.insert.to,
    });
  }
  return sortGoalTimeframes(out);
}

/** How a change affects the timeframes around it, for the notice shown before saving. */
export type GoalTimeframeNotice<T> =
  /** An existing timeframe now ends earlier (its later months move to the change). */
  | { kind: 'shortened'; goal: T; to: string }
  /** An existing timeframe starting in the same month is replaced. */
  | { kind: 'replaced'; goal: T }
  /** An existing timeframe that started later is removed. */
  | { kind: 'removed'; goal: T }
  /** The changed goal stops when a later existing timeframe starts. */
  | { kind: 'supersededBy'; goal: T; from: string }
  /** No goal applies from `from` (until `until`, inclusive; null = onwards). */
  | { kind: 'noGoal'; from: string; until: string | null }
  /** The edit also rewrites months before the viewed one. */
  | { kind: 'rewritesEarlier'; from: string | null; to: string };

/**
 * Notices for `change` on one category's chain. `editing` is the row the form
 * opened on (no "replaced" notice for it), `viewedMonth` the month the user
 * is looking at.
 */
export function describeGoalTimeframeChange<T extends TimeframeFields & { ID: number }>(
  timeframes: readonly T[],
  change: GoalTimeframeChange,
  options: { editing?: T | null; viewedMonth?: string } = {}
): GoalTimeframeNotice<T>[] {
  const plan = planGoalTimeframeChange(timeframes, change);
  const marker = { ID: -1 } as T;
  const after = applyGoalTimeframePlan(timeframes, plan, change, {
    ...(options.editing ?? ({} as T)),
    ...marker,
    StartDate: options.editing?.StartDate ?? '',
  } as T);
  const beforeSpans = goalTimeframeSpans(timeframes);
  const afterSpans = goalTimeframeSpans(after);
  const notices: GoalTimeframeNotice<T>[] = [];
  const afterById = new Map(afterSpans.map((span) => [span.goal.ID, span]));

  for (const span of beforeSpans) {
    const { goal } = span;
    if (plan.delete.includes(goal.ID)) {
      const current =
        change.kind === 'endFrom' && resolveGoalForMonth(timeframes, change.month) === goal;
      if (change.kind !== 'deleteAll' && !span.empty && !current) {
        notices.push({ kind: 'removed', goal });
      }
      continue;
    }
    if (plan.overwrite === goal.ID) {
      if (options.editing?.ID !== goal.ID) notices.push({ kind: 'replaced', goal });
      continue;
    }
    const now = afterById.get(goal.ID);
    if (!now || span.empty) continue;
    const shorter = now.to !== null && (span.to === null || now.to < span.to);
    if (shorter && change.kind === 'set') notices.push({ kind: 'shortened', goal, to: now.to! });
  }

  if (change.kind === 'set') {
    const changed = afterSpans.find((span) =>
      plan.overwrite !== null ? span.goal.ID === plan.overwrite : span.goal.ID === marker.ID
    );
    if (changed?.endedBy === 'next' && changed.next) {
      notices.push({
        kind: 'supersededBy',
        goal: changed.next,
        from: goalEffectiveFrom(changed.next),
      });
    }
    if (change.to !== null && changed?.endedBy === 'end') {
      const index = afterSpans.indexOf(changed);
      const following = afterSpans[index + 1];
      notices.push({
        kind: 'noGoal',
        from: nextGoalMonth(change.to),
        until: following ? previousGoalMonth(goalEffectiveFrom(following.goal)) : null,
      });
    }
    const viewed = options.viewedMonth;
    if (viewed && changed && plan.overwrite !== null && change.from < viewed) {
      notices.push({ kind: 'rewritesEarlier', from: changed.from, to: previousGoalMonth(viewed) });
    }
  }
  return notices;
}
