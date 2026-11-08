import { describe, expect, it } from 'vitest';
import {
  expressionFieldIds,
  expressionToSql,
  parseExpression,
  printExpression,
  tokenize,
  type ExprEnv,
  type ExprField,
  type ExprSqlEnv,
} from './expression';

const FIELDS: ExprField[] = [
  { id: 'amount', type: 'number', money: true, names: ['Amount', 'Betrag'] },
  { id: 'outflow', type: 'number', money: true, names: ['Outflow'] },
  { id: 'category', type: 'string', names: ['Category'] },
  { id: 'category_group', type: 'string', names: ['Category group'] },
  { id: 'date', type: 'date', names: ['Date'] },
  { id: 'cleared', type: 'boolean', names: ['Cleared'] },
];

const row: ExprEnv = { fields: FIELDS, level: 'row' };
const metric: ExprEnv = { fields: FIELDS, level: 'metric', budgetMetrics: true };

const SQL_ENV: ExprSqlEnv = {
  field: (id) => `F(${id})`,
  metric: (name) => `M(${name})`,
  countIf: (condition) => `COUNTIF(${condition})`,
  string: (value) => `'${value.replace(/'/g, "''")}'`,
};
const TYPES = new Map(FIELDS.map((field) => [field.id, field.type]));

function ok(text: string, env: ExprEnv = row) {
  const result = parseExpression(text, env);
  if (!result.ok) throw new Error(`Expected ${text} to parse: ${result.error.message}`);
  return result.value;
}

function fails(text: string, env: ExprEnv = row) {
  const result = parseExpression(text, env);
  if (result.ok) throw new Error(`Expected ${text} to fail`);
  return result.error;
}

const sql = (text: string, env: ExprEnv = row) =>
  expressionToSql(ok(text, env).ast, SQL_ENV, TYPES);
const canonical = (text: string, env: ExprEnv = row) => printExpression(ok(text, env).ast);

describe('tokenizer', () => {
  it('reads numbers, strings, fields, names and operators with positions', () => {
    expect(
      tokenize('abs([Amount]) * 1.5 ≥ "a\\"b"').map((token) => [token.kind, token.text])
    ).toEqual([
      ['ident', 'abs'],
      ['(', '('],
      ['field', 'Amount'],
      [')', ')'],
      ['op', '*'],
      ['number', '1.5'],
      ['op', '>='],
      ['string', 'a"b'],
      ['eof', ''],
    ]);
    const [field] = tokenize('  [Category group]');
    expect([field.start, field.end]).toEqual([2, 18]);
  });

  it('accepts typographic operators', () => {
    expect(canonical('[Amount] × 2 ÷ 4 − 1')).toBe('[amount] * 2 / 4 - 1');
    expect(canonical('[Amount] ≠ 0')).toBe('[amount] != 0');
    expect(canonical('[Amount] <> 0 and [Amount] <= 3')).toBe('[amount] != 0 and [amount] <= 3');
  });
});

describe('parser and type checker', () => {
  it('resolves fields by id or any label, case-insensitively', () => {
    expect(ok('[betrag] + [AMOUNT] + [amount]').info).toEqual({
      type: 'number',
      money: true,
      aggregated: false,
    });
    expect(expressionFieldIds(ok('[Category] = "x" and [Cleared]').ast)).toEqual([
      'category',
      'cleared',
    ]);
  });

  it('follows operator precedence and keeps needed parentheses', () => {
    expect(canonical('1 + 2 * 3')).toBe('1 + 2 * 3');
    expect(canonical('(1 + 2) * 3')).toBe('(1 + 2) * 3');
    expect(canonical('10 - (4 - 3)')).toBe('10 - (4 - 3)');
    expect(canonical('10 - 4 - 3')).toBe('10 - 4 - 3');
    expect(canonical('-(1 + 2)')).toBe('-(1 + 2)');
    expect(canonical('not [Cleared] or [Amount] > 1')).toBe('not [cleared] or [amount] > 1');
    expect(canonical('not ([Cleared] or [Amount] > 1)')).toBe('not ([cleared] or [amount] > 1)');
    expect(canonical('([Amount] > 1) = true')).toBe('([amount] > 1) = true');
  });

  it('round-trips the canonical text and prints display names', () => {
    const text = 'SumIf([Outflow], [Category] = "Groceries") / Sum([Outflow]) * 100';
    const { ast } = ok(text, metric);
    const stored = printExpression(ast);
    expect(stored).toBe('SumIf([outflow], [category] = "Groceries") / Sum([outflow]) * 100');
    expect(printExpression(ok(stored, metric).ast)).toBe(stored);
    expect(
      printExpression(ast, {
        fieldName: (id) => FIELDS.find((field) => field.id === id)!.names![0],
      })
    ).toBe(text);
    expect(canonical('round(0.000001, 2)')).toBe('round(0.000001, 2)');
  });

  it('infers money for currency formatting', () => {
    expect(ok('Sum([Amount]) / Count', metric).info.money).toBe(true);
    expect(ok('Sum([Amount]) / Sum([Outflow])', metric).info.money).toBe(false);
    expect(ok('Spending / Income * 100', metric).info.money).toBe(false);
    expect(ok('Spending - Income', metric).info.money).toBe(true);
    expect(ok('abs([Amount])').info.money).toBe(true);
    expect(ok('[Amount] * [Amount]').info.money).toBe(false);
  });

  it('supports case, coalesce, contains, round and comparisons on dates', () => {
    expect(ok('case([Amount] > 0, "in", "out")').info.type).toBe('string');
    expect(ok('case([Amount] > 100, 3, [Amount] > 10, 2, 1)').info.type).toBe('number');
    expect(ok('coalesce([Category], "none")').info.type).toBe('string');
    expect(ok('contains([Category], "food")').info.type).toBe('boolean');
    expect(ok('[Date] >= "2026-01-01"').info.type).toBe('boolean');
    expect(ok('round([Amount], -2)').info.type).toBe('number');
    expect(ok('if([Cleared], 1, 0)').info.type).toBe('number');
  });

  it('explains mistakes with positions', () => {
    const unknown = fails('abs([Amout])');
    expect(unknown.code).toBe('unknownField');
    expect(unknown.detail).toBe('Amout');
    expect([unknown.start, unknown.end]).toEqual([4, 11]);
    expect(fails('').code).toBe('empty');
    expect(fails('   ').code).toBe('empty');
    expect(fails('[Amount] +').code).toBe('unexpectedEnd');
    expect(fails('([Amount] + 1').code).toBe('missingParen');
    expect(fails('[Amount] + 1)').code).toBe('unexpectedToken');
    expect(fails('"open').code).toBe('unterminatedString');
    expect(fails('[Amount').code).toBe('unterminatedField');
    expect(fails('[]').code).toBe('emptyField');
    expect(fails('foo([Amount])').code).toBe('unknownFunction');
    expect(fails('banana').code).toBe('unknownName');
    expect(fails('abs').code).toBe('missingParen');
    expect(fails('abs(1, 2)').code).toBe('argumentCount');
    expect(fails('[Category] + 1').code).toBe('expectedNumber');
    expect(fails('[Amount] = "x"').code).toBe('typeMismatch');
    expect(fails('[Date] > "2026-02-30"').code).toBe('invalidDate');
    expect(fails('1 < 2 < 3').code).toBe('unexpectedToken');
    expect(fails('[Amount] and true').code).toBe('expectedBoolean');
    expect(fails('round([Amount], 1.5)').code).toBe('roundDigits');
    expect(fails('round([Amount], [Amount])').code).toBe('roundDigits');
    expect(fails('case([Amount], 1, 2)').code).toBe('expectedBoolean');
    expect(fails('case([Cleared], 1, "a")').code).toBe('typeMismatch');
    expect(fails('[Date]').code).toBe('columnResultDate');
    expect(fails('1 @ 2')).toMatchObject({ code: 'unexpectedCharacter', start: 2 });
    expect(fails('12abc').code).toBe('unexpectedCharacter');
  });

  it('keeps aggregations out of columns and fields inside aggregations in metrics', () => {
    expect(fails('Sum([Amount])').code).toBe('aggregateInColumn');
    expect(fails('Spending').code).toBe('metricInColumn');
    expect(fails('Sum([Amount]) + [Amount]', metric).code).toBe('fieldOutsideAggregate');
    expect(fails('Sum(Sum([Amount]))', metric).code).toBe('nestedAggregate');
    expect(fails('Sum(Spending)', metric).code).toBe('nestedAggregate');
    expect(fails('1 + 1', metric).code).toBe('needsAggregate');
    expect(fails('CountIf([Amount] > 0) > 1', metric).code).toBe('metricResultNotNumber');
    expect(fails('Spending', { ...metric, budgetMetrics: false }).code).toBe('metricUnavailable');
    expect(ok('Count', { ...metric, budgetMetrics: false }).info.aggregated).toBe(true);
  });

  it('accepts localized metric names', () => {
    const env = { ...metric, metricNames: { Ausgaben: 'spending' as const } };
    expect(printExpression(ok('Ausgaben / 2', env).ast)).toBe('Spending / 2');
  });

  it('rejects oversized and deeply nested input instead of crashing', () => {
    expect(fails(`${'1+'.repeat(600)}1`).code).toBe('tooLong');
    expect(fails(`${'('.repeat(60)}1${')'.repeat(60)}`).code).toBe('tooComplex');
    expect(fails(`${'-'.repeat(80)}1`).code).toBe('tooComplex');
    expect(fails(`${'abs('.repeat(45)}1${')'.repeat(45)}`).code).toBe('tooComplex');
  });
});

describe('SQL', () => {
  it('compiles arithmetic with safe division', () => {
    expect(sql('abs([Amount]) / 2')).toBe(
      '(CAST(ABS(F(amount)) AS DOUBLE) / NULLIF(CAST(2 AS DOUBLE), 0))'
    );
    expect(sql('-[Amount] + 1.25')).toBe('((-F(amount)) + 1.25)');
  });

  it('compiles aggregates, conditional aggregates and metrics', () => {
    expect(sql('SumIf([Outflow], [Category] = "Groceries")', metric)).toBe(
      "CAST(COALESCE(SUM(CASE WHEN (LOWER(F(category)) = LOWER('Groceries')) THEN F(outflow) ELSE 0 END), 0) AS DOUBLE)"
    );
    expect(sql('CountIf([Cleared]) / Count * 100', metric)).toBe(
      '((CAST((COUNTIF(F(cleared))) AS DOUBLE) / NULLIF(CAST((M(count)) AS DOUBLE), 0)) * 100)'
    );
    expect(sql('Spending / Income', metric)).toBe(
      '(CAST((M(spending)) AS DOUBLE) / NULLIF(CAST((M(income)) AS DOUBLE), 0))'
    );
    expect(sql('Distinct([Category])', metric)).toBe('COUNT(DISTINCT F(category))');
  });

  it('compiles case, coalesce, contains, round and date comparisons', () => {
    expect(sql('case([Amount] > 0, "in", "out")')).toBe(
      "(CASE WHEN (F(amount) > 0) THEN 'in' ELSE 'out' END)"
    );
    expect(sql('case([Cleared], 1)')).toBe('(CASE WHEN F(cleared) THEN 1 ELSE NULL END)');
    expect(sql('round([Amount], -2)')).toBe('ROUND(F(amount), -2)');
    expect(sql('[Date] < "2026-01-01"')).toBe("(F(date) < CAST('2026-01-01' AS DATE))");
    expect(sql('contains([Category], "Fo")')).toBe(
      "contains(LOWER(COALESCE(F(category), '')), LOWER('Fo'))"
    );
  });

  it('never lets user text into SQL except as escaped literals', () => {
    const attempts = [
      `[Category] = "x'); DROP TABLE transactions; --"`,
      `[Category] = 'a\\' OR 1=1 --'`,
      `contains([Category], "\\" OR TRUE --")`,
    ];
    for (const text of attempts) {
      const out = sql(text);
      // Every quote in the output belongs to a literal: removing literals leaves no quotes.
      const withoutLiterals = out.replace(/'(?:[^']|'')*'/g, "''");
      expect(withoutLiterals).not.toMatch(/DROP|OR 1=1|OR TRUE|--/);
    }
    expect(sql(`[Category] = "x'); DROP TABLE t; --"`)).toContain(`'x''); DROP TABLE t; --'`);
    // SQL-style doubled quotes just end the text; the rest doesn't parse.
    expect(fails(`[Category] = 'a'' OR 1=1 --'`).code).toBe('unexpectedToken');
    // Field names, functions and keywords never pass through as text.
    expect(fails('[amount; DROP TABLE x]').code).toBe('unknownField');
    expect(fails('DROP([Amount])').code).toBe('unknownFunction');
    expect(fails('[Amount] -- comment').code).toBe('unknownName');
    expect(fails('[Amount] /* x */').code).toBe('unexpectedToken');
    expect(fails('[Amount]; SELECT 1').code).toBe('unexpectedCharacter');
    expect(fails('`x`').code).toBe('unexpectedCharacter');
    expect(fails('sum([Amount]) over ()', metric).code).toBe('unexpectedToken');
  });
});
