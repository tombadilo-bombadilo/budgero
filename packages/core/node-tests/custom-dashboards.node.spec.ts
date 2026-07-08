import { describe, expect, it } from 'vitest';
import { DatabaseAdapter, NodeSqlJsAdapter, ServiceManager } from '../src';

describe('CustomDashboardService', () => {
  it('supports dashboard and widget CRUD + reorder + cascade behavior', async () => {
    const adapter = await NodeSqlJsAdapter.create();
    const sm = new ServiceManager();
    await sm.initialize(adapter as DatabaseAdapter);
    const services = sm.getServices();

    const budgetId = await services.budgets.createBudget({
      name: 'Main Budget',
      display_currency: 'USD',
      badge_icon: 'wallet',
      number_format: 'en-US',
      create_default_categories: false,
    });
    const secondBudgetId = await services.budgets.createBudget({
      name: 'Second Budget',
      display_currency: 'USD',
      badge_icon: 'wallet',
      number_format: 'en-US',
      create_default_categories: false,
    });

    const first = await services.customDashboards.createDashboard({
      budgetId,
      name: 'My Dashboard',
    });
    const second = await services.customDashboards.createDashboard({
      budgetId,
      name: 'Secondary',
    });

    expect(() =>
      services.customDashboards.createDashboard({
        budgetId,
        name: 'my dashboard',
      })
    ).toThrow(/already exists/i);

    const sameNameDifferentBudget = await services.customDashboards.createDashboard({
      budgetId: secondBudgetId,
      name: 'My Dashboard',
    });
    expect(sameNameDifferentBudget.budgetId).toBe(secondBudgetId);

    const list = await services.customDashboards.getDashboards(budgetId);
    expect(list.map((item) => item.id)).toEqual([first.id, second.id]);

    const withWidget = await services.customDashboards.addWidget({
      dashboardId: first.id,
      reportId: 'missing-report-id',
      chartId: 'missing-chart-id',
      desktopLayout: { colSpan: 8, rowSpan: 4 },
      mobileLayout: { size: 'l' },
    });
    expect(withWidget.widgets).toHaveLength(1);
    expect(withWidget.widgets[0].reportId).toBe('missing-report-id');

    const updatedWidget = await services.customDashboards.updateWidget({
      id: withWidget.widgets[0].id,
      titleOverride: 'Pinned Widget',
      desktopLayout: { colSpan: 3, rowSpan: 2 },
    });
    expect(updatedWidget.titleOverride).toBe('Pinned Widget');
    expect(updatedWidget.desktopLayout.colSpan).toBe(3);

    await services.customDashboards.reorderDashboards({
      budgetId,
      orderedIds: [second.id, first.id],
    });
    const reorderedDashboards = await services.customDashboards.getDashboards(budgetId);
    expect(reorderedDashboards.map((item) => item.id)).toEqual([second.id, first.id]);

    const afterAddMore = await services.customDashboards.addWidget({
      dashboardId: first.id,
      reportId: 'another-report-id',
      chartId: 'another-chart-id',
    });
    expect(afterAddMore.widgets).toHaveLength(2);
    await services.customDashboards.reorderWidgets({
      dashboardId: first.id,
      orderedIds: [afterAddMore.widgets[1].id, afterAddMore.widgets[0].id],
    });
    const reorderedDashboard = await services.customDashboards.getDashboard(first.id);
    expect(reorderedDashboard?.widgets.map((item) => item.id)).toEqual([
      afterAddMore.widgets[1].id,
      afterAddMore.widgets[0].id,
    ]);

    await services.customDashboards.deleteDashboard(first.id);
    expect(await services.customDashboards.getDashboard(first.id)).toBeNull();

    const widgetCountStmt = adapter.prepare(
      'SELECT COUNT(*) as count FROM custom_dashboard_widgets WHERE DashboardID = ?'
    );
    const widgetCount = widgetCountStmt.get(first.id) as { count: number };
    widgetCountStmt.finalize();
    expect(widgetCount.count).toBe(0);
  });
});
