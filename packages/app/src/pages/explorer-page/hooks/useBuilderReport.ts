import { useCallback, useState } from 'react';
import type { UnifiedReport } from '@budgero/core/browser';
import { useCreateReport, useUpdateReport } from '@entities/report/api/useReports';
import {
  buildSavedBuilderQuery,
  compileReportSpec,
  createDefaultSpec,
  type ReportBuilderSpec,
} from '@features/reports/lib/report-builder';
import { getBuilderSqlLabels } from '@features/reports/ui/report-builder/builder-labels';

/** Builder-mode state: the current spec and the saved builder report it edits. */
export function useBuilderReport(budgetId: number) {
  const [spec, setSpec] = useState<ReportBuilderSpec>(() => createDefaultSpec());
  const [report, setReport] = useState<UnifiedReport | null>(null);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const createReport = useCreateReport();
  const updateReport = useUpdateReport();

  const save = useCallback(
    async ({ name, description }: { name: string; description?: string }) => {
      // Keep the first chart's id so dashboard widgets pinned to it keep working.
      const chartId = report?.charts?.[0]?.id ?? crypto.randomUUID();
      const { sql, chart } = compileReportSpec(spec, {
        budgetId,
        chartId,
        chartTitle: name,
        labels: getBuilderSqlLabels(),
      });
      const query = buildSavedBuilderQuery(spec, sql);
      const charts = [chart, ...(report?.charts?.slice(1) ?? [])];

      const saved = report
        ? await updateReport.mutateAsync({ id: report.id, name, description, query, charts })
        : await createReport.mutateAsync({
            name,
            description,
            query,
            charts: charts.map(({ id: _id, ...rest }) => rest),
          });
      setReport(saved);
      return saved;
    },
    [budgetId, createReport, report, spec, updateReport]
  );

  return { spec, setSpec, report, setReport, showSaveDialog, setShowSaveDialog, save };
}
