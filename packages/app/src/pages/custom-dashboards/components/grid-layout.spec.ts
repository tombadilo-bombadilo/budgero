import { describe, expect, it } from 'vitest';
import {
  DASHBOARD_SPACING,
  HOME_SPACING,
  ROW_UNIT_PX,
  equalizeBuiltinRows,
  placeItems,
  questionHeightPx,
  rowUnitsFor,
} from './grid-layout';

describe('dashboard grid sizing', () => {
  it('keeps saved questions exactly as tall as the old 140 px rows', () => {
    for (const rowSpan of [3, 4, 8]) {
      const units = rowUnitsFor(questionHeightPx(rowSpan), DASHBOARD_SPACING);
      // Area minus the gap below it = the old card height.
      expect(units * ROW_UNIT_PX - DASHBOARD_SPACING.gapY).toBe(rowSpan * 140 + (rowSpan - 1) * 16);
      expect(rowUnitsFor(questionHeightPx(rowSpan), HOME_SPACING) * ROW_UNIT_PX).toBe(
        questionHeightPx(rowSpan) + HOME_SPACING.gapY
      );
    }
  });

  it('places items like CSS auto-placement, nesting short ones beside a tall one', () => {
    const tall = rowUnitsFor(questionHeightPx(6), DASHBOARD_SPACING);
    const short = rowUnitsFor(questionHeightPx(3), DASHBOARD_SPACING);
    expect(
      placeItems([
        { colSpan: 6, rowUnits: tall },
        { colSpan: 6, rowUnits: short },
        { colSpan: 6, rowUnits: short },
        { colSpan: 12, rowUnits: short },
      ])
    ).toEqual([
      { row: 0, col: 0 },
      { row: 0, col: 6 },
      { row: short, col: 6 },
      { row: tall, col: 0 },
    ]);
  });

  it('stretches built-in cards that start on the same row to the tallest of them', () => {
    expect(
      equalizeBuiltinRows([
        { colSpan: 12, rowUnits: 120, builtin: true },
        { colSpan: 8, rowUnits: 260, builtin: true },
        { colSpan: 4, rowUnits: 180, builtin: true },
        { colSpan: 6, rowUnits: 230, builtin: false },
        { colSpan: 6, rowUnits: 100, builtin: true },
      ])
    ).toEqual([120, 260, 260, 230, 100]);
  });
});
