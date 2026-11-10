import { describe, expect, it } from 'vitest';
import { axisLabelIndexes, shortMonthLabel } from './time-axis';

const months = (n: number) => Array.from({ length: n }, () => 'Jun');

describe('axisLabelIndexes', () => {
  it('shows every label when they fit', () => {
    expect([...axisLabelIndexes(["Jun '26", 'Jul', 'Aug', 'Sep', 'Oct', 'Nov'], 300)]).toEqual([
      0, 1, 2, 3, 4, 5,
    ]);
  });

  it('thins evenly when they would collide', () => {
    // 12 labels, room for 4 → every 3rd.
    expect([...axisLabelIndexes(months(12), 4 * 33)]).toEqual([0, 3, 6, 9]);
    expect(axisLabelIndexes([], 100).size).toBe(0);
  });
});

describe('shortMonthLabel', () => {
  it('shortens months and adds the year on request', () => {
    expect(shortMonthLabel('2026-06', false, 'en-US')).toBe('Jun');
    expect(shortMonthLabel('2026-11', true, 'en-US')).toBe("Nov '26");
    expect(shortMonthLabel('2026-Q1', false, 'en-US')).toBeNull();
  });
});
