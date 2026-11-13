import { describe, expect, it } from 'vitest';
import {
  applyDrill,
  bucketRange,
  drillFilter,
  drillOptions,
  excludeFilter,
  finerBucket,
  rowDrillValues,
  type BreakoutColumn,
  type DrillValue,
} from './drill';
import { getField } from './fields';
import { normalizeQuestion, questionColumns, type QuestionSpec } from './spec';

const spec = (input: Partial<QuestionSpec>) =>
  normalizeQuestion({ source: 'transactions', ...input });

function breakoutColumn(question: QuestionSpec, key: string): BreakoutColumn {
  const column = questionColumns(question).find((item) => item.key === key);
  if (!column || column.kind !== 'breakout') throw new Error(`No breakout ${key}`);
  return column;
}

const value = (
  question: QuestionSpec,
  key: string,
  cell: unknown,
  hidden?: unknown
): DrillValue => ({
  column: breakoutColumn(question, key),
  value: cell,
  ...(hidden !== undefined ? { key: hidden } : {}),
});

describe('date buckets', () => {
  it('turns a bucket value into an inclusive date range', () => {
    expect(bucketRange('day', '2026-02-28')).toEqual(['2026-02-28', '2026-02-28']);
    expect(bucketRange('week', '2026-12-28')).toEqual(['2026-12-28', '2027-01-03']);
    expect(bucketRange('month', '2024-02')).toEqual(['2024-02-01', '2024-02-29']);
    expect(bucketRange('quarter', '2026-Q4')).toEqual(['2026-10-01', '2026-12-31']);
    expect(bucketRange('year', '2025')).toEqual(['2025-01-01', '2025-12-31']);
    expect(bucketRange('month', '2026-13')).toBeNull();
    expect(bucketRange('month', null)).toBeNull();
    expect(bucketRange('day', '2026-02-30')).toBeNull();
    expect(bucketRange('quarter', "2026-Q1'; --")).toBeNull();
  });

  it('zooms one step finer, within the buckets a field allows', () => {
    const date = getField('transactions', 'date');
    const month = getField('budget', 'month');
    expect(finerBucket(date, 'year')).toBe('quarter');
    expect(finerBucket(date, 'month')).toBe('week');
    expect(finerBucket(date, 'day')).toBeNull();
    expect(finerBucket(month, 'quarter')).toBe('month');
    expect(finerBucket(month, 'month')).toBeNull();
  });
});

describe('filters for clicked values', () => {
  const question = spec({
    aggregations: [{ op: 'spending' }],
    breakouts: [{ field: 'category' }, { field: 'date', bucket: 'month' }],
  });

  it('ids for entities, null ids as "is empty", ranges for dates', () => {
    expect(drillFilter(question, value(question, 'category', 'Misc (Home)', 410))).toEqual({
      field: 'category',
      op: 'is',
      values: [410],
    });
    expect(drillFilter(question, value(question, 'category', 'Uncategorized', null))).toEqual({
      field: 'category',
      op: 'isEmpty',
      values: [],
    });
    // SQL saved before ids existed: no safe filter by name.
    expect(drillFilter(question, value(question, 'category', 'Rent'))).toBeNull();
    expect(drillFilter(question, value(question, 'month', '2026-03'))).toEqual({
      field: 'date',
      op: 'between',
      values: ['2026-03-01', '2026-03-31'],
    });
  });

  it('exclude filters for categorical values only', () => {
    expect(excludeFilter(question, value(question, 'category', 'Rent', 21))).toEqual({
      field: 'category',
      op: 'isNot',
      values: [21],
    });
    expect(excludeFilter(question, value(question, 'category', 'Uncategorized', null))).toEqual({
      field: 'category',
      op: 'notEmpty',
      values: [],
    });
    expect(excludeFilter(question, value(question, 'month', '2026-03'))).toBeNull();
    const cleared = spec({ aggregations: [{ op: 'count' }], breakouts: [{ field: 'cleared' }] });
    expect(excludeFilter(cleared, value(cleared, 'cleared', true))).toEqual({
      field: 'cleared',
      op: 'is',
      values: [false],
    });
  });

  it('name-keyed fields use the raw value; "No payee" becomes "is empty"', () => {
    const payees = spec({ aggregations: [{ op: 'count' }], breakouts: [{ field: 'payee' }] });
    expect(drillFilter(payees, value(payees, 'payee', 'Lidl', 'Lidl'))).toEqual({
      field: 'payee',
      op: 'is',
      values: ['Lidl'],
    });
    expect(drillFilter(payees, value(payees, 'payee', 'No payee', null))).toEqual({
      field: 'payee',
      op: 'isEmpty',
      values: [],
    });
  });
});

describe('drill actions', () => {
  const monthly = spec({
    filters: [{ field: 'date', op: 'between', values: ['2026-01-01', '2026-12-31'] }],
    aggregations: [{ op: 'spending', modifier: 'running' }],
    breakouts: [{ field: 'date', bucket: 'month' }],
    sort: [{ column: 'month', direction: 'asc' }],
    limit: 12,
    visualization: 'bar',
  });
  const march = [value(monthly, 'month', '2026-03')];

  it('offers records, break-outs, zoom and categorical filters as they apply', () => {
    const options = drillOptions({ spec: monthly, values: march });
    expect(options.records).toBe(true);
    expect(options.zoom).toEqual({ key: 'month', bucket: 'week' });
    expect(options.categorical).toEqual([]);
    expect(options.breakoutFields.map((field) => field.id)).toContain('category');

    const byCategory = spec({
      aggregations: [{ op: 'count' }],
      breakouts: [{ field: 'category' }],
    });
    const clicked = drillOptions({
      spec: byCategory,
      values: [value(byCategory, 'category', 'Rent', 21)],
    });
    expect(clicked.zoom).toBeNull();
    expect(clicked.categorical).toHaveLength(1);
    expect(clicked.breakoutFields.map((field) => field.id)).not.toContain('category');
  });

  it('records: raw rows filtered to the bucket, implied spending filter, wider range replaced', () => {
    const next = applyDrill({ spec: monthly, values: march }, { kind: 'records' });
    expect(next.aggregations).toEqual([]);
    expect(next.breakouts).toEqual([]);
    expect(next.limit).toBeNull();
    expect(next.filters).toEqual([
      { field: 'date', op: 'between', values: ['2026-03-01', '2026-03-31'] },
      { field: 'is_income', op: 'is', values: [false] },
    ]);
  });

  it('zoom: finer bucket, same metric, filtered to the period', () => {
    const next = applyDrill({ spec: monthly, values: march }, { kind: 'zoom', key: 'month' });
    expect(next.breakouts).toEqual([{ field: 'date', bucket: 'week' }]);
    expect(next.aggregations).toEqual([{ op: 'spending', modifier: 'running' }]);
    expect(next.filters).toEqual([
      { field: 'date', op: 'between', values: ['2026-03-01', '2026-03-31'] },
    ]);
  });

  it('break out: filter to the value and group by the chosen field', () => {
    const next = applyDrill(
      { spec: monthly, values: march },
      { kind: 'breakout', field: 'category' }
    );
    expect(next.breakouts).toEqual([{ field: 'category' }]);
    // Running totals need a date grouping; the sort and limit belonged to the old shape.
    expect(next.aggregations).toEqual([{ op: 'spending' }]);
    expect(next.sort).toEqual([]);
    expect(next.limit).toBeNull();
    expect(next.visualization).toBe('auto');
  });

  it('filter to / exclude a category keeps the rest of the question', () => {
    const question = spec({ aggregations: [{ op: 'count' }], breakouts: [{ field: 'category' }] });
    const values = [value(question, 'category', 'Rent', 21)];
    expect(applyDrill({ spec: question, values }, { kind: 'filter', key: 'category' })).toEqual(
      spec({
        ...question,
        filters: [...question.filters, { field: 'category', op: 'is', values: [21] }],
      })
    );
    const excluded = applyDrill(
      { spec: question, values },
      { kind: 'filter', key: 'category', exclude: true }
    );
    expect(excluded.filters.at(-1)).toEqual({ field: 'category', op: 'isNot', values: [21] });
  });

  it('reads hidden keys from result rows', () => {
    const question = spec({
      aggregations: [{ op: 'spending' }],
      breakouts: [{ field: 'category' }, { field: 'date', bucket: 'month' }],
    });
    const columns = questionColumns(question);
    const values = rowDrillValues(
      columns,
      ['category', 'month', 'spending', 'category__key'],
      ['Rent', '2026-03', 60, 21]
    );
    expect(values.map((item) => [item.column.key, item.value, item.key])).toEqual([
      ['category', 'Rent', 21],
      ['month', '2026-03', undefined],
    ]);
    expect(
      rowDrillValues(columns, ['category', 'month', 'spending'], ['Rent', '2026-03', 60], 'month')
    ).toHaveLength(1);
  });
});
