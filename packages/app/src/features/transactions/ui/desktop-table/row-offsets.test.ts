import { describe, expect, it } from 'vitest';
import { buildRowOffsets, findRowAt } from './row-offsets';
import { mergeHeights } from './useVirtualizedTransactionRows';

describe('buildRowOffsets / findRowAt', () => {
  const heights = [64, 120, 64, 200];
  const offsets = buildRowOffsets(heights.length, (index) => heights[index]);

  it('lays rows out from their own heights', () => {
    expect(Array.from(offsets)).toEqual([0, 64, 184, 248, 448]);
  });

  it('finds the row under a position, clamped to the list', () => {
    expect(findRowAt(offsets, 0)).toBe(0);
    expect(findRowAt(offsets, 63.9)).toBe(0);
    expect(findRowAt(offsets, 64)).toBe(1);
    expect(findRowAt(offsets, 183)).toBe(1);
    expect(findRowAt(offsets, 300)).toBe(3);
    expect(findRowAt(offsets, 10_000)).toBe(3);
    expect(findRowAt(offsets, -5)).toBe(0);
    expect(
      findRowAt(
        buildRowOffsets(0, () => 64),
        100
      )
    ).toBe(0);
  });
});

describe('mergeHeights', () => {
  const start = { basis: 'true:64', heights: new Map([['1', 64]]) };

  it('keeps the same state when nothing moved by more than half a pixel', () => {
    expect(mergeHeights(start, 'true:64', [['1', 64.3]])).toBe(start);
  });

  it('records new and changed heights', () => {
    const next = mergeHeights(start, 'true:64', [
      ['1', 96],
      ['2', 64],
    ]);
    expect(next).not.toBe(start);
    expect(Object.fromEntries(next.heights)).toEqual({ '1': 96, '2': 64 });
    expect(Object.fromEntries(start.heights)).toEqual({ '1': 64 });
  });

  it('starts over for a new basis (text size or density changed)', () => {
    const next = mergeHeights(start, 'true:40', [['2', 40]]);
    expect(next.basis).toBe('true:40');
    expect(Object.fromEntries(next.heights)).toEqual({ '2': 40 });
  });
});
