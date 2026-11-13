import { describe, expect, it } from 'vitest';
import type { UnifiedReport } from '@budgero/core/browser';
import { buildSavedQuestionQuery, createQuestion } from '@features/reports/lib/question';
import { chartChoiceLabel, questionChoices } from './question-choices';

const chart = (id: string, patch = {}) => ({
  id,
  chartType: 'bar' as const,
  xAxisColumn: 'month',
  yAxisColumn: 'amount',
  aggregateFunction: 'SUM' as const,
  ...patch,
});

const report = (patch: Partial<UnifiedReport>): UnifiedReport => ({
  id: 'r',
  name: 'Q',
  query: 'SELECT 1',
  charts: [],
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
  ...patch,
});

describe('questionChoices', () => {
  it('lists notebook questions with their one chart and SQL questions with all of theirs', () => {
    const notebook = report({
      id: 'n',
      updatedAt: '2026-03-01',
      query: buildSavedQuestionQuery(
        createQuestion('transactions', { aggregations: [{ op: 'spending' }] }),
        'SELECT 1'
      ),
      charts: [chart('n1', { chartType: 'stat' }), chart('n2')],
    });
    const sql = report({ id: 's', updatedAt: '2026-02-01', charts: [chart('s1'), chart('s2')] });
    const bare = report({ id: 'b', updatedAt: '2026-01-01' });
    const [first, second, third] = questionChoices([bare, sql, notebook]);
    expect(first.report.id).toBe('n');
    expect(first.charts.map((item) => item.id)).toEqual(['n1']);
    expect(first.summary).toBe('Spending');
    expect(second.charts.map((item) => item.id)).toEqual(['s1', 's2']);
    expect(second.summary).toBe('SQL query');
    // A table / SQL question saved without a chart can still be added.
    expect(third.needsChart).toBe(true);
    expect(third.charts).toEqual([]);
  });

  it('names an SQL chart by title, else type and column', () => {
    expect(chartChoiceLabel(chart('a', { title: ' Monthly ' }))).toBe('Monthly');
    expect(chartChoiceLabel(chart('a'))).toBe('Bar · month');
    expect(chartChoiceLabel(chart('a', { chartType: 'stat' }))).toBe('Number · amount');
  });
});
