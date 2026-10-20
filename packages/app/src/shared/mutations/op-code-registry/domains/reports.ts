import type { UnifiedReport } from '@budgero/core/browser';
import {
  S,
  executeJournaled,
  journaledUndo,
  redoWithIds,
  safeCapture,
  type NewReportChart,
  type OpCodeEntry,
  type ReportChart,
  type ReportSaveInput,
} from '../shared';

const captureReport = (id: unknown) => safeCapture(() => S().reports!.getReport(id as string));

function reportFields(report: UnifiedReport) {
  return {
    name: report.name,
    description: report.description ?? '',
    query: report.query,
    charts: report.charts,
    tags: report.tags ?? [],
    isFavorite: Boolean(report.isFavorite),
  };
}

const deleteResultReport: NonNullable<OpCodeEntry['undo']> = {
  build: (_args, result) => {
    const id = (result as UnifiedReport | undefined)?.id;
    return id ? [{ op: 'reports.delete', args: { id } }] : [];
  },
};

/** Chart edits restore the report's previous chart list in one update. */
const restoreChartsUndo: NonNullable<OpCodeEntry['undo']> = {
  capture: async (args) => captureReport(args.reportId),
  build: (args, _result, before) => {
    const report = before as UnifiedReport | null;
    return report
      ? [{ op: 'reports.update', args: { id: args.reportId, charts: report.charts } }]
      : [];
  },
};

export const reportOps = {
  'reports.create': {
    execute: async (args) => {
      return await S().reports!.saveReport({
        id: args.id as string | undefined,
        name: args.name as string,
        description: args.description as string | undefined,
        query: args.query as string,
        charts: args.charts as ReportChart[] | undefined,
        tags: args.tags as string[] | undefined,
        isFavorite: args.isFavorite as boolean | undefined,
      });
    },
    invalidates: [['reports']],
    undo: deleteResultReport,
    redo: redoWithIds('reports.create', (args, result) => {
      const id = (result as UnifiedReport | undefined)?.id;
      return id ? { ...args, id } : null;
    }),
  },

  // useUpdateReport
  'reports.update': {
    execute: async (args, context) => {
      const updates = {
        name: args.name as string | undefined,
        description: args.description as string | undefined,
        query: args.query as string | undefined,
        charts: args.charts as ReportChart[] | undefined,
        tags: args.tags as string[] | undefined,
        isFavorite: args.isFavorite as boolean | undefined,
      };
      if (context?.isReceiver) {
        return await S().reports!.reconcileAndUpdateReport(args.id as string, updates);
      }
      // Journaled: undo restores the row as it was (a NULL description too).
      return executeJournaled(args, context, () =>
        S().reports!.updateReport(args.id as string, updates)
      );
    },
    invalidates: [['reports'], ['report', '*']],
    undo: journaledUndo({
      capture: async (args) => captureReport(args.id),
      build: (args, _result, before) => {
        const report = before as UnifiedReport | null;
        return report
          ? [{ op: 'reports.update', args: { id: args.id, ...reportFields(report) } }]
          : [];
      },
    }),
  },

  // useDeleteReport
  // Journaled: undo re-inserts the row exactly (an empty description too).
  'reports.delete': {
    execute: async (args, context) => {
      await executeJournaled(args, context, () => S().reports!.deleteReport(args.id as string));
    },
    invalidates: [['reports'], ['report', '*']],
    undo: journaledUndo({
      capture: async (args) => captureReport(args.id),
      build: (_args, _result, before) => {
        const report = before as UnifiedReport | null;
        return report
          ? [{ op: 'reports.create', args: { id: report.id, ...reportFields(report) } }]
          : [];
      },
    }),
  },

  // useToggleReportFavorite
  'reports.toggleFavorite': {
    execute: async (args) => {
      return await S().reports!.toggleFavorite(args.id as string);
    },
    invalidates: [['reports'], ['report', '*']],
    undo: {
      build: (args) => [{ op: 'reports.toggleFavorite', args: { id: args.id } }],
    },
  },

  // useAddChartToReport
  'reports.addChart': {
    execute: async (args) => {
      return await S().reports!.addChartToReport(
        args.reportId as string,
        args.chart as NewReportChart & { id?: string }
      );
    },
    invalidates: [['reports'], ['report', '*']],
    undo: restoreChartsUndo,
  },

  // useUpdateChartInReport
  'reports.updateChart': {
    execute: async (args) => {
      return await S().reports!.updateChartInReport(
        args.reportId as string,
        args.chartId as string,
        args.updates as Partial<ReportChart>
      );
    },
    invalidates: [['reports'], ['report', '*']],
    undo: restoreChartsUndo,
  },

  // useRemoveChartFromReport
  'reports.removeChart': {
    execute: async (args) => {
      return await S().reports!.removeChartFromReport(
        args.reportId as string,
        args.chartId as string
      );
    },
    invalidates: [['reports'], ['report', '*']],
    undo: restoreChartsUndo,
  },

  // useDuplicateReport
  'reports.duplicate': {
    execute: async (args) => {
      const newReport = args.newReport as ReportSaveInput | undefined;
      if (newReport) {
        return await S().reports!.saveReport(newReport);
      }

      // Compatibility for mutations queued by clients before report IDs were
      // generated at the mutation boundary.
      return await S().reports!.duplicateReport(args.id as string, args.newName as string);
    },
    invalidates: [['reports']],
    undo: deleteResultReport,
  },
} satisfies Record<string, OpCodeEntry>;
