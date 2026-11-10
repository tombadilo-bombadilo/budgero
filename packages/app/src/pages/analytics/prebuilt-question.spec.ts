import { describe, expect, it } from 'vitest';
import { compileQuestion, normalizeQuestion, questionIssues } from '@features/reports/lib/question';
import { DEFAULT_SELECTIONS, type ReportKey } from './analytics-state';
import { prebuiltQuestion } from './prebuilt-question';

describe('prebuiltQuestion', () => {
  it('carries the report’s filters into the question', () => {
    const question = prebuiltQuestion('spending', {
      ...DEFAULT_SELECTIONS,
      period: '6m',
      accountIds: [3],
      categoryIds: [7, 8],
      payees: ['Shop'],
    })!;
    expect(question.spec.filters).toEqual([
      { field: 'is_transfer', op: 'is', values: [false] },
      { field: 'on_budget', op: 'is', values: [true] },
      {
        field: 'date',
        op: 'previous',
        values: [],
        amount: 6,
        unit: 'month',
        includeCurrent: true,
      },
      { field: 'account', op: 'is', values: [3] },
      { field: 'category', op: 'is', values: [7, 8] },
      { field: 'payee', op: 'is', values: ['Shop'] },
    ]);
    const custom = prebuiltQuestion('in-out', {
      ...DEFAULT_SELECTIONS,
      period: 'custom',
      customStart: '2026-01-01',
      customEnd: '2026-03-31',
    })!;
    expect(custom.spec.filters.at(-1)).toEqual({
      field: 'date',
      op: 'between',
      values: ['2026-01-01', '2026-03-31'],
    });
  });

  it('is a valid question for every report that can be one', () => {
    const keys: ReportKey[] = ['spending', 'in-out', 'money-map', 'ledger', 'plan'];
    for (const key of keys) {
      const { spec } = prebuiltQuestion(key, DEFAULT_SELECTIONS)!;
      expect(questionIssues(spec), key).toEqual([]);
      expect(normalizeQuestion(spec), key).toEqual(spec);
      expect(() => compileQuestion(spec, { budgetId: 1 })).not.toThrow();
    }
    expect(prebuiltQuestion('plan', DEFAULT_SELECTIONS)!.spec.filters[0]).toMatchObject({
      field: 'month',
      op: 'previous',
    });
    expect(prebuiltQuestion('wealth', DEFAULT_SELECTIONS)).toBeNull();
    expect(prebuiltQuestion('scenario', DEFAULT_SELECTIONS)).toBeNull();
  });
});
