import { describe, expect, it } from 'vitest';
import { normalizeQuestion, questionColumns } from '@features/reports/lib/question';
import {
  columnLabel,
  describeQuestion,
  filterSummary,
  formatBucketValue,
  formatDatePartValue,
  havingSummary,
} from './question-labels';

describe('question labels', () => {
  it('formats grouping values for people', () => {
    expect(formatBucketValue('month', '2025-12')).toBe('Dec 2025');
    expect(formatBucketValue('month', '2025-12', 'long')).toBe('December 2025');
    expect(formatBucketValue('quarter', '2026-Q1')).toBe('Q1 2026');
    expect(formatBucketValue('year', '2026')).toBe('2026');
    expect(formatBucketValue('day', '2026-01-05')).toBe('Jan 5, 2026');
    expect(formatBucketValue('week', '2026-01-05', 'long')).toBe('Week of Jan 5, 2026');
    expect(formatBucketValue('month', null)).toBe('—');
    expect(formatBucketValue('month', 'oops')).toBe('oops');
  });

  it('names output columns like a person would', () => {
    const spec = normalizeQuestion({
      source: 'transactions',
      aggregations: [{ op: 'spending' }, { op: 'sum', field: 'amount' }, { op: 'count' }],
      breakouts: [{ field: 'date', bucket: 'month' }, { field: 'category_group' }],
    });
    expect(questionColumns(spec).map((column) => columnLabel('transactions', column))).toEqual([
      'Month',
      'Category group',
      'Spending',
      'Sum of Amount',
      'Number of transactions',
    ]);
    const accounts = normalizeQuestion({
      source: 'accounts',
      aggregations: [{ op: 'count' }],
      breakouts: [{ field: 'last_transaction', bucket: 'year' }],
    });
    expect(questionColumns(accounts).map((column) => columnLabel('accounts', column))).toEqual([
      'Last transaction: Year',
      'Number of accounts',
    ]);
  });

  it('summarizes filters as chips', () => {
    const names = (value: string | number | boolean) =>
      ({ 1: 'Rent', 2: 'Fun', 3: 'Food' })[value as number] ?? String(value);
    expect(
      filterSummary('transactions', { field: 'category', op: 'is', values: [1, 2, 3, 4] }, names)
    ).toBe('Category is Rent, Fun and 2 more');
    expect(
      filterSummary('transactions', {
        field: 'date',
        op: 'previous',
        values: [],
        amount: 12,
        unit: 'month',
        includeCurrent: true,
      })
    ).toBe('Date: last 12 months');
    expect(
      filterSummary('transactions', {
        field: 'date',
        op: 'previous',
        values: [],
        amount: 1,
        unit: 'year',
        includeCurrent: false,
      })
    ).toBe('Date: previous 1 full year');
    expect(
      filterSummary('transactions', { field: 'date', op: 'current', values: [], unit: 'year' })
    ).toBe('Date: this year');
    expect(filterSummary('transactions', { field: 'is_transfer', op: 'is', values: [false] })).toBe(
      'Transfer: no'
    );
    expect(
      filterSummary('transactions', { field: 'amount', op: 'between', values: [-5, 10] })
    ).toBe('Amount between -5 and 10');
    expect(filterSummary('transactions', { field: 'memo', op: 'isEmpty', values: [] })).toBe(
      'Memo is empty'
    );
  });

  it('describes questions for default titles', () => {
    expect(describeQuestion(normalizeQuestion({ source: 'budget' }))).toBe('Budget');
    expect(
      describeQuestion(
        normalizeQuestion({
          source: 'transactions',
          aggregations: [{ op: 'income' }, { op: 'spending' }],
          breakouts: [{ field: 'date', bucket: 'month' }],
        })
      )
    ).toBe('Income and Spending by Month');
  });

  it('names date parts, ranges and last-year columns', () => {
    expect(formatDatePartValue('dayOfWeek', 1)).toBe('Mon');
    expect(formatDatePartValue('dayOfWeek', 7, 'long')).toBe('Sunday');
    expect(formatDatePartValue('monthOfYear', 3)).toBe('Mar');
    expect(formatDatePartValue('quarterOfYear', 2)).toBe('Q2');
    expect(formatDatePartValue('year', 2026)).toBe('2026');
    const spec = normalizeQuestion({
      source: 'transactions',
      aggregations: [{ op: 'spending', compare: true, compareTo: 'lastYear' }],
      breakouts: [{ field: 'date', bucket: 'month' }],
    });
    expect(questionColumns(spec).map((column) => columnLabel('transactions', column))).toEqual([
      'Month',
      'Spending',
      'Spending (last year)',
      'Spending: % change vs last year',
    ]);
    const parts = normalizeQuestion({
      source: 'transactions',
      aggregations: [{ op: 'count' }],
      breakouts: [
        { field: 'date', part: 'dayOfWeek' },
        { field: 'outflow', bin: 50 },
      ],
    });
    expect(questionColumns(parts).map((column) => columnLabel('transactions', column))).toEqual([
      'Day of week',
      'Outflow (range)',
      'Number of transactions',
    ]);
    expect(describeQuestion(parts)).toBe('Number of transactions by Day of week and Outflow');
  });

  it('summarizes part, bin and result filters', () => {
    expect(
      filterSummary('transactions', {
        field: 'date',
        op: 'is',
        values: [6, 7],
        part: 'dayOfWeek',
      })
    ).toBe('Date: Day of week is Saturday, Sunday');
    expect(
      filterSummary('transactions', {
        field: 'outflow',
        op: 'between',
        values: [100, 150],
        binWidth: 50,
      })
    ).toBe('Outflow: 100 to under 150');
    const spec = normalizeQuestion({
      source: 'transactions',
      aggregations: [{ op: 'spending' }],
      breakouts: [{ field: 'category' }],
      having: [{ column: 'spending', op: 'gt', values: [1500] }],
    });
    expect(havingSummary(spec, spec.having![0])).toBe('Spending > 1,500');
  });
});
