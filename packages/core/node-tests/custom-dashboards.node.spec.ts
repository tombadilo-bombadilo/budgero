import { describe, expect, it } from 'vitest';
import initSqlJs from 'sql.js';
import path from 'node:path';
import { DatabaseAdapter, NodeSqlJsAdapter, ServiceManager } from '../src';
import { migrations } from '../src/database/migrations.js';
import { createMigrationDatabase } from '../src/database/migration-database-factory.js';
import {
  HOME_ALIAS_ORIGIN,
  HOME_DEFAULT_ORIGIN,
  seededWidgetId,
} from '../src/services/custom-dashboards';

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

  it('stores, clears and rejects dashboard filters', async () => {
    const adapter = await NodeSqlJsAdapter.create();
    const sm = new ServiceManager();
    await sm.initialize(adapter as DatabaseAdapter);
    const services = sm.getServices();
    const budgetId = await services.budgets.createBudget({
      name: 'Filters Budget',
      display_currency: 'USD',
      badge_icon: 'wallet',
      number_format: 'en-US',
      create_default_categories: false,
    });
    const dashboard = await services.customDashboards.createDashboard({ budgetId, name: 'F' });
    expect(dashboard.filters).toBeNull();

    const filters = { date: { preset: 'lastYear' }, accounts: [3, 4] };
    const updated = await services.customDashboards.updateDashboard({ id: dashboard.id, filters });
    expect(updated.filters).toEqual(filters);
    // Renaming leaves the filters alone.
    const renamed = await services.customDashboards.updateDashboard({
      id: dashboard.id,
      name: 'Renamed',
    });
    expect(renamed.filters).toEqual(filters);
    expect(services.customDashboards.getDashboards(budgetId)[0].filters).toEqual(filters);

    const cleared = await services.customDashboards.updateDashboard({
      id: dashboard.id,
      filters: null,
    });
    expect(cleared.filters).toBeNull();
    // An empty object stores as "no filters".
    expect(
      (await services.customDashboards.updateDashboard({ id: dashboard.id, filters: {} })).filters
    ).toBeNull();

    expect(() =>
      services.customDashboards.updateDashboard({
        id: dashboard.id,
        filters: [] as unknown as Record<string, unknown>,
      })
    ).toThrow(/object/);
    expect(() =>
      services.customDashboards.updateDashboard({
        id: dashboard.id,
        filters: { big: 'x'.repeat(20_000) },
      })
    ).toThrow(/too large/);
  });

  async function setup() {
    const adapter = await NodeSqlJsAdapter.create();
    const sm = new ServiceManager();
    await sm.initialize(adapter as DatabaseAdapter);
    const services = sm.getServices();
    const budget = (name: string) =>
      services.budgets.createBudget({
        name,
        display_currency: 'USD',
        badge_icon: 'wallet',
        number_format: 'en-US',
        create_default_categories: false,
      });
    return { adapter, services, budget };
  }

  it('keeps at most one home dashboard per budget', async () => {
    const { services, budget } = await setup();
    const budgetId = await budget('Home Budget');
    const otherBudgetId = await budget('Other Budget');
    const dashboards = services.customDashboards;

    expect(dashboards.getHomeDashboardId(budgetId)).toBeNull();
    const seeded = dashboards.createDashboard({
      budgetId,
      name: 'Home',
      origin: HOME_DEFAULT_ORIGIN,
    });
    expect(seeded.origin).toBe(HOME_DEFAULT_ORIGIN);
    expect(seeded.isHome).toBe(false);
    const custom = dashboards.createDashboard({ budgetId, name: 'Custom' });
    expect(custom.origin).toBeNull();
    const elsewhere = dashboards.createDashboard({ budgetId: otherBudgetId, name: 'Elsewhere' });

    dashboards.updateDashboard({ id: elsewhere.id, isHome: true });
    expect(dashboards.updateDashboard({ id: seeded.id, isHome: true }).isHome).toBe(true);
    expect(dashboards.getHomeDashboardId(budgetId)).toBe(seeded.id);

    // Taking the home clears the previous one, in this budget only.
    dashboards.updateDashboard({ id: custom.id, isHome: true });
    expect(dashboards.getHomeDashboardId(budgetId)).toBe(custom.id);
    expect(dashboards.getDashboard(seeded.id)?.isHome).toBe(false);
    expect(dashboards.getHomeDashboardId(otherBudgetId)).toBe(elsewhere.id);

    // A rename leaves the home alone; false unsets it.
    dashboards.updateDashboard({ id: custom.id, name: 'Renamed' });
    expect(dashboards.getHomeDashboardId(budgetId)).toBe(custom.id);
    dashboards.updateDashboard({ id: custom.id, isHome: false });
    expect(dashboards.getHomeDashboardId(budgetId)).toBeNull();

    // Deleting the home dashboard falls back to the default home.
    dashboards.updateDashboard({ id: seeded.id, isHome: true });
    dashboards.deleteDashboard(seeded.id);
    expect(dashboards.getHomeDashboardId(budgetId)).toBeNull();
  });

  it('stores per-platform visibility and phone order, and keeps them on older-style patches', async () => {
    const { services, budget } = await setup();
    const budgetId = await budget('Layout Budget');
    const dashboards = services.customDashboards;
    const dashboard = dashboards.createDashboard({ budgetId, name: 'L' });
    const added = dashboards.addWidget({
      dashboardId: dashboard.id,
      reportId: 'builtin:spending_tabs',
      chartId: 'builtin',
      desktopLayout: { colSpan: 12, rowSpan: 3, hidden: true },
      mobileLayout: { size: 'm', order: 3 },
      titleOverride: 'Spending Analysis',
    });
    const widget = added.widgets[0];
    expect(widget.desktopLayout).toEqual({ colSpan: 12, rowSpan: 3, hidden: true });
    expect(widget.mobileLayout).toEqual({ size: 'm', order: 3 });

    // A v1.20 build sends only colSpan/rowSpan or size: the rest is kept.
    const resized = dashboards.updateWidget({
      id: widget.id,
      desktopLayout: { colSpan: 8, rowSpan: 4 },
      mobileLayout: { size: 'l' },
    });
    expect(resized.desktopLayout).toEqual({ colSpan: 8, rowSpan: 4, hidden: true });
    expect(resized.mobileLayout).toEqual({ size: 'l', order: 3 });

    // Explicit values change or clear them.
    const shown = dashboards.updateWidget({
      id: widget.id,
      desktopLayout: { colSpan: 8, rowSpan: 4, hidden: false },
      mobileLayout: { size: 'l', order: null, hidden: true },
    });
    expect(shown.desktopLayout).toEqual({ colSpan: 8, rowSpan: 4 });
    expect(shown.mobileLayout).toEqual({ size: 'l', hidden: true });
  });

  it('loads widgets and dashboards stored in the old shape', async () => {
    const { adapter, services, budget } = await setup();
    const budgetId = await budget('Old Budget');
    const dashboard = services.customDashboards.createDashboard({ budgetId, name: 'Old' });
    const now = new Date().toISOString();
    adapter
      .prepare(
        `INSERT INTO custom_dashboard_widgets
         (ID, DashboardID, ReportID, ChartID, SortOrder, DesktopLayout, MobileLayout, TitleOverride, CreatedAt, UpdatedAt)
       VALUES (?, ?, ?, ?, 0, ?, ?, NULL, ?, ?)`
      )
      .run(
        'w-old',
        dashboard.id,
        'r1',
        'c1',
        '{"colSpan":6,"rowSpan":3}',
        '{"size":"s"}',
        now,
        now
      );
    const loaded = services.customDashboards.getDashboard(dashboard.id);
    expect(loaded?.isHome).toBe(false);
    expect(loaded?.origin).toBeNull();
    expect(loaded?.widgets[0].desktopLayout).toEqual({ colSpan: 6, rowSpan: 3 });
    expect(loaded?.widgets[0].mobileLayout).toEqual({ size: 's' });
  });

  it('migration 77 adds the home columns and keeps existing dashboards', async () => {
    const SQL = await initSqlJs({
      locateFile: (file: string) =>
        path.join(process.cwd(), 'node_modules', 'sql.js', 'dist', file),
    });
    const db = createMigrationDatabase(new SQL.Database());
    for (const m of migrations.filter((x) => x.version <= 76)) {
      try {
        if (typeof m.up === 'function') m.up(db);
        else db.exec(m.up);
      } catch (error) {
        if (!(error instanceof Error && error.message.includes('duplicate column'))) throw error;
      }
    }
    db.exec(`
      PRAGMA foreign_keys = OFF;
      INSERT INTO custom_dashboards (ID, BudgetID, Name, SortOrder, CreatedAt, UpdatedAt)
      VALUES ('d1', 1, 'Old', 0, 'x', 'x');
    `);
    const m077 = migrations.find((m) => m.version === 77)!;
    (m077.up as (d: typeof db) => void)(db);
    expect(m077.verify!(db)).toBe(true);
    expect(db.exec(`SELECT ID, IsHome, Origin FROM custom_dashboards`)[0]?.values).toEqual([
      ['d1', 0, null],
    ]);
    // Already applied: running it again is harmless.
    (m077.up as (d: typeof db) => void)(db);
  });

  it('a second copy of the default home is hidden and its changes go to the first', async () => {
    const { services, budget } = await setup();
    const budgetId = await budget('Alias Budget');
    const dashboards = services.customDashboards;
    const first = dashboards.createDashboard({
      budgetId,
      name: 'Home ·aaaa',
      origin: HOME_DEFAULT_ORIGIN,
    });
    for (const key of ['cash_balance', 'overspent']) {
      dashboards.addWidget({
        id: seededWidgetId(first.id, key),
        dashboardId: first.id,
        reportId: `builtin:${key}`,
        chartId: 'builtin',
      });
    }
    const second = dashboards.createDashboard({
      budgetId,
      name: 'Home ·bbbb',
      origin: HOME_DEFAULT_ORIGIN,
    });
    expect(second.origin).toBe(HOME_ALIAS_ORIGIN);
    expect(dashboards.getDashboards(budgetId).map((d) => d.id)).toEqual([first.id]);
    for (const key of ['cash_balance', 'overspent']) {
      dashboards.addWidget({
        id: seededWidgetId(second.id, key),
        dashboardId: second.id,
        reportId: `builtin:${key}`,
        chartId: 'builtin',
      });
    }
    // Seeded cards stay on the hidden copy; anything else lands on the first.
    dashboards.addWidget({ id: 'q', dashboardId: second.id, reportId: 'r', chartId: 'c' });
    expect(dashboards.getDashboard(first.id)?.widgets.map((w) => w.id)).toEqual([
      seededWidgetId(first.id, 'cash_balance'),
      seededWidgetId(first.id, 'overspent'),
      'q',
    ]);
    // Edits to the hidden copy's cards apply to the paired cards.
    dashboards.updateWidget({
      id: seededWidgetId(second.id, 'overspent'),
      desktopLayout: { colSpan: 12, rowSpan: 3 },
    });
    expect(dashboards.getWidgetById(seededWidgetId(first.id, 'overspent'))?.desktopLayout).toEqual({
      colSpan: 12,
      rowSpan: 3,
    });
    dashboards.deleteWidget(seededWidgetId(second.id, 'cash_balance'));
    expect(dashboards.getWidgetById(seededWidgetId(first.id, 'cash_balance'))).toBeNull();
    dashboards.reorderWidgets({
      dashboardId: second.id,
      orderedIds: ['q', seededWidgetId(second.id, 'overspent')],
    });
    expect(dashboards.getDashboard(first.id)?.widgets.map((w) => w.id)).toEqual([
      'q',
      seededWidgetId(first.id, 'overspent'),
    ]);
    // Title and position follow too.
    dashboards.updateWidget({
      id: seededWidgetId(second.id, 'overspent'),
      titleOverride: 'Over budget',
      sortOrder: 7,
    });
    expect(dashboards.getWidgetById(seededWidgetId(first.id, 'overspent'))).toMatchObject({
      titleOverride: 'Over budget',
      sortOrder: 7,
    });
    // A seeded card added back later (undo of its removal) returns on the
    // first copy too; one added as part of the first seeding does not.
    dashboards.addWidget({
      id: seededWidgetId(second.id, 'cash_balance'),
      dashboardId: second.id,
      reportId: 'builtin:cash_balance',
      chartId: 'builtin',
    });
    expect(dashboards.getWidgetById(seededWidgetId(first.id, 'cash_balance'))).not.toBeNull();
    dashboards.deleteWidget(seededWidgetId(second.id, 'cash_balance'));
    dashboards.addWidget({
      id: seededWidgetId(second.id, 'cash_balance'),
      dashboardId: second.id,
      reportId: 'builtin:cash_balance',
      chartId: 'builtin',
      seed: true,
    });
    expect(dashboards.getWidgetById(seededWidgetId(first.id, 'cash_balance'))).toBeNull();
    // Home goes to the first; deleting either copy removes both.
    dashboards.updateDashboard({ id: second.id, isHome: true });
    expect(dashboards.getHomeDashboardId(budgetId)).toBe(first.id);
    dashboards.deleteDashboard(second.id);
    expect(dashboards.getDashboard(first.id)).toBeNull();
    expect(dashboards.getDashboard(second.id)).toBeNull();
  });
});
