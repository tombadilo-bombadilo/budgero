import { describe, expect, it } from 'vitest';
import { normalizeQuestion } from '@features/reports/lib/question';
import { recommendedVisualizations } from './viz-meta';

const q = (spec: Record<string, unknown>) => normalizeQuestion({ source: 'transactions', ...spec });

describe('recommendedVisualizations', () => {
  it('suits the shape of the question', () => {
    const spending = [{ op: 'spending' }];
    expect(recommendedVisualizations(q({ aggregations: spending }))).toEqual(['number', 'table']);
    expect(
      recommendedVisualizations(
        q({ aggregations: spending, breakouts: [{ field: 'date' }, { field: 'category' }] })
      )
    ).toEqual(['bar', 'area', 'line', 'pivot']);
    expect(
      recommendedVisualizations(q({ aggregations: spending, breakouts: [{ field: 'category' }] }))
    ).toEqual(['bar', 'row', 'pie', 'waterfall']);
    expect(
      recommendedVisualizations(
        q({ aggregations: spending, breakouts: [{ field: 'date', bucket: 'day' }] })
      )
    ).toEqual(['line', 'calendar', 'bar', 'area']);
    expect(
      recommendedVisualizations(
        q({ aggregations: [{ op: 'spending' }, { op: 'count' }], breakouts: [{ field: 'date' }] })
      )[0]
    ).toBe('combo');
  });
});
