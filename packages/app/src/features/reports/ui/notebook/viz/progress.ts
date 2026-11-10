export interface Progress {
  goal: number;
  /** Share of the goal reached (0 for a negative value; above 1 past the goal). */
  ratio: number;
  /** How far past the goal (0 when not reached). */
  over: number;
  /** How much is left to the goal (0 when reached). */
  left: number;
}

/** A value against a goal, or null without a goal above zero. */
export function progressOf(value: number, goal: number | undefined): Progress | null {
  if (goal === undefined || !Number.isFinite(goal) || goal <= 0) return null;
  const reached = Math.max(0, value);
  return {
    goal,
    ratio: reached / goal,
    over: Math.max(0, value - goal),
    left: Math.max(0, goal - value),
  };
}
