import { t } from '@lingui/core/macro';
import { createQuestion, type QuestionSpec } from '@features/reports/lib/question';

export interface QuestionExample {
  id: string;
  /** Name the new question starts with. */
  name: string;
  /** One line on what it shows (and which trick it uses). */
  hint: string;
  spec: QuestionSpec;
}

const lastMonths = (amount: number, includeCurrent = true) => ({
  field: 'date',
  op: 'previous' as const,
  values: [],
  amount,
  unit: 'month' as const,
  includeCurrent,
});

/**
 * Ready questions for the Reports home ("Start from an example"): each opens
 * the notebook prefilled and unsaved. Resolved at call time so the active
 * locale applies to names.
 */
export function questionExamples(): QuestionExample[] {
  const transactions = (overrides: Parameters<typeof createQuestion>[1]) => {
    const base = createQuestion('transactions');
    return createQuestion('transactions', {
      ...overrides,
      filters: [...base.filters, ...(overrides?.filters ?? [])],
    });
  };
  return [
    {
      id: 'category-month',
      name: t`Spending by category per month`,
      hint: t`Stacked bars: each month's total, split by category`,
      spec: transactions({
        filters: [lastMonths(6)],
        aggregations: [{ op: 'spending' }],
        breakouts: [{ field: 'date', bucket: 'month' }, { field: 'category' }],
      }),
    },
    {
      id: 'income-spending',
      name: t`Income vs spending per month`,
      hint: t`Side by side bars for the last 12 months`,
      spec: transactions({
        filters: [lastMonths(12)],
        aggregations: [{ op: 'income' }, { op: 'spending' }],
        breakouts: [{ field: 'date', bucket: 'month' }],
        visualization: 'bar',
        stacking: 'none',
      }),
    },
    {
      id: 'vs-last-year',
      name: t`Each month vs the same month last year`,
      hint: t`Spending next to the same month a year earlier, with the % change`,
      spec: transactions({
        filters: [lastMonths(12)],
        aggregations: [{ op: 'spending', compare: true, compareTo: 'lastYear' }],
        breakouts: [{ field: 'date', bucket: 'month' }],
        visualization: 'bar',
        stacking: 'none',
      }),
    },
    {
      id: 'top-payees',
      name: t`Top 10 payees this year`,
      hint: t`Where the most money went since January`,
      spec: transactions({
        filters: [{ field: 'date', op: 'current', unit: 'year', values: [] }],
        aggregations: [{ op: 'spending' }],
        breakouts: [{ field: 'payee' }],
        sort: [{ column: 'spending', direction: 'desc' }],
        limit: 10,
        visualization: 'row',
      }),
    },
    {
      id: 'weekday',
      name: t`Spending by day of the week`,
      hint: t`Which weekdays cost the most, over the last 12 months`,
      spec: transactions({
        filters: [lastMonths(12)],
        aggregations: [{ op: 'spending' }],
        breakouts: [{ field: 'date', part: 'dayOfWeek' }],
      }),
    },
    {
      id: 'savings-rate',
      name: t`Savings rate over time`,
      hint: t`(Income − spending) ÷ income, month by month`,
      spec: transactions({
        filters: [lastMonths(12)],
        aggregations: [
          {
            op: 'custom',
            name: t`Savings rate (%)`,
            expression: '(Income - Spending) / Income * 100',
          },
        ],
        breakouts: [{ field: 'date', bucket: 'month' }],
        visualization: 'line',
      }),
    },
    {
      id: 'amount-ranges',
      name: t`Biggest transactions, by amount range`,
      hint: t`How many payments fall in each range of size`,
      spec: transactions({
        filters: [lastMonths(12), { field: 'outflow', op: 'gt', values: [0] }],
        aggregations: [{ op: 'count' }],
        breakouts: [{ field: 'outflow', bin: 'auto' }],
      }),
    },
    {
      id: 'group-share',
      name: t`Category group shares per month`,
      hint: t`100% stacked: how the mix of spending changes`,
      spec: transactions({
        filters: [lastMonths(12)],
        aggregations: [{ op: 'spending' }],
        breakouts: [{ field: 'date', bucket: 'month' }, { field: 'category_group' }],
        visualization: 'bar',
        stacking: 'percent',
      }),
    },
    {
      id: 'assigned-spent',
      name: t`Assigned vs spent per category this month`,
      hint: t`Your plan next to what really happened, from the budget`,
      spec: createQuestion('budget', {
        filters: [{ field: 'month', op: 'current', unit: 'month', values: [] }],
        aggregations: [
          { op: 'sum', field: 'assigned' },
          { op: 'custom', name: t`Spent`, expression: '-Sum([activity])' },
        ],
        breakouts: [{ field: 'category' }],
        sort: [{ column: 'sum_assigned', direction: 'desc' }],
        visualization: 'bar',
        stacking: 'none',
      }),
    },
    {
      id: 'daily-calendar',
      name: t`Daily spending calendar`,
      hint: t`A heatmap of every day in the last 3 months`,
      spec: transactions({
        filters: [lastMonths(3)],
        aggregations: [{ op: 'spending' }],
        breakouts: [{ field: 'date', bucket: 'day' }],
        visualization: 'calendar',
      }),
    },
  ];
}
