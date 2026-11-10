import { describe, expect, it } from 'vitest';
import { normalizeQuestion, questionColumns } from '@features/reports/lib/question';
import type { QueryResult } from '@shared/lib/sql/report-query-executor';
import { summarizeResult } from './summary';
import { withLastYear } from './last-year';

const result = (columns: string[], rows: unknown[][]) =>
  ({ columns, rows, rowCount: rows.length }) as unknown as QueryResult;

describe('summarizeResult', () => {
  it('compares the last full period with the one before, skipping the running one', () => {
    const spec = normalizeQuestion({
      source: 'transactions',
      aggregations: [{ op: 'spending' }],
      breakouts: [{ field: 'date', bucket: 'month' }],
    });
    const summary = summarizeResult(
      result(
        ['month', 'spending'],
        [
          ['2026-09', 100],
          ['2026-10', 112],
          ['2026-11', 30],
        ]
      ),
      questionColumns(spec),
      '2026-11-10'
    );
    expect(summary).toMatchObject({
      kind: 'period',
      current: { x: '2026-10', value: 112 },
      previous: { x: '2026-09', value: 100 },
      against: 'previous',
      skippedPartial: true,
    });
  });

  it('uses last year’s column when the question compares with last year', () => {
    const spec = withLastYear(
      normalizeQuestion({
        source: 'transactions',
        aggregations: [{ op: 'spending' }],
        breakouts: [{ field: 'date', bucket: 'month' }],
      }),
      true
    );
    const normalized = normalizeQuestion(spec);
    expect(normalized.aggregations[0]).toEqual({
      op: 'spending',
      compare: true,
      compareTo: 'lastYear',
    });
    const summary = summarizeResult(
      result(
        ['month', 'spending', 'spending_last_year', 'spending_yoy_change'],
        [
          ['2026-09', 100, 90, 11],
          ['2026-10', 80, 100, -20],
        ]
      ),
      questionColumns(normalized),
      '2026-11-10'
    );
    expect(summary).toMatchObject({
      kind: 'period',
      current: { x: '2026-10', value: 80 },
      previous: { value: 100 },
      against: 'lastYear',
    });
  });

  it('names the largest category and its share', () => {
    const spec = normalizeQuestion({
      source: 'transactions',
      aggregations: [{ op: 'spending' }],
      breakouts: [{ field: 'category' }],
    });
    expect(
      summarizeResult(
        result(
          ['category', 'spending'],
          [
            ['Rent', 300],
            ['Food', 100],
          ]
        ),
        questionColumns(spec),
        '2026-11-10'
      )
    ).toMatchObject({ kind: 'largest', top: { x: 'Rent', value: 300 }, share: 0.75 });
    // Mixed signs have no meaningful share.
    expect(
      summarizeResult(
        result(
          ['category', 'spending'],
          [
            ['Rent', 300],
            ['Refund', -100],
          ]
        ),
        questionColumns(spec),
        '2026-11-10'
      )
    ).toBeNull();
  });

  it('finds the largest group of the last full period', () => {
    const spec = normalizeQuestion({
      source: 'transactions',
      aggregations: [{ op: 'spending' }],
      breakouts: [{ field: 'date', bucket: 'month' }, { field: 'category' }],
    });
    const summary = summarizeResult(
      result(
        ['month', 'category', 'spending'],
        [
          ['2026-09', 'Rent', 300],
          ['2026-09', 'Food', 100],
          ['2026-10', 'Rent', 300],
          ['2026-10', 'Food', 400],
        ]
      ),
      questionColumns(spec),
      '2026-11-10'
    );
    expect(summary).toMatchObject({
      kind: 'largestInPeriod',
      period: '2026-10',
      top: { group: 'Food', value: 400 },
      before: { period: '2026-09', value: 100 },
    });
  });
});
