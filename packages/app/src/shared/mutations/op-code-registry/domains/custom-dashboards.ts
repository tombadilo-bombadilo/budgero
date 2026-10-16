import type {
  CustomDashboard,
  CustomDashboardWidget,
  CustomDashboardWithWidgets,
} from '@budgero/core/browser';
import {
  S,
  redoWithIds,
  safeCapture,
  withGeneratedId,
  type OpCall,
  type OpCodeEntry,
} from '../shared';

function addWidgetOp(widget: CustomDashboardWidget): OpCall {
  return {
    op: 'customDashboardWidgets.add',
    args: {
      id: widget.id,
      dashboardId: widget.dashboardId,
      reportId: widget.reportId,
      chartId: widget.chartId,
      desktopLayout: widget.desktopLayout,
      mobileLayout: widget.mobileLayout,
      titleOverride: widget.titleOverride,
    },
  };
}

/** The widget an add created: the one missing from the captured list of IDs. */
function addedWidgetId(result: unknown, before: unknown): string | undefined {
  const existing = new Set((before as string[] | null) ?? []);
  return (result as CustomDashboardWithWidgets | undefined)?.widgets.find(
    (widget) => !existing.has(widget.id)
  )?.id;
}

const captureWidget = (args: Record<string, unknown>) =>
  safeCapture(() => S().customDashboards!.getWidgetById(args.id as string));

export const customDashboardOps = {
  'customDashboards.create': {
    prepare: withGeneratedId(),
    execute: async (args) => {
      return await S().customDashboards!.createDashboard({
        id: args.id as string | undefined,
        budgetId: args.budgetId as number,
        name: args.name as string,
      });
    },
    invalidates: [['customDashboards', '*']],
    undo: {
      build: (_args, result) => {
        const id = (result as CustomDashboard | undefined)?.id;
        return id ? [{ op: 'customDashboards.delete', args: { id } }] : [];
      },
    },
    redo: redoWithIds('customDashboards.create', (args, result) => {
      const id = (result as CustomDashboard | undefined)?.id;
      return id ? { ...args, id } : null;
    }),
  },

  'customDashboards.update': {
    execute: async (args) => {
      return await S().customDashboards!.updateDashboard({
        id: args.id as string,
        name: args.name as string | undefined,
        sortOrder: args.sortOrder as number | undefined,
      });
    },
    invalidates: [
      ['customDashboards', '*'],
      ['customDashboard', '*'],
    ],
    undo: {
      capture: async (args) =>
        safeCapture(() => S().customDashboards!.getDashboard(args.id as string)),
      build: (args, _result, before) => {
        const dashboard = before as CustomDashboard | null;
        return dashboard
          ? [
              {
                op: 'customDashboards.update',
                args: { id: args.id, name: dashboard.name, sortOrder: dashboard.sortOrder },
              },
            ]
          : [];
      },
    },
  },

  'customDashboards.delete': {
    execute: async (args) => {
      await S().customDashboards!.deleteDashboard(args.id as string);
    },
    invalidates: [
      ['customDashboards', '*'],
      ['customDashboard', '*'],
    ],
    // Recreate the dashboard and its widgets under their original IDs.
    undo: {
      capture: async (args) =>
        safeCapture(() => S().customDashboards!.getDashboard(args.id as string)),
      build: (_args, _result, before) => {
        const dashboard = before as CustomDashboardWithWidgets | null;
        if (!dashboard) return [];
        return [
          {
            op: 'customDashboards.create',
            args: { id: dashboard.id, budgetId: dashboard.budgetId, name: dashboard.name },
          },
          {
            op: 'customDashboards.update',
            args: { id: dashboard.id, sortOrder: dashboard.sortOrder },
          },
          ...dashboard.widgets.map(addWidgetOp),
        ];
      },
    },
  },

  'customDashboards.reorder': {
    execute: async (args) => {
      await S().customDashboards!.reorderDashboards({
        budgetId: args.budgetId as number,
        orderedIds: args.orderedIds as string[],
      });
    },
    invalidates: [['customDashboards', '*']],
    undo: {
      capture: async (args) =>
        safeCapture(() =>
          S()
            .customDashboards!.getDashboards(args.budgetId as number)
            .map((dashboard) => dashboard.id)
        ),
      build: (args, _result, before) => {
        const orderedIds = before as string[] | null;
        return orderedIds?.length
          ? [{ op: 'customDashboards.reorder', args: { budgetId: args.budgetId, orderedIds } }]
          : [];
      },
    },
  },

  'customDashboardWidgets.add': {
    prepare: withGeneratedId(),
    execute: async (args) => {
      return await S().customDashboards!.addWidget({
        id: args.id as string | undefined,
        dashboardId: args.dashboardId as string,
        reportId: args.reportId as string,
        chartId: args.chartId as string,
        desktopLayout: args.desktopLayout as { colSpan: number; rowSpan: number } | undefined,
        mobileLayout: args.mobileLayout as { size: 's' | 'm' | 'l' } | undefined,
        titleOverride: args.titleOverride as string | undefined,
      });
    },
    invalidates: [
      ['customDashboard', '*'],
      ['customDashboards', '*'],
    ],
    undo: {
      capture: async (args) =>
        safeCapture(() =>
          (S().customDashboards!.getDashboard(args.dashboardId as string)?.widgets ?? []).map(
            (widget) => widget.id
          )
        ),
      build: (_args, result, before) => {
        const id = addedWidgetId(result, before);
        return id ? [{ op: 'customDashboardWidgets.delete', args: { id } }] : [];
      },
    },
    redo: redoWithIds('customDashboardWidgets.add', (args, result, before) => {
      const id = addedWidgetId(result, before);
      return id ? { ...args, id } : null;
    }),
  },

  'customDashboardWidgets.update': {
    execute: async (args) => {
      return await S().customDashboards!.updateWidget({
        id: args.id as string,
        reportId: args.reportId as string | undefined,
        chartId: args.chartId as string | undefined,
        desktopLayout: args.desktopLayout as { colSpan: number; rowSpan: number } | undefined,
        mobileLayout: args.mobileLayout as { size: 's' | 'm' | 'l' } | undefined,
        sortOrder: args.sortOrder as number | undefined,
        titleOverride: args.titleOverride as string | null | undefined,
      });
    },
    invalidates: [
      ['customDashboard', '*'],
      ['customDashboards', '*'],
    ],
    undo: {
      capture: captureWidget,
      build: (_args, _result, before) => {
        const widget = before as CustomDashboardWidget | null;
        return widget
          ? [
              {
                op: 'customDashboardWidgets.update',
                args: {
                  id: widget.id,
                  reportId: widget.reportId,
                  chartId: widget.chartId,
                  desktopLayout: widget.desktopLayout,
                  mobileLayout: widget.mobileLayout,
                  sortOrder: widget.sortOrder,
                  titleOverride: widget.titleOverride ?? null,
                },
              },
            ]
          : [];
      },
    },
  },

  'customDashboardWidgets.delete': {
    execute: async (args) => {
      await S().customDashboards!.deleteWidget(args.id as string);
    },
    invalidates: [
      ['customDashboard', '*'],
      ['customDashboards', '*'],
    ],
    undo: {
      capture: captureWidget,
      build: (_args, _result, before) => {
        const widget = before as CustomDashboardWidget | null;
        return widget
          ? [
              addWidgetOp(widget),
              {
                op: 'customDashboardWidgets.update',
                args: { id: widget.id, sortOrder: widget.sortOrder },
              },
            ]
          : [];
      },
    },
  },

  'customDashboardWidgets.reorder': {
    execute: async (args) => {
      await S().customDashboards!.reorderWidgets({
        dashboardId: args.dashboardId as string,
        orderedIds: args.orderedIds as string[],
      });
    },
    invalidates: [['customDashboard', '*']],
    undo: {
      capture: async (args) =>
        safeCapture(() =>
          (S().customDashboards!.getDashboard(args.dashboardId as string)?.widgets ?? []).map(
            (widget) => widget.id
          )
        ),
      build: (args, _result, before) => {
        const orderedIds = before as string[] | null;
        return orderedIds?.length
          ? [
              {
                op: 'customDashboardWidgets.reorder',
                args: { dashboardId: args.dashboardId, orderedIds },
              },
            ]
          : [];
      },
    },
  },
} satisfies Record<string, OpCodeEntry>;
