/** Axes a radar reads well with; more fold into "Other". */
export const MAX_RADAR_AXES = 12;
/** Fewer values make a line or a dot, not a shape. */
export const MIN_RADAR_AXES = 3;

/** Values plotted on the radar: below zero is drawn at the centre. */
export function radarPoint(value: number): number {
  return Math.max(0, value);
}
