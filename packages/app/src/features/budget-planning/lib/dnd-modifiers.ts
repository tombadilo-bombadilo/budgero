import type { Modifier } from '@dnd-kit/core';

// Keep drag movement vertically aligned with list rows.
export const restrictToVerticalAxis: Modifier = ({ transform }) => ({
  ...transform,
  x: 0,
});
