/**
 * Spec-level behaviour of the review fixes and the power features (having,
 * numeric bins, date parts, last-year compare, raw sorts on hidden columns).
 * The DuckDB runs are in question.duckdb.spec.ts.
 */
import { describe, expect, it } from 'vitest';
import { compileQuestion } from './compile';
import {
  applyDrill,
  binRange,
  drillFilter,
  drillOptions,
  excludeFilter,
  type BreakoutColumn,
  type DrillValue,
} from './drill';
import { parseExpression, printExpression } from './expression';
import { datePartsFor, getField } from './fields';
import { parseQuestionHeader, serializeQuestionHeader } from './header';
import {
  MAX_FILTER_TEXT,
  customColumnNameIssue,
  expressionFields,
  havingColumns,
  normalizeQuestion,
  questionColumns,
  questionIssues,
  type QuestionSpec,
} from './spec';

const spec = (input: Record<string, unknown>) =>
  normalizeQuestion({ source: 'transactions', ...input });

const column = (question: QuestionSpec, key: string): BreakoutColumn => {
  const found = questionColumns(question).find((item) => item.key === key);
  if (!found || found.kind !== 'breakout') throw new Error(`No breakout ${key}`);
  return found;
};

const cell = (
  question: QuestionSpec,
  key: string,
  value: unknown,
  hidden?: unknown
): DrillValue => ({
  column: column(question, key),
  value,
  ...(hidden !== undefined ? { key: hidden } : {}),
});

describe('backward compatibility', () => {
  it('an existing v2 header normalizes and re-serializes unchanged', () => {
    const header =
      '-- budgero-question:v2 {"source":"transactions","filters":[{"field":"is_transfer","op":"is","values":[false]},{"field":"date","op":"previous","values":[],"unit":"month","amount":6,"includeCurrent":true}],"aggregations":[{"op":"spending","compare":true}],"breakouts":[{"field":"date","bucket":"month"},{"field":"category"}],"sort":[{"column":"spending","direction":"desc"}],"limit":5,"visualization":"bar","customColumns":[{"id":"expr_1","name":"Size","expression":"abs([amount])"}]}';
    const parsed = parseQuestionHeader(header);
    expect(parsed).not.toBeNull();
    expect(serializeQuestionHeader(parsed!)).toBe(header);
    expect('having' in parsed!).toBe(false);
  });

  it('a header with an unknown or missing source is plain SQL', () => {
    expect(parseQuestionHeader('-- budgero-question:v2 {"source":"goals"}\nSELECT 1')).toBeNull();
    expect(parseQuestionHeader('-- budgero-question:v2 {"filters":[]}\nSELECT 1')).toBeNull();
  });

  it('saved SQL without a fixed today keeps rolling with CURRENT_DATE', () => {
    const { sql } = compileQuestion(
      spec({
        aggregations: [{ op: 'count' }],
        filters: [{ field: 'date', op: 'current', unit: 'month', values: [] }],
      }),
      { budgetId: 1 }
    );
    expect(sql).toContain("DATE_TRUNC('month', CURRENT_DATE)");
  });
});

describe('having', () => {
  it('keeps filters on metric columns only, round-trips in the header', () => {
    const question = spec({
      aggregations: [{ op: 'spending', compare: true }, { op: 'count' }],
      breakouts: [{ field: 'date', bucket: 'month' }],
      having: [
        { column: 'spending', op: 'gt', values: ['100'] },
        { column: 'spending_change', op: 'between', values: [50, -50] },
        { column: 'month', op: 'gt', values: [1] }, // a grouping: dropped
        { column: 'count', op: 'like', values: [1] }, // unknown op: dropped
      ],
    });
    expect(question.having).toEqual([
      { column: 'spending', op: 'gt', values: [100] },
      { column: 'spending_change', op: 'between', values: [-50, 50] },
    ]);
    expect(havingColumns(question).map((item) => item.key)).toEqual([
      'spending',
      'spending_previous',
      'spending_change',
      'count',
    ]);
    expect(parseQuestionHeader(serializeQuestionHeader(question))).toEqual(question);
    expect(questionIssues({ ...question, having: [...question.having!, { column: 'x' }] })).toEqual(
      [{ kind: 'having', index: 2, reason: 'invalid' }]
    );
  });

  it('is left out by break-out and zoom drills', () => {
    const question = spec({
      aggregations: [{ op: 'spending' }],
      breakouts: [{ field: 'date', bucket: 'year' }],
      having: [{ column: 'spending', op: 'gt', values: [1] }],
    });
    const values = [cell(question, 'year', '2026')];
    expect(
      applyDrill({ spec: question, values }, { kind: 'zoom', key: 'year' }).having
    ).toBeUndefined();
    expect(
      applyDrill({ spec: question, values }, { kind: 'breakout', field: 'category' }).having
    ).toBeUndefined();
  });
});

describe('numeric bins', () => {
  it('number fields group only when binned', () => {
    expect(spec({ breakouts: [{ field: 'amount' }] }).breakouts).toEqual([]);
    expect(spec({ breakouts: [{ field: 'amount', bin: 0 }] }).breakouts).toEqual([]);
    const question = spec({
      breakouts: [
        { field: 'amount', bin: 'auto' },
        { field: 'outflow', bin: '25' },
      ],
    });
    expect(question.breakouts).toEqual([
      { field: 'amount', bin: 'auto' },
      { field: 'outflow', bin: 25 },
    ]);
    expect(questionColumns(question).map((item) => item.key)).toEqual([
      'amount_bin',
      'outflow_bin',
      'count',
    ]);
  });

  it('drills to the exact bin; auto bins read the width from the hidden key', () => {
    const question = spec({ breakouts: [{ field: 'outflow', bin: 'auto' }] });
    expect(drillFilter(question, cell(question, 'outflow_bin', 50, 50))).toEqual({
      field: 'outflow',
      op: 'between',
      values: [50, 100],
      binWidth: 50,
    });
    expect(drillFilter(question, cell(question, 'outflow_bin', null, 50))).toEqual({
      field: 'outflow',
      op: 'isEmpty',
      values: [],
    });
    // Without the width the bin can't be drilled exactly.
    expect(drillFilter(question, cell(question, 'outflow_bin', 50))).toBeNull();
    expect(excludeFilter(question, cell(question, 'outflow_bin', 50, 50))).toBeNull();
    expect(binRange(0.2, 0.1)).toEqual([0.2, 0.30000000000000004]);
    const { sql } = compileQuestion(
      spec({
        aggregations: [{ op: 'count' }],
        filters: [{ field: 'outflow', op: 'between', values: [0.2, 0.3], binWidth: 0.1 }],
      }),
      { budgetId: 1 }
    );
    expect(sql).toContain("FLOOR(CAST(outflow AS DOUBLE) / CAST('0.1' AS DOUBLE)) = 2");
  });
});

describe('date parts', () => {
  it('groupings and filters on a part of a date', () => {
    expect(datePartsFor(getField('budget', 'month'))).toEqual([
      'year',
      'quarterOfYear',
      'monthOfYear',
    ]);
    const question = spec({
      aggregations: [{ op: 'spending' }],
      breakouts: [{ field: 'date', part: 'dayOfWeek' }],
      filters: [
        { field: 'date', op: 'is', values: [7, 6, 6, 8, 1.5], part: 'dayOfWeek' },
        { field: 'date', op: 'current', values: [], part: 'dayOfWeek' }, // dropped
      ],
    });
    expect(question.breakouts).toEqual([{ field: 'date', part: 'dayOfWeek' }]);
    expect(question.filters).toEqual([
      { field: 'date', op: 'is', values: [7, 6], part: 'dayOfWeek' },
    ]);
    expect(questionColumns(question)[0].key).toBe('date_day_of_week');
    // Weekdays are categories, not a time line.
    expect(compileQuestion(question, { budgetId: 1 }).visualization).toBe('bar');
    // Budget months have no weekday: the grouping falls back to a bucket.
    expect(
      normalizeQuestion({ source: 'budget', breakouts: [{ field: 'month', part: 'dayOfWeek' }] })
        .breakouts
    ).toEqual([{ field: 'month', bucket: 'month' }]);
  });

  it('drills and excludes a part value; a weekday filter and a date range both stay', () => {
    const question = spec({
      aggregations: [{ op: 'count' }],
      breakouts: [{ field: 'date', part: 'dayOfWeek' }],
      filters: [{ field: 'date', op: 'between', values: ['2026-01-01', '2026-01-31'] }],
    });
    const saturday = cell(question, 'date_day_of_week', 6);
    expect(drillFilter(question, saturday)).toEqual({
      field: 'date',
      op: 'is',
      values: [6],
      part: 'dayOfWeek',
    });
    expect(excludeFilter(question, saturday)).toEqual({
      field: 'date',
      op: 'isNot',
      values: [6],
      part: 'dayOfWeek',
    });
    const records = applyDrill({ spec: question, values: [saturday] }, { kind: 'records' });
    expect(records.filters).toEqual([
      { field: 'date', op: 'between', values: ['2026-01-01', '2026-01-31'] },
      { field: 'date', op: 'is', values: [6], part: 'dayOfWeek' },
    ]);
    expect(drillOptions({ spec: question, values: [saturday] }).zoom).toBeNull();
  });

  it('date functions in expressions', () => {
    const fields = expressionFields('transactions');
    const parsed = parseExpression('Weekday([date]) >= 6', { fields, level: 'row' });
    expect(parsed.ok && printExpression(parsed.value.ast)).toBe('weekday([date]) >= 6');
    const wrong = parseExpression('month([amount])', { fields, level: 'row' });
    expect(!wrong.ok && wrong.error.code).toBe('typeMismatch');
  });
});

describe('compare with last year', () => {
  it('needs a date grouping and no modifier; distinct column keys', () => {
    const question = spec({
      aggregations: [
        { op: 'spending', compare: true, compareTo: 'lastYear' },
        { op: 'income', compare: true, compareTo: 'lastYear', modifier: 'running' },
        { op: 'count', compare: true, compareTo: 'nextYear' },
      ],
      breakouts: [{ field: 'date', bucket: 'month' }],
    });
    expect(question.aggregations).toEqual([
      { op: 'spending', compare: true, compareTo: 'lastYear' },
      { op: 'income', compare: true, modifier: 'running' },
      { op: 'count', compare: true },
    ]);
    const columns = questionColumns(question);
    expect(columns.map((item) => item.key)).toEqual([
      'month',
      'spending',
      'spending_last_year',
      'spending_yoy_change',
      'income_running_total',
      'income_running_total_previous',
      'income_running_total_change',
      'count',
      'count_previous',
      'count_change',
    ]);
    expect(columns[2]).toMatchObject({ derived: 'previous', compareTo: 'lastYear' });
    expect(
      spec({
        aggregations: [{ op: 'spending', compare: true, compareTo: 'lastYear' }],
        breakouts: [{ field: 'category' }],
      }).aggregations
    ).toEqual([{ op: 'spending' }]);
  });
});

describe('raw rows', () => {
  it('sort by any field of the source, shown or not', () => {
    const question = spec({
      columns: ['payee'],
      sort: [
        { column: 'amount', direction: 'asc' },
        { column: 'nope', direction: 'asc' },
      ],
    });
    expect(question.sort).toEqual([{ column: 'amount', direction: 'asc' }]);
    const { sql } = compileQuestion(question, { budgetId: 1 });
    expect(sql).toContain('AS amount__sort');
    expect(sql).toMatch(
      /SELECT payee\nFROM result\nORDER BY amount__sort ASC NULLS LAST, row_order/
    );
    // Summarized questions still sort by output columns only.
    expect(
      spec({ aggregations: [{ op: 'count' }], sort: [{ column: 'amount', direction: 'asc' }] }).sort
    ).toEqual([]);
  });
});

describe('validation instead of silent drops', () => {
  it('custom column names that collide with a field are rejected (and renamed when stored)', () => {
    expect(customColumnNameIssue('transactions', [], 'Amount')).toBe('taken');
    expect(customColumnNameIssue('transactions', [], 'expr_3')).toBe('taken');
    expect(
      customColumnNameIssue('transactions', [], 'Betrag', undefined, (id) =>
        id === 'amount' ? ['Amount', 'Betrag'] : []
      )
    ).toBe('taken');
    const columns = [{ id: 'expr_1', name: 'Size', expression: '1' }];
    expect(customColumnNameIssue('transactions', columns, 'size')).toBe('taken');
    expect(customColumnNameIssue('transactions', columns, 'size', 'expr_1')).toBeNull();
    expect(customColumnNameIssue('transactions', columns, ' ')).toBe('empty');
    expect(customColumnNameIssue('transactions', columns, 'a[b]')).toBe('brackets');
    expect(customColumnNameIssue('transactions', columns, 'x'.repeat(61))).toBe('tooLong');
  });

  it('lists dropped custom columns, metrics and filters with the reason', () => {
    const issues = questionIssues({
      source: 'transactions',
      customColumns: [
        { id: 'expr_1', name: 'payee', expression: '[outflow]' },
        { id: 'expr_2', name: 'Broken', expression: 'abs([nope])' },
      ],
      aggregations: [{ op: 'custom', name: 'Ratio', expression: 'Sum([amount]) / ' }],
      filters: [
        { field: 'memo', op: 'is', values: ['m'.repeat(MAX_FILTER_TEXT + 1)] },
        { field: 'nope', op: 'is', values: [1] },
        { field: 'memo', op: 'is', values: ['m'.repeat(MAX_FILTER_TEXT)] }, // fine
      ],
    });
    expect(issues.map(({ error, ...rest }) => ({ ...rest, code: error?.code }))).toEqual([
      { kind: 'customColumn', index: 0, reason: 'nameTaken', name: 'payee 2', code: undefined },
      {
        kind: 'customColumn',
        index: 1,
        reason: 'expression',
        name: 'Broken',
        code: 'unknownField',
      },
      { kind: 'filter', index: 0, reason: 'textTooLong', code: undefined },
      { kind: 'filter', index: 1, reason: 'invalid', code: undefined },
      {
        kind: 'customMetric',
        index: 0,
        reason: 'expression',
        name: 'Ratio',
        code: 'unexpectedEnd',
      },
    ]);
  });

  it('rejects number literals that would not read back the same', () => {
    const fields = expressionFields('transactions');
    for (const text of [
      'Sum([outflow]) + 100000000000000000000000',
      'Sum([outflow]) + 9007199254740993',
      'Sum([outflow]) * 0.0000000000000000000000001',
    ]) {
      const result = parseExpression(text, { fields, level: 'metric' });
      expect(result.ok, text).toBe(false);
      expect(!result.ok && result.error.code).toBe('numberTooPrecise');
    }
    const ok = parseExpression('Sum([outflow]) * 9007199254740991 + 0.125', {
      fields,
      level: 'metric',
    });
    expect(ok.ok && printExpression(ok.value.ast)).toBe(
      'Sum([outflow]) * 9007199254740991 + 0.125'
    );
  });

  it('drill-through needs every clicked value; too-long text offers none', () => {
    const question = spec({
      aggregations: [{ op: 'count' }],
      breakouts: [{ field: 'payee' }, { field: 'category' }],
    });
    const long = cell(question, 'payee', 'p'.repeat(MAX_FILTER_TEXT + 1));
    const category = cell(question, 'category', 'Food', 7);
    expect(drillFilter(question, long)).toBeNull();
    const options = drillOptions({ spec: question, values: [long, category] });
    expect(options.records).toBe(false);
    expect(options.breakoutFields).toEqual([]);
    expect(drillOptions({ spec: question, values: [category] }).records).toBe(true);
  });

  it('a NULL boolean cell drills as false', () => {
    const question = spec({
      customColumns: [{ id: 'expr_1', name: 'Big', expression: '[outflow] / [inflow] > 1' }],
      breakouts: [{ field: 'expr_1' }],
    });
    expect(drillFilter(question, cell(question, 'expr_1', null))).toEqual({
      field: 'expr_1',
      op: 'is',
      values: [false],
    });
  });
});
