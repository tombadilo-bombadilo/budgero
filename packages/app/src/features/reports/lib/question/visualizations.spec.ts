import { describe, expect, it } from 'vitest';
import { parseQuestionHeader, serializeQuestionHeader } from './header';
import { compileQuestion } from './compile';
import {
  allowedVisualizations,
  autoVisualization,
  normalizeDisplay,
  normalizeQuestion,
  resolveStacking,
  resolveVisualization,
  visualizationBlocker,
} from './spec';

const q = (spec: Record<string, unknown>) => normalizeQuestion({ source: 'transactions', ...spec });

const spending = [{ op: 'spending' as const }];

describe('allowedVisualizations', () => {
  it('offers trend only with a date grouping or a date range filter', () => {
    expect(allowedVisualizations(q({ aggregations: spending }))).toEqual(['number', 'table']);
    expect(
      allowedVisualizations(
        q({
          aggregations: spending,
          filters: [{ field: 'date', op: 'previous', amount: 3, unit: 'month', values: [] }],
        })
      )
    ).toEqual(['number', 'trend', 'table']);
    expect(
      allowedVisualizations(q({ aggregations: spending, breakouts: [{ field: 'date' }] }))
    ).toEqual(['trend', 'bar', 'line', 'area', 'pie', 'waterfall', 'table']);
  });

  it('category groupings get row and waterfall; two metrics add combo and scatter', () => {
    expect(
      allowedVisualizations(q({ aggregations: spending, breakouts: [{ field: 'category' }] }))
    ).toEqual(['bar', 'row', 'line', 'area', 'pie', 'waterfall', 'table']);
    expect(
      allowedVisualizations(
        q({ aggregations: [{ op: 'spending' }, { op: 'count' }], breakouts: [{ field: 'payee' }] })
      )
    ).toEqual(['bar', 'row', 'line', 'area', 'combo', 'pie', 'waterfall', 'scatter', 'table']);
  });

  it('calendar needs a day grouping; sankey two non-date groupings; pivot two groupings', () => {
    const byDay = q({ aggregations: spending, breakouts: [{ field: 'date', bucket: 'day' }] });
    expect(allowedVisualizations(byDay)).toContain('calendar');
    expect(
      allowedVisualizations(q({ aggregations: spending, breakouts: [{ field: 'date' }] }))
    ).not.toContain('calendar');
    const twoCategories = q({
      aggregations: spending,
      breakouts: [{ field: 'category_group' }, { field: 'category' }],
    });
    expect(allowedVisualizations(twoCategories)).toEqual([
      'bar',
      'row',
      'line',
      'area',
      'sankey',
      'pivot',
      'table',
    ]);
    const monthAndGroup = q({
      aggregations: spending,
      breakouts: [{ field: 'date' }, { field: 'category_group' }],
    });
    expect(allowedVisualizations(monthAndGroup)).toContain('pivot');
    expect(allowedVisualizations(monthAndGroup)).not.toContain('sankey');
    expect(visualizationBlocker(monthAndGroup, 'sankey')).toBe('needsTwoCategoryGroupings');
    expect(visualizationBlocker(byDay, 'pivot')).toBe('needsTwoGroupings');
    expect(visualizationBlocker(q({}), 'bar')).toBe('needsSummary');
    expect(visualizationBlocker(q({}), 'table')).toBeNull();
  });

  it('auto picks combo for two metrics in different units, else line / bar', () => {
    expect(
      autoVisualization(
        q({ aggregations: [{ op: 'spending' }, { op: 'count' }], breakouts: [{ field: 'date' }] })
      )
    ).toBe('combo');
    expect(
      autoVisualization(
        q({ aggregations: [{ op: 'income' }, { op: 'spending' }], breakouts: [{ field: 'date' }] })
      )
    ).toBe('line');
    expect(
      autoVisualization(q({ aggregations: spending, breakouts: [{ field: 'category' }] }))
    ).toBe('bar');
  });

  it('auto stacks bars for a date and a category grouping', () => {
    const spec = q({
      aggregations: spending,
      breakouts: [{ field: 'date', bucket: 'month' }, { field: 'category' }],
    });
    expect(autoVisualization(spec)).toBe('bar');
    expect(resolveStacking(spec, 'bar')).toBe('stacked');
    // Weekday is a category, not a time line.
    expect(
      autoVisualization(
        q({
          aggregations: spending,
          breakouts: [{ field: 'date' }, { field: 'date', part: 'dayOfWeek' }],
        })
      )
    ).toBe('bar');
    expect(
      autoVisualization(
        q({
          aggregations: spending,
          breakouts: [
            { field: 'date', bucket: 'month' },
            { field: 'date', bucket: 'year' },
          ],
        })
      )
    ).toBe('line');
  });

  it('resolveVisualization keeps a valid pick and falls back otherwise', () => {
    expect(
      resolveVisualization(
        q({
          aggregations: spending,
          breakouts: [{ field: 'category_group' }, { field: 'category' }],
          visualization: 'sankey',
        })
      )
    ).toBe('sankey');
    expect(
      resolveVisualization(
        q({ aggregations: spending, breakouts: [{ field: 'category' }], visualization: 'calendar' })
      )
    ).toBe('bar');
  });

  it('stores new types with a chart type dashboards know', () => {
    const { chart } = compileQuestion(
      q({ aggregations: spending, breakouts: [{ field: 'category' }], visualization: 'waterfall' }),
      { budgetId: 1, chartId: 'c' }
    );
    expect(chart.chartType).toBe('bar');
  });
});

describe('display settings', () => {
  it('normalizes untrusted display input and drops empty settings', () => {
    expect(normalizeDisplay(undefined)).toBeUndefined();
    expect(normalizeDisplay({ junk: 1, showValues: 'yes' })).toBeUndefined();
    expect(
      normalizeDisplay({
        showValues: true,
        goal: '1234.567',
        dualAxis: false,
        topN: 500.7,
        sort: 'desc',
      })
    ).toEqual({ showValues: true, goal: 1234.57, dualAxis: false, topN: 50, sort: 'desc' });
    expect(normalizeDisplay({ topN: 0, goal: Infinity, sort: 'sideways' })).toBeUndefined();
  });

  it('round-trips display and stacking through the saved header, omitting defaults', () => {
    const spec = q({
      aggregations: spending,
      breakouts: [{ field: 'category' }],
      visualization: 'row',
      stacking: 'percent',
      display: { goal: 500, topN: 8 },
    });
    expect(spec.display).toEqual({ goal: 500, topN: 8 });
    const header = serializeQuestionHeader(spec);
    expect(parseQuestionHeader(header)).toEqual(spec);
    const plain = serializeQuestionHeader(q({ aggregations: spending }));
    expect(plain).not.toContain('display');
    expect(plain).not.toContain('stacking');
  });
});
