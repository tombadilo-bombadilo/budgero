import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  normalizeQuestion,
  questionColumns,
  type QuestionSpec,
} from '@features/reports/lib/question';
import { CATEGORICAL_DARK, CATEGORICAL_LIGHT } from '@shared/lib/charts/palette';
import { buildChartModel, MAX_SERIES } from '../chart-model';
import {
  layoutSeries,
  markDrillValues,
  pruneHidden,
  readableTextOn,
  seriesColor,
  useHiddenSeries,
} from './series';
import { applyCategoryDisplay } from './transforms';

const result = (columns: string[], rows: unknown[][]) => ({
  columns,
  rows,
  rowCount: rows.length,
  executionTime: 1,
});
const columnsOf = (spec: Partial<QuestionSpec>) =>
  questionColumns(normalizeQuestion({ source: 'transactions', ...spec }));

describe('seriesColor', () => {
  it.each([
    ['light', CATEGORICAL_LIGHT],
    ['dark', CATEGORICAL_DARK],
  ])('gives every series of a full chart its own colour (%s)', (_, palette) => {
    const colors = Array.from({ length: MAX_SERIES + 1 }, (__, position) =>
      seriesColor(palette, position).toLowerCase()
    );
    expect(new Set(colors).size).toBe(colors.length);
    expect(colors.slice(0, palette.length)).toEqual(palette.map((color) => color.toLowerCase()));
  });
});

describe('readableTextOn', () => {
  it('picks dark text on light fills and white on dark ones', () => {
    expect(readableTextOn('#fde68a')).toBe('#18181b');
    expect(readableTextOn('#1e3a8a')).toBe('#ffffff');
  });
});

describe('legend state', () => {
  it('forgets ids that left the result and never hides everything', () => {
    expect(pruneHidden(new Set(['a', 'gone']), ['a', 'b'])).toEqual(new Set(['a']));
    expect(pruneHidden(new Set(['a', 'b']), ['a', 'b'])).toEqual(new Set());
  });

  it('keeps a series visible after the result changes', () => {
    const { result: hook, rerender } = renderHook(({ ids }) => useHiddenSeries(ids), {
      initialProps: { ids: ['a', 'b'] },
    });
    act(() => hook.current.toggle('a'));
    expect(hook.current.hidden).toEqual(new Set(['a']));
    // The new result only has "a": hiding it would leave nothing to chart.
    rerender({ ids: ['a'] });
    expect(hook.current.hidden).toEqual(new Set());
    const model = buildChartModel(
      result(['category', 'net'], [['Rent', 1]]),
      columnsOf({ aggregations: [{ op: 'net' }], breakouts: [{ field: 'category' }] })
    );
    expect(layoutSeries(model, hook.current.hidden, 'none').visible).toHaveLength(1);
  });
});

describe('markDrillValues', () => {
  const columns = columnsOf({ aggregations: [{ op: 'net' }], breakouts: [{ field: 'category' }] });
  const rows = result(
    ['category', 'net', 'category__key'],
    [
      ['Rent', -1200, 1],
      ['Food', -400, 2],
      ['Fun', -100, 3],
      ['Salary', 3000, 4],
    ]
  );

  it('drills into the clicked category after sorting and top N', () => {
    const model = applyCategoryDisplay(buildChartModel(rows, columns), { sort: 'desc', topN: 2 });
    expect(model.xValues.slice(0, 2)).toEqual(['Salary', 'Rent']);
    expect(markDrillValues(model, 0)?.[0]).toMatchObject({ value: 'Salary', key: 4 });
    expect(markDrillValues(model, 1)?.[0]).toMatchObject({ value: 'Rent', key: 1 });
  });

  it('does not drill into the folded Other bucket', () => {
    const model = applyCategoryDisplay(buildChartModel(rows, columns), { topN: 2 });
    expect(markDrillValues(model, model.xValues.length - 1)).toBeNull();
  });
});
