import { useCallback, useState } from 'react';
import { getErrorMessage } from '@shared/lib/errors';
import { useCreateReport, useUpdateReport } from '@entities/report/api/useReports';
import type { UnifiedReport, ChartConfiguration } from '@budgero/core/browser';
import { stripQuestionHeader } from '@features/reports/lib/question';

interface UseReportActionsArgs {
  sqlQuery: string;
  setSqlQuery: (query: string) => void;
  executeQuery: (overrideQuery?: string) => Promise<void>;
}

/** Saving the SQL question, its save dialog, and the active chart selection. */
export function useReportActions({ sqlQuery, setSqlQuery, executeQuery }: UseReportActionsArgs) {
  const [showSaveReportDialog, setShowSaveReportDialog] = useState(false);
  const [editingReport, setEditingReport] = useState<UnifiedReport | null>(null);
  const [selectedChartConfig, setSelectedChartConfig] = useState<ChartConfiguration | null>(null);

  const createReportMutation = useCreateReport();
  const updateReportMutation = useUpdateReport();

  const handleSaveReport = useCallback(
    async (data: {
      name: string;
      description?: string;
      query: string;
      charts: ChartConfiguration[];
    }): Promise<UnifiedReport> => {
      try {
        const saved = editingReport
          ? await updateReportMutation.mutateAsync({
              id: editingReport.id,
              name: data.name,
              description: data.description,
              query: data.query,
              charts: data.charts,
            })
          : await createReportMutation.mutateAsync({
              name: data.name,
              description: data.description,
              query: data.query,
              charts: data.charts.map(({ id: _id, ...rest }) => rest),
            });

        setEditingReport(saved);
        // The editor shows the SQL body; a kept notebook header line stays out of it.
        const body = stripQuestionHeader(saved.query ?? '');
        if (body && body !== sqlQuery) {
          setSqlQuery(body);
          await executeQuery(body);
        }

        const charts = saved.charts ?? [];
        setSelectedChartConfig(
          charts.find((chart) => chart.id === selectedChartConfig?.id) ?? charts[0] ?? null
        );
        return saved;
      } catch (error) {
        throw new Error(getErrorMessage(error, 'Failed to save report'));
      }
    },
    [
      editingReport,
      sqlQuery,
      selectedChartConfig,
      updateReportMutation,
      createReportMutation,
      executeQuery,
      setSqlQuery,
    ]
  );

  const handleCreateReport = useCallback(() => {
    setShowSaveReportDialog(true);
  }, []);

  return {
    showSaveReportDialog,
    editingReport,
    selectedChartConfig,

    setShowSaveReportDialog,
    setEditingReport,
    setSelectedChartConfig,

    handleSaveReport,
    handleCreateReport,
  };
}
