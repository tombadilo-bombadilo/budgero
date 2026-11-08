import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getUndoSpec } from '@shared/mutations/op-code-registry';

const mocks = vi.hoisted(() => ({
  reports: { getReport: vi.fn() },
  customDashboards: {
    getDashboard: vi.fn(),
    getDashboards: vi.fn(),
    getWidgetById: vi.fn(),
  },
}));

vi.mock('@shared/runtime/global', () => ({
  getRuntime: () => ({
    services: () => mocks,
    mutationsRouter: () => ({ execute: vi.fn() }),
  }),
}));

async function undoFor(op: string, args: Record<string, unknown>, result?: unknown) {
  const spec = getUndoSpec(op)!;
  return spec.build(args, result, await spec.capture?.(args));
}

const report = {
  id: 'r1',
  name: 'Food',
  description: 'Monthly food',
  query: 'SELECT 1',
  charts: [{ id: 'c1', type: 'bar' }],
  tags: ['food'],
  isFavorite: false,
};
const fields = {
  name: 'Food',
  description: 'Monthly food',
  query: 'SELECT 1',
  charts: [{ id: 'c1', type: 'bar' }],
  tags: ['food'],
  isFavorite: false,
};
const widget = {
  id: 'w1',
  dashboardId: 'd1',
  reportId: 'r1',
  chartId: 'c1',
  sortOrder: 2,
  desktopLayout: { colSpan: 6, rowSpan: 2 },
  mobileLayout: { size: 'm' },
};
const addWidget = {
  op: 'customDashboardWidgets.add',
  args: {
    id: 'w1',
    dashboardId: 'd1',
    reportId: 'r1',
    chartId: 'c1',
    desktopLayout: { colSpan: 6, rowSpan: 2 },
    mobileLayout: { size: 'm' },
    titleOverride: undefined,
  },
};

describe('report and dashboard undo', () => {
  beforeEach(() => {
    mocks.reports.getReport.mockReset().mockReturnValue(report);
    mocks.customDashboards.getWidgetById.mockReset().mockReturnValue(widget);
  });

  it('reports: create/duplicate delete, delete recreates under the same ID', async () => {
    expect(await undoFor('reports.create', { name: 'Food' }, report)).toEqual([
      { op: 'reports.delete', args: { id: 'r1' } },
    ]);
    expect(await undoFor('reports.duplicate', { id: 'r0' }, report)).toEqual([
      { op: 'reports.delete', args: { id: 'r1' } },
    ]);
    expect(await undoFor('reports.delete', { id: 'r1' })).toEqual([
      { op: 'reports.create', args: { id: 'r1', ...fields } },
    ]);
    expect(await undoFor('reports.update', { id: 'r1', name: 'Groceries' })).toEqual([
      { op: 'reports.update', args: { id: 'r1', ...fields } },
    ]);
  });

  it('reports: chart edits restore the previous chart list', async () => {
    for (const op of ['reports.addChart', 'reports.updateChart', 'reports.removeChart']) {
      expect(await undoFor(op, { reportId: 'r1', chartId: 'c1' })).toEqual([
        { op: 'reports.update', args: { id: 'r1', charts: report.charts } },
      ]);
    }
  });

  it('dashboards: delete recreates the dashboard and its widgets', async () => {
    mocks.customDashboards.getDashboard.mockReturnValue({
      id: 'd1',
      budgetId: 1,
      name: 'Main',
      sortOrder: 3,
      widgets: [widget],
    });
    expect(await undoFor('customDashboards.delete', { id: 'd1' })).toEqual([
      { op: 'customDashboards.create', args: { id: 'd1', budgetId: 1, name: 'Main' } },
      { op: 'customDashboards.update', args: { id: 'd1', sortOrder: 3 } },
      addWidget,
    ]);
  });

  it('dashboards: filter changes undo to the previous filters; renames leave them', async () => {
    const filters = { date: { preset: 'lastYear' } };
    mocks.customDashboards.getDashboard.mockReturnValue({
      id: 'd1',
      budgetId: 1,
      name: 'Main',
      sortOrder: 3,
      filters,
      widgets: [],
    });
    expect(await undoFor('customDashboards.update', { id: 'd1', filters: null })).toEqual([
      { op: 'customDashboards.update', args: { id: 'd1', name: 'Main', sortOrder: 3, filters } },
    ]);
    expect(await undoFor('customDashboards.update', { id: 'd1', name: 'New' })).toEqual([
      { op: 'customDashboards.update', args: { id: 'd1', name: 'Main', sortOrder: 3 } },
    ]);
    expect(await undoFor('customDashboards.delete', { id: 'd1' })).toEqual([
      { op: 'customDashboards.create', args: { id: 'd1', budgetId: 1, name: 'Main' } },
      { op: 'customDashboards.update', args: { id: 'd1', sortOrder: 3, filters } },
    ]);
  });

  it('widgets: add removes the new widget, delete restores it in place', async () => {
    mocks.customDashboards.getDashboard.mockReturnValue({ widgets: [{ id: 'w0' }] });
    expect(
      await undoFor(
        'customDashboardWidgets.add',
        { dashboardId: 'd1' },
        {
          widgets: [{ id: 'w0' }, { id: 'w9' }],
        }
      )
    ).toEqual([{ op: 'customDashboardWidgets.delete', args: { id: 'w9' } }]);

    expect(await undoFor('customDashboardWidgets.delete', { id: 'w1' })).toEqual([
      addWidget,
      { op: 'customDashboardWidgets.update', args: { id: 'w1', sortOrder: 2 } },
    ]);
  });
});
