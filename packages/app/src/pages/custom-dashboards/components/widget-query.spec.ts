import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChartConfiguration, UnifiedReport } from '@budgero/core/browser';
import {
  buildSavedQuestionQuery,
  compileQuestion,
  createQuestion,
  todayIso,
  type QuestionSpec,
} from '@features/reports/lib/question';
import * as questionLib from '@features/reports/lib/question';
import { widgetQuestion } from './widget-query';

function savedReport(spec: QuestionSpec): { report: UnifiedReport; chart: ChartConfiguration } {
  const { sql, chart } = compileQuestion(spec, { budgetId: 1, chartId: 'chart-1' });
  const report = {
    id: 1,
    query: buildSavedQuestionQuery(spec, sql),
    charts: [chart],
  } as unknown as UnifiedReport;
  return { report, chart };
}

const monthly = createQuestion('transactions', {
  aggregations: [{ op: 'spending' }],
  breakouts: [{ field: 'date', bucket: 'month' }],
  filters: [{ field: 'date', op: 'previous', values: [], unit: 'month', amount: 3 }],
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('widgetQuestion', () => {
  it('compiles from the saved spec with the local today, also without dashboard filters', () => {
    const { report, chart } = savedReport(monthly);
    const question = widgetQuestion(report, chart, {}, 1);
    expect(question?.applied).toEqual([]);
    expect(question?.sql).toContain(`CAST('${todayIso()}' AS DATE)`);
    expect(question?.sql).not.toContain('CURRENT_DATE');
  });

  it('merges dashboard filters and reports them as applied', () => {
    const { report, chart } = savedReport(monthly);
    const question = widgetQuestion(report, chart, { accounts: [7] }, 1);
    expect(question?.applied).toEqual(['accounts']);
    expect(question?.sql).toContain('account_id IN (7)');
  });

  it('claims no filter when there is no budget to compile for', () => {
    const { report, chart } = savedReport(monthly);
    const question = widgetQuestion(report, chart, { accounts: [7] }, 0);
    expect(question?.sql).toBeNull();
    expect(question?.applied).toEqual([]);
    expect(question?.spec.filters.some((filter) => filter.field === 'account')).toBe(false);
  });

  it('falls back to the stored SQL when compiling throws', () => {
    const { report, chart } = savedReport(monthly);
    vi.spyOn(questionLib, 'compileQuestion').mockImplementation(() => {
      throw new Error('boom');
    });
    const question = widgetQuestion(report, chart, { accounts: [7] }, 1);
    expect(question).not.toBeNull();
    expect(question?.sql).toBeNull();
    expect(question?.applied).toEqual([]);
  });

  it('is null for plain SQL reports and for extra charts', () => {
    const { report, chart } = savedReport(monthly);
    expect(widgetQuestion({ ...report, query: 'SELECT 1' }, chart, {}, 1)).toBeNull();
    expect(widgetQuestion(report, { ...chart, id: 'other' }, {}, 1)).toBeNull();
  });
});
