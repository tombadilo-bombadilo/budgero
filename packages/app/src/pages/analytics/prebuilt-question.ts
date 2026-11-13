import { t } from '@lingui/core/macro';
import {
  createQuestion,
  type QuestionFilter,
  type QuestionSource,
  type QuestionSpec,
} from '@features/reports/lib/question';
import type { AnalyticsSelections, ReportKey } from './analytics-state';

/** The prebuilt report's period as a (rolling) date filter, or null for all time. */
function periodFilter(field: string, selections: AnalyticsSelections): QuestionFilter | null {
  const months = (amount: number): QuestionFilter => ({
    field,
    op: 'previous',
    values: [],
    amount,
    unit: 'month',
    includeCurrent: true,
  });
  switch (selections.period) {
    case 'mtd':
      return { field, op: 'current', values: [], unit: 'month' };
    case '3m':
      return months(3);
    case '6m':
      return months(6);
    case '12m':
      return months(12);
    case '24m':
      return months(24);
    case 'ytd':
      return { field, op: 'current', values: [], unit: 'year' };
    case 'all':
      return null;
    case 'custom': {
      const { customStart: start, customEnd: end } = selections;
      if (start && end) return { field, op: 'between', values: [start, end] };
      if (start) return { field, op: 'after', values: [start] };
      if (end) return { field, op: 'before', values: [end] };
      return null;
    }
  }
}

/** Account / category / payee / label picks as question filters (transactions only). */
function selectionFilters(selections: AnalyticsSelections, categories: boolean): QuestionFilter[] {
  const filters: QuestionFilter[] = [];
  if (selections.accountIds.length > 0) {
    filters.push({ field: 'account', op: 'is', values: selections.accountIds });
  }
  if (!categories) return filters;
  if (selections.categoryIds.length > 0) {
    filters.push({ field: 'category', op: 'is', values: selections.categoryIds });
  }
  if (selections.payees.length > 0) {
    filters.push({ field: 'payee', op: 'is', values: selections.payees });
  }
  if (selections.labelIds.length > 0) {
    filters.push({ field: 'label', op: 'is', values: selections.labelIds });
  }
  return filters;
}

export interface PrebuiltQuestion {
  name: string;
  spec: QuestionSpec;
}

/**
 * A prebuilt report as an editable notebook question with the report's
 * current filters, or null when the report can't be written as one (net
 * worth needs balances from before the period; scenarios are projections).
 */
export function prebuiltQuestion(
  report: ReportKey,
  selections: AnalyticsSelections
): PrebuiltQuestion | null {
  const build = (
    source: QuestionSource,
    overrides: Parameters<typeof createQuestion>[1] & { filters?: QuestionFilter[] }
  ) => {
    const base = createQuestion(source);
    return createQuestion(source, {
      ...overrides,
      filters: [...base.filters, ...(overrides.filters ?? [])],
    });
  };
  const dateFilter = periodFilter('date', selections);
  const transactionFilters = (categories: boolean) => [
    ...(dateFilter ? [dateFilter] : []),
    ...selectionFilters(selections, categories),
  ];

  switch (report) {
    case 'spending':
      return {
        name: t`Spending by category`,
        spec: build('transactions', {
          filters: transactionFilters(true),
          aggregations: [{ op: 'spending' }],
          breakouts: [{ field: 'category' }],
          sort: [{ column: 'spending', direction: 'desc' }],
        }),
      };
    case 'in-out':
      return {
        name: t`Income vs spending per month`,
        spec: build('transactions', {
          filters: transactionFilters(true),
          aggregations: [{ op: 'income' }, { op: 'spending' }],
          breakouts: [{ field: 'date', bucket: 'month' }],
          visualization: 'bar',
          stacking: 'none',
        }),
      };
    case 'money-map':
      return {
        name: t`Spending by category group and category`,
        spec: build('transactions', {
          filters: transactionFilters(true),
          aggregations: [{ op: 'spending' }],
          breakouts: [{ field: 'category_group' }, { field: 'category' }],
          visualization: 'sankey',
        }),
      };
    case 'ledger':
      return {
        name: t`Spending per category and month`,
        spec: build('transactions', {
          filters: transactionFilters(true),
          aggregations: [{ op: 'spending' }],
          breakouts: [{ field: 'category' }, { field: 'date', bucket: 'month' }],
          visualization: 'pivot',
        }),
      };
    case 'plan': {
      const month = periodFilter('month', selections);
      return {
        name: t`Assigned vs spent per month`,
        spec: build('budget', {
          filters: month ? [month] : [],
          aggregations: [
            { op: 'sum', field: 'assigned' },
            { op: 'custom', name: t`Spent`, expression: '-Sum([activity])' },
          ],
          breakouts: [{ field: 'month', bucket: 'month' }],
          visualization: 'bar',
          stacking: 'none',
        }),
      };
    }
    case 'wealth':
    case 'scenario':
      return null;
  }
}
