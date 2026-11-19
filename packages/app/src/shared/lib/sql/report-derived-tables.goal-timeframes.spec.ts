import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
// The real services need the Node database adapter; production uses the browser entry.
// eslint-disable-next-line no-restricted-imports
import { asMilli, GoalType, NodeSqlJsAdapter, ServiceManager } from '@budgero/core';
import { buildBudgetMonthRows } from './report-derived-tables';

describe('budget_months goal columns', () => {
  it('each month carries the goal of that month', async () => {
    const cwd = vi.spyOn(process, 'cwd').mockReturnValue(resolve(process.cwd(), '../core'));
    const db = await NodeSqlJsAdapter.create();
    const manager = new ServiceManager();
    try {
      await manager.initialize(db);
    } finally {
      cwd.mockRestore();
    }
    const services = manager.getServices();
    const budgetId = await services.budgets.createBudget({
      name: 'Reports',
      display_currency: 'USD',
      badge_icon: 'dollar',
      number_format: '123,456.78',
      create_default_categories: false,
    });
    const group = services.categories.addCategoryGroup('Everyday', budgetId);
    const groceries = services.categories.addCategory(group, budgetId, 'Groceries', '');
    services.monthlyBudgets.upsertMonthlyAssignment(groceries, asMilli(1_000), '2026-01', budgetId);
    services.goals.createGoal(GoalType.MONTHLY, groceries, asMilli(200_000), '2026-01-01', '');
    services.goals.setGoalFrom(groceries, '2026-03', '2026-03', {
      type: GoalType.MONTHLY,
      target: asMilli(250_000),
      startDate: '2026-03-01',
      targetDate: '',
    });

    const rows = buildBudgetMonthRows({ services, db, today: '2026-05-10' }, budgetId);
    const goalTarget = (month: string) =>
      rows.find((row) => row.month === `${month}-01` && row.category_id === groceries)?.goal_target;
    expect(['2026-01', '2026-02', '2026-03', '2026-04'].map(goalTarget)).toEqual([
      200,
      200,
      250,
      null,
    ]);
  });
});
