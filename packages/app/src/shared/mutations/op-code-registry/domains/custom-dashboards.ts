import { S, type OpCodeEntry } from '../shared';

export const customDashboardOps = {
  'customDashboards.create': {
    execute: async (args) => {
      return await S().customDashboards!.createDashboard({
        budgetId: args.budgetId as number,
        name: args.name as string,
      });
    },
    invalidates: [['customDashboards', '*']],
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
  },

  'customDashboards.delete': {
    execute: async (args) => {
      await S().customDashboards!.deleteDashboard(args.id as string);
    },
    invalidates: [
      ['customDashboards', '*'],
      ['customDashboard', '*'],
    ],
  },

  'customDashboards.reorder': {
    execute: async (args) => {
      await S().customDashboards!.reorderDashboards({
        budgetId: args.budgetId as number,
        orderedIds: args.orderedIds as string[],
      });
    },
    invalidates: [['customDashboards', '*']],
  },

  'customDashboardWidgets.add': {
    execute: async (args) => {
      return await S().customDashboards!.addWidget({
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
  },

  'customDashboardWidgets.delete': {
    execute: async (args) => {
      await S().customDashboards!.deleteWidget(args.id as string);
    },
    invalidates: [
      ['customDashboard', '*'],
      ['customDashboards', '*'],
    ],
  },

  'customDashboardWidgets.reorder': {
    execute: async (args) => {
      await S().customDashboards!.reorderWidgets({
        dashboardId: args.dashboardId as string,
        orderedIds: args.orderedIds as string[],
      });
    },
    invalidates: [['customDashboard', '*']],
  },
} satisfies Record<string, OpCodeEntry>;
