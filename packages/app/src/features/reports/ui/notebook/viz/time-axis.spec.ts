import { describe, expect, it } from 'vitest';
import { axisLabelIndexes, shortMonthLabel } from './time-axis';

describe('axisLabelIndexes', () => {
  it('always keeps the first and the last label', () => {
    expect([...axisLabelIndexes(12, 5)].sort((a, b) => a - b)).toEqual([0, 3, 6, 9, 11]);
    expect([...axisLabelIndexes(12, 4)].sort((a, b) => a - b)).toEqual([0, 4, 8, 11]);
    const shown = axisLabelIndexes(6, 4);
    expect(shown.has(0)).toBe(true);
    expect(shown.has(5)).toBe(true);
    expect(shown.size).toBeLessThanOrEqual(4);
    expect([...axisLabelIndexes(3, 8)]).toEqual([0, 1, 2]);
    expect(axisLabelIndexes(0, 4).size).toBe(0);
  });
});

describe('shortMonthLabel', () => {
  it('shortens months and adds the year on request', () => {
    expect(shortMonthLabel('2026-06', false, 'en-US')).toBe('Jun');
    expect(shortMonthLabel('2026-11', true, 'en-US')).toBe("Nov '26");
    expect(shortMonthLabel('2026-Q1', false, 'en-US')).toBeNull();
  });
});
