import { describe, expect, it } from 'vitest';
import {
  compileQuestion,
  normalizeQuestion,
  questionIssues,
  resolveStacking,
  resolveVisualization,
} from '@features/reports/lib/question';
import { questionExamples } from './question-examples';

describe('questionExamples', () => {
  it('are valid questions that keep every part they ask for', () => {
    const examples = questionExamples();
    expect(examples.length).toBeGreaterThanOrEqual(8);
    expect(new Set(examples.map((example) => example.id)).size).toBe(examples.length);
    for (const { id, spec } of examples) {
      expect(questionIssues(spec), id).toEqual([]);
      expect(normalizeQuestion(spec), id).toEqual(spec);
      expect(() => compileQuestion(spec, { budgetId: 1 }), id).not.toThrow();
    }
  });

  it('show off stacked, 100%, date parts, ranges, last year and the budget', () => {
    const byId = new Map(questionExamples().map((example) => [example.id, example.spec]));
    const stacked = byId.get('category-month')!;
    expect(resolveVisualization(stacked)).toBe('bar');
    expect(resolveStacking(stacked, 'bar')).toBe('stacked');
    expect(resolveStacking(byId.get('group-share')!, 'bar')).toBe('percent');
    expect(byId.get('weekday')!.breakouts).toEqual([{ field: 'date', part: 'dayOfWeek' }]);
    expect(byId.get('amount-ranges')!.breakouts).toEqual([{ field: 'outflow', bin: 'auto' }]);
    expect(byId.get('vs-last-year')!.aggregations[0].compareTo).toBe('lastYear');
    expect(byId.get('assigned-spent')!.source).toBe('budget');
    expect(byId.get('assigned-spent')!.sort).toEqual([
      { column: 'sum_assigned', direction: 'desc' },
    ]);
    expect(resolveVisualization(byId.get('daily-calendar')!)).toBe('calendar');
  });
});
