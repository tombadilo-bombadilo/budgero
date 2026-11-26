/** Pointer movement (px) ignored before a width change is applied. */
const DRAG_THRESHOLD = 2;

/**
 * Turns pointer x positions into width deltas: a move past the threshold
 * yields the distance since the last applied move, smaller moves yield null.
 */
export function createResizeTracker(startX: number, threshold = DRAG_THRESHOLD) {
  let lastX = startX;
  return {
    move(x: number): number | null {
      const delta = x - lastX;
      if (Math.abs(delta) <= threshold) return null;
      lastX = x;
      return delta;
    },
  };
}
