import { describe, expect, it } from 'vitest';
import { isReadOnlyQuery, stripLeadingSqlComments } from '@shared/lib/sql/read-only';
import { SOURCE_FIELDS, QUESTION_SOURCES } from './fields';
import { compileQuestion, sqlString } from './compile';
import {
  LEGACY_HEADER_PREFIX,
  QUESTION_HEADER_PREFIX,
  buildSavedQuestionQuery,
  isQuestionQuery,
  parseQuestionHeader,
  serializeQuestionHeader,
  stripQuestionHeader,
} from './header';
import {
  allowedVisualizations,
  createQuestion,
  normalizeQuestion,
  operatorsFor,
  questionColumnKeys,
  resolveVisualization,
  type QuestionSpec,
} from './spec';

const compile = (spec: Partial<QuestionSpec>, budgetId = 7) =>
  compileQuestion(normalizeQuestion({ source: 'transactions', ...spec }), { budgetId });

describe('normalizeQuestion', () => {
  it('never throws and falls back to a raw Transactions question', () => {
    for (const input of [null, undefined, 42, 'x', [], { source: 'nope', filters: 'bad' }]) {
      const spec = normalizeQuestion(input);
      expect(spec.source).toBe('transactions');
      expect(spec.aggregations).toEqual([]);
      expect(spec.visualization).toBe('auto');
    }
  });

  it('new Transactions questions start with the budget-meaning filter chips', () => {
    expect(createQuestion().filters).toEqual([
      { field: 'is_transfer', op: 'is', values: [false] },
      { field: 'on_budget', op: 'is', values: [true] },
    ]);
    expect(createQuestion('budget').filters).toEqual([]);
    expect(createQuestion('accounts').filters).toEqual([]);
  });

  it('drops unknown fields, wrong operators and incomplete values', () => {
    const spec = normalizeQuestion({
      source: 'transactions',
      filters: [
        { field: 'nope', op: 'is', values: [1] },
        { field: 'amount', op: 'contains', values: ['x'] }, // not a number op
        { field: 'category', op: 'is', values: [] },
        { field: 'category', op: 'is', values: ['3', 3, -1, 2.5, 'x'] },
        { field: 'date', op: 'between', values: ['2026-02-30', '2026-03-01'] },
        { field: 'date', op: 'between', values: ['2026-03-31', '2026-01-01'] },
        { field: 'date', op: 'previous', values: [], amount: 0, unit: 'month' },
        { field: 'date', op: 'previous', values: [], amount: 3.7, unit: 'week' },
        { field: 'amount', op: 'between', values: [10, '-5'] },
        { field: 'payee', op: 'is', values: ['  Lidl ', 'Lidl', ''] },
        { field: 'is_transfer', op: 'is', values: ['false'] },
        { field: 'memo', op: 'isEmpty', values: ['ignored'] },
      ],
    });
    expect(spec.filters).toEqual([
      { field: 'category', op: 'is', values: [3] },
      { field: 'date', op: 'between', values: ['2026-01-01', '2026-03-31'] },
      {
        field: 'date',
        op: 'previous',
        values: [],
        amount: 3,
        unit: 'week',
        includeCurrent: true,
      },
      { field: 'amount', op: 'between', values: [-5, 10] },
      { field: 'payee', op: 'is', values: ['Lidl'] },
      { field: 'memo', op: 'isEmpty', values: [] },
    ]);
  });

  it('keeps aggregations valid for the source', () => {
    expect(
      normalizeQuestion({
        source: 'budget',
        aggregations: [
          { op: 'spending' }, // Transactions only
          { op: 'sum', field: 'assigned' },
          { op: 'sum', field: 'category' }, // not numeric
          { op: 'distinct', field: 'category' },
          { op: 'avg' }, // needs a field
        ],
      }).aggregations
    ).toEqual([
      { op: 'sum', field: 'assigned' },
      { op: 'distinct', field: 'category' },
    ]);
  });

  it('defaults date buckets, dedupes groupings and adds Count to groupings without metrics', () => {
    const spec = normalizeQuestion({
      source: 'budget',
      breakouts: [
        { field: 'month', bucket: 'day' }, // not allowed on budget months
        { field: 'month' },
        { field: 'assigned' }, // numbers aren't groupable
        { field: 'category' },
      ],
    });
    expect(spec.breakouts).toEqual([{ field: 'month', bucket: 'month' }, { field: 'category' }]);
    expect(spec.aggregations).toEqual([{ op: 'count' }]);
  });

  it('caps the limit, drops sorts on missing columns and the column picker in summary mode', () => {
    const spec = normalizeQuestion({
      aggregations: [{ op: 'spending' }],
      breakouts: [{ field: 'category' }],
      sort: [
        { column: 'spending', direction: 'asc' },
        { column: 'month', direction: 'asc' },
        { column: 'x; DROP TABLE y', direction: 'asc' },
      ],
      limit: 1e9,
      columns: ['date'],
    });
    expect(spec.sort).toEqual([{ column: 'spending', direction: 'asc' }]);
    expect(spec.limit).toBe(10_000);
    expect(spec.columns).toBeNull();
  });

  it('offers operators per field type', () => {
    const field = (source: (typeof QUESTION_SOURCES)[number], id: string) =>
      SOURCE_FIELDS[source].find((item) => item.id === id)!;
    expect(operatorsFor(field('transactions', 'date'))).toContain('previous');
    expect(operatorsFor(field('transactions', 'amount'))).toEqual([
      'is',
      'isNot',
      'gt',
      'lt',
      'between',
      'isEmpty',
      'notEmpty',
    ]);
    expect(operatorsFor(field('transactions', 'payee'))).toContain('startsWith');
    expect(operatorsFor(field('accounts', 'closed'))).toEqual(['is']);
  });
});

describe('output columns and visualization', () => {
  it('names columns after groupings and metrics, deduping repeats', () => {
    expect(
      questionColumnKeys(
        normalizeQuestion({
          source: 'transactions',
          aggregations: [{ op: 'count' }, { op: 'count' }, { op: 'sum', field: 'amount' }],
          breakouts: [
            { field: 'date', bucket: 'month' },
            { field: 'date', bucket: 'year' },
          ],
        })
      )
    ).toEqual(['month', 'year', 'count', 'count_2', 'sum_amount']);
    expect(
      questionColumnKeys(
        normalizeQuestion({
          source: 'accounts',
          aggregations: [{ op: 'count' }],
          breakouts: [{ field: 'last_transaction', bucket: 'quarter' }],
        })
      )
    ).toEqual(['last_transaction_quarter', 'count']);
  });

  it('auto-picks number, line, bar or table and rejects impossible choices', () => {
    const viz = (spec: Partial<QuestionSpec>) =>
      resolveVisualization(normalizeQuestion({ source: 'transactions', ...spec }));
    expect(viz({})).toBe('table');
    expect(viz({ aggregations: [{ op: 'spending' }] })).toBe('number');
    expect(viz({ aggregations: [{ op: 'spending' }], breakouts: [{ field: 'date' }] })).toBe(
      'line'
    );
    expect(viz({ aggregations: [{ op: 'spending' }], breakouts: [{ field: 'category' }] })).toBe(
      'bar'
    );
    expect(
      viz({
        aggregations: [{ op: 'spending' }],
        breakouts: [{ field: 'category' }],
        visualization: 'pie',
      })
    ).toBe('pie');
    // Pie needs exactly one grouping; number needs no grouping.
    expect(
      viz({
        aggregations: [{ op: 'spending' }],
        breakouts: [{ field: 'category' }, { field: 'date' }],
        visualization: 'pie',
      })
    ).toBe('bar');
    expect(
      viz({
        aggregations: [{ op: 'spending' }],
        breakouts: [{ field: 'date' }],
        visualization: 'number',
      })
    ).toBe('line');
    expect(
      allowedVisualizations(normalizeQuestion({ aggregations: [{ op: 'spending' }] }))
    ).toEqual(['number', 'table']);
  });

  it('builds a dashboard chart config from the first grouping and metric', () => {
    const { chart } = compileQuestion(
      normalizeQuestion({
        source: 'transactions',
        aggregations: [{ op: 'income' }, { op: 'spending' }],
        breakouts: [{ field: 'date', bucket: 'month' }, { field: 'category_group' }],
      }),
      { budgetId: 1, chartId: 'keep-me', chartTitle: 'Flows' }
    );
    expect(chart).toEqual({
      id: 'keep-me',
      chartType: 'line',
      title: 'Flows',
      xAxisColumn: 'month',
      yAxisColumn: 'income',
      groupByColumn: 'category_group',
      aggregateFunction: 'SUM',
    });
    expect(compile({ aggregations: [{ op: 'net' }] }).chart).toMatchObject({
      chartType: 'stat',
      xAxisColumn: 'net',
      yAxisColumn: 'net',
    });
  });
});

describe('compileQuestion', () => {
  it('requires a budget', () => {
    expect(() => compileQuestion(createQuestion(), { budgetId: 0 })).toThrow();
    expect(() => compileQuestion(createQuestion(), { budgetId: 1.5 })).toThrow();
  });

  it.each(QUESTION_SOURCES)('%s: a single read-only statement scoped to the budget', (source) => {
    const { sql } = compileQuestion(createQuestion(source), { budgetId: 42 });
    expect(isReadOnlyQuery(sql)).toBe(true);
    expect(sql.startsWith('WITH ')).toBe(true);
    expect(sql).not.toContain(';');
    if (source === 'transactions') expect(sql).toContain('t.budget_id = 42');
    if (source === 'budget') {
      expect(sql).toContain('a."BudgetID" = 42');
      expect(sql).toContain('c."BudgetID" = 42');
    }
    if (source === 'accounts') {
      expect(sql).toContain('a."BudgetID" = 42');
      expect(sql).toContain('WHERE budget_id = 42');
    }
    expect(sql).not.toMatch(/budget_id = (?!42)\d+/);
  });

  it('escapes every user-supplied text value', () => {
    const evil = "x'); DROP TABLE transactions; --";
    const { sql } = compile({
      filters: [
        { field: 'payee', op: 'is', values: [evil] },
        { field: 'memo', op: 'contains', values: [evil] },
        { field: 'category', op: 'startsWith', values: [evil] },
      ],
    });
    const escaped = sqlString(evil.toLowerCase());
    expect(sql.split(escaped).length - 1).toBe(3);
    expect(sql).not.toContain("x'); DROP");
    expect(sqlString("a'b\u0000c")).toBe("'a''bc'");
  });

  it('escapes the labels baked into the SQL', () => {
    const { sql } = compileQuestion(createQuestion(), {
      budgetId: 1,
      labels: { uncategorized: "Ohne' Kat", noPayee: 'P', noLabel: 'L', noAccount: 'A' },
    });
    expect(sql).toContain("'Ohne'' Kat'");
  });

  it('turns filter operators into SQL', () => {
    const { sql } = compile({
      filters: [
        { field: 'category', op: 'is', values: [3, 4] },
        { field: 'account', op: 'isNot', values: [9] },
        { field: 'label', op: 'isEmpty', values: [] },
        { field: 'payee', op: 'notEmpty', values: [] },
        { field: 'amount', op: 'gt', values: [100] },
        { field: 'amount', op: 'lt', values: [-1.5] },
        { field: 'outflow', op: 'between', values: [1, 2] },
        { field: 'date', op: 'before', values: ['2026-01-01'] },
        { field: 'date', op: 'after', values: ['2025-01-01'] },
        { field: 'is_transfer', op: 'is', values: [false] },
      ],
    });
    expect(sql).toContain('category_id IN (3, 4)');
    expect(sql).toContain('(account_id IS NULL OR account_id NOT IN (9))');
    expect(sql).toContain('label_id IS NULL');
    expect(sql).toContain("NOT (NULLIF(TRIM(payee_name), '') IS NULL)");
    expect(sql).toContain('CAST(amount AS DOUBLE) > 100');
    expect(sql).toContain('CAST(amount AS DOUBLE) < -1.5');
    expect(sql).toContain('CAST(outflow AS DOUBLE) BETWEEN 1 AND 2');
    expect(sql).toContain("date < CAST('2026-01-01' AS DATE)");
    expect(sql).toContain("date > CAST('2025-01-01' AS DATE)");
    expect(sql).toContain('COALESCE(is_transfer, FALSE) = FALSE');
  });

  it('relative dates use CURRENT_DATE unless today is pinned', () => {
    const filters = [
      { field: 'date', op: 'previous', values: [], amount: 3, unit: 'month' },
    ] as QuestionSpec['filters'];
    expect(compile({ filters }).sql).toContain(
      "date >= CAST(DATE_TRUNC('month', CURRENT_DATE) AS DATE) - INTERVAL 2 MONTH"
    );
    const pinned = compileQuestion(normalizeQuestion({ filters }), {
      budgetId: 1,
      today: '2026-11-06',
    }).sql;
    expect(pinned).toContain("DATE_TRUNC('month', CAST('2026-11-06' AS DATE))");
    expect(pinned).not.toContain('CURRENT_DATE');
  });

  it('splits split transactions into lines for the Transactions and Budget sources', () => {
    expect(compile({}).sql).toContain('JOIN transaction_splits s');
    expect(compileQuestion(createQuestion('budget'), { budgetId: 1 }).sql).toContain(
      'JOIN transaction_splits s'
    );
  });
});

describe('saved question header', () => {
  const spec = normalizeQuestion({
    source: 'transactions',
    filters: [{ field: 'payee', op: 'is', values: ['Line\nbreak', "O'Brien"] }],
    aggregations: [{ op: 'spending' }],
    breakouts: [{ field: 'category' }],
    sort: [{ column: 'spending', direction: 'desc' }],
    limit: 5,
    visualization: 'pie',
  });

  it('round-trips through a single header line', () => {
    const header = serializeQuestionHeader(spec);
    expect(header.startsWith(QUESTION_HEADER_PREFIX)).toBe(true);
    expect(header).not.toContain('\n');
    const saved = buildSavedQuestionQuery(spec, 'WITH x AS (SELECT 1) SELECT * FROM x');
    expect(parseQuestionHeader(saved)).toEqual(spec);
    expect(isQuestionQuery(saved)).toBe(true);
    expect(stripQuestionHeader(saved)).toBe('WITH x AS (SELECT 1) SELECT * FROM x');
    expect(stripLeadingSqlComments(saved).startsWith('WITH')).toBe(true);
  });

  it('ignores plain SQL and broken headers', () => {
    expect(parseQuestionHeader('SELECT 1')).toBeNull();
    expect(parseQuestionHeader(`${QUESTION_HEADER_PREFIX} {nope\nSELECT 1`)).toBeNull();
    expect(parseQuestionHeader(`${QUESTION_HEADER_PREFIX} [1]\nSELECT 1`)).toBeNull();
    expect(stripQuestionHeader('SELECT 1')).toBe('SELECT 1');
  });

  it('upgrades v1 builder headers to v2 specs', () => {
    const saved = `${LEGACY_HEADER_PREFIX} ${JSON.stringify({
      v: 1,
      measure: 'incomeVsSpending',
      groupBy: 'month',
      dateRange: { preset: 'last12Months' },
      filters: { categoryIds: [3], payees: ['Lidl'] },
      includeOffBudget: true,
      chartType: 'line',
      sort: 'label',
      limit: null,
    })}\nWITH lines AS (SELECT 1) SELECT 1`;
    expect(parseQuestionHeader(saved)).toEqual({
      v: 2,
      source: 'transactions',
      filters: [
        {
          field: 'date',
          op: 'previous',
          values: [],
          amount: 12,
          unit: 'month',
          includeCurrent: true,
        },
        { field: 'is_transfer', op: 'is', values: [false] },
        { field: 'category', op: 'is', values: [3] },
        { field: 'payee', op: 'is', values: ['Lidl'] },
      ],
      aggregations: [{ op: 'income' }, { op: 'spending' }],
      breakouts: [{ field: 'date', bucket: 'month' }],
      sort: [],
      limit: null,
      columns: null,
      visualization: 'line',
    });
    expect(stripQuestionHeader(saved)).toBe('WITH lines AS (SELECT 1) SELECT 1');
  });

  it('upgrades v1 categorical sorts, Top N, splits and stats', () => {
    const upgrade = (v1: Record<string, unknown>) =>
      parseQuestionHeader(`${LEGACY_HEADER_PREFIX} ${JSON.stringify(v1)}\nSELECT 1`)!;
    expect(
      upgrade({ measure: 'spending', groupBy: 'payee', sort: 'valueAsc', limit: 10 })
    ).toMatchObject({
      breakouts: [{ field: 'payee' }],
      sort: [{ column: 'spending', direction: 'asc' }],
      limit: 10,
    });
    expect(
      upgrade({ measure: 'count', groupBy: 'label', splitBy: 'quarter', sort: 'label' })
    ).toMatchObject({
      aggregations: [{ op: 'count' }],
      breakouts: [{ field: 'label' }, { field: 'date', bucket: 'quarter' }],
      sort: [{ column: 'label', direction: 'asc' }],
    });
    expect(upgrade({ measure: 'net', groupBy: 'category', chartType: 'stat' })).toMatchObject({
      aggregations: [{ op: 'net' }],
      breakouts: [],
      visualization: 'number',
    });
    expect(upgrade({ measure: 'spending', dateRange: { preset: 'thisMonth' } }).filters[0]).toEqual(
      { field: 'date', op: 'current', values: [], unit: 'month' }
    );
  });
});
