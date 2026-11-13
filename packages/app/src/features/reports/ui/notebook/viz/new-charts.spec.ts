import { describe, expect, it } from 'vitest';
import {
  CHART_TYPE,
  compileQuestion,
  normalizeQuestion,
  questionColumns,
  visualizationBlocker,
} from '@features/reports/lib/question';
import type { QueryResult } from '@shared/lib/sql/report-query-executor';
import { progressOf } from './progress';
import { radarPoint } from './radar-data';
import { buildTreemap } from './treemap-data';
import { OTHER_VALUE } from './transforms';

const q = (spec: Record<string, unknown>) => normalizeQuestion({ source: 'transactions', ...spec });
const result = (columns: string[], rows: unknown[][]): QueryResult => ({
  columns,
  rows,
  rowCount: rows.length,
  executionTime: 1,
});
const spending = [{ op: 'spending' }];

describe('treemap, radar and progress availability', () => {
  it('offers each where its shape fits', () => {
    const none = q({ aggregations: spending });
    const one = q({ aggregations: spending, breakouts: [{ field: 'category' }] });
    const two = q({
      aggregations: spending,
      breakouts: [{ field: 'category_group' }, { field: 'category' }],
    });
    const dated = q({ aggregations: spending, breakouts: [{ field: 'date', bucket: 'month' }] });
    const weekday = q({
      aggregations: spending,
      breakouts: [{ field: 'date', part: 'dayOfWeek' }],
    });
    expect(visualizationBlocker(none, 'progress')).toBeNull();
    expect(visualizationBlocker(one, 'progress')).toBe('needsNoGrouping');
    expect(visualizationBlocker(one, 'treemap')).toBeNull();
    expect(visualizationBlocker(two, 'treemap')).toBeNull();
    expect(visualizationBlocker(none, 'treemap')).toBe('needsOneOrTwoGroupings');
    expect(visualizationBlocker(one, 'radar')).toBeNull();
    expect(visualizationBlocker(two, 'radar')).toBeNull();
    expect(visualizationBlocker(weekday, 'radar')).toBeNull();
    expect(visualizationBlocker(dated, 'radar')).toBe('needsCategoryFirst');
  });

  it('store a chart type older apps can draw', () => {
    expect([CHART_TYPE.treemap, CHART_TYPE.radar, CHART_TYPE.progress]).toEqual([
      'pie',
      'bar',
      'stat',
    ]);
    const { chart } = compileQuestion(q({ aggregations: spending, visualization: 'progress' }), {
      budgetId: 1,
    });
    expect(chart).toMatchObject({
      chartType: 'stat',
      xAxisColumn: 'spending',
      yAxisColumn: 'spending',
    });
    // A newer type an old build doesn't know falls back to auto.
    expect(
      normalizeQuestion({ source: 'transactions', visualization: 'hexbin' }).visualization
    ).toBe('auto');
  });
});

describe('buildTreemap', () => {
  const two = q({
    aggregations: spending,
    breakouts: [{ field: 'category_group' }, { field: 'category' }],
  });
  const columns = questionColumns(two);
  const keys = columns.map((column) => column.key);

  it('nests children under parents, biggest first', () => {
    const data = buildTreemap(
      result(keys, [
        ['Bills', 'Rent', 1000],
        ['Everyday', 'Food', 300],
        ['Everyday', 'Fuel', 200],
      ]),
      columns
    )!;
    expect(data.nodes.map((node) => [node.value, node.size])).toEqual([
      ['Bills', 1000],
      ['Everyday', 500],
    ]);
    expect(data.nodes[1].children?.map((node) => node.value)).toEqual(['Food', 'Fuel']);
    expect(data.total).toBe(1500);
  });

  it('gives negatives no tile among positives, magnitudes when all negative', () => {
    const mixed = buildTreemap(
      result(keys, [
        ['Bills', 'Rent', 1000],
        ['Income', 'Salary', -3000],
      ]),
      columns
    )!;
    expect(mixed.nodes.map((node) => node.value)).toEqual(['Bills']);
    expect(mixed.negativeCount).toBe(1);
    const negative = buildTreemap(
      result(keys, [
        ['Bills', 'Rent', -1000],
        ['Fun', 'Games', -100],
      ]),
      columns
    )!;
    expect(negative.nodes.map((node) => node.size)).toEqual([1000, 100]);
  });

  it('folds past the top N into Other', () => {
    const one = q({ aggregations: spending, breakouts: [{ field: 'category' }] });
    const oneColumns = questionColumns(one);
    const data = buildTreemap(
      result(
        oneColumns.map((column) => column.key),
        [
          ['A', 5],
          ['B', 4],
          ['C', 3],
        ]
      ),
      oneColumns,
      2
    )!;
    expect(data.nodes.map((node) => [node.value, node.size])).toEqual([
      ['A', 5],
      ['B', 4],
      [OTHER_VALUE, 3],
    ]);
    expect(data.otherCount).toBe(1);
  });
});

describe('progress and radar values', () => {
  it('reads a value against a goal', () => {
    expect(progressOf(50, 200)).toEqual({ goal: 200, ratio: 0.25, over: 0, left: 150 });
    expect(progressOf(250, 200)).toMatchObject({ ratio: 1.25, over: 50, left: 0 });
    expect(progressOf(-20, 200)).toMatchObject({ ratio: 0, left: 220 });
    expect(progressOf(50, undefined)).toBeNull();
    expect(progressOf(50, 0)).toBeNull();
  });

  it('draws negative radar values at the centre', () => {
    expect(radarPoint(-5)).toBe(0);
    expect(radarPoint(7)).toBe(7);
  });
});
