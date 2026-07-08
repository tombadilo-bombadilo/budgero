import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { getErrorMessage, toastError } from '@shared/lib/errors';
import {
  useReports,
  useCreateReport,
  useUpdateReport,
  useDeleteReport,
} from '@entities/report/api/useReports';
import type { UnifiedReport, ChartConfiguration } from '@budgero/core/browser';

interface UseReportActionsArgs {
  sqlQuery: string;
  setSqlQuery: (query: string) => void;
  executeQuery: (overrideQuery?: string) => Promise<void>;
}

/** Saved-report CRUD, the reports/save dialogs, and the active chart selection. */
export function useReportActions({ sqlQuery, setSqlQuery, executeQuery }: UseReportActionsArgs) {
  const [showReportsDialog, setShowReportsDialog] = useState(false);
  const [showSaveReportDialog, setShowSaveReportDialog] = useState(false);
  const [editingReport, setEditingReport] = useState<UnifiedReport | null>(null);
  const [selectedChartConfig, setSelectedChartConfig] = useState<ChartConfiguration | null>(null);

  const { data: savedReports = [], refetch: refetchReports } = useReports();
  const createReportMutation = useCreateReport();
  const updateReportMutation = useUpdateReport();
  const deleteReportMutation = useDeleteReport();

  const handleSaveReport = useCallback(
    async (data: {
      name: string;
      description?: string;
      query: string;
      charts: ChartConfiguration[];
    }): Promise<UnifiedReport> => {
      try {
        let updatedReport: UnifiedReport;

        if (editingReport) {
          updatedReport = await updateReportMutation.mutateAsync({
            id: editingReport.id,
            name: data.name,
            description: data.description,
            query: data.query,
            charts: data.charts,
          });

          setEditingReport(updatedReport);
          if (updatedReport.query && updatedReport.query !== sqlQuery) {
            setSqlQuery(updatedReport.query);
            await executeQuery(updatedReport.query);
          }

          if (updatedReport.charts && updatedReport.charts.length > 0) {
            const currentChartId = selectedChartConfig?.id;
            const chartStillExists = updatedReport.charts.find((c) => c.id === currentChartId);
            if (chartStillExists) {
              setSelectedChartConfig(chartStillExists);
            } else {
              setSelectedChartConfig(updatedReport.charts[0]);
            }
          } else {
            setSelectedChartConfig(null);
          }
        } else {
          updatedReport = await createReportMutation.mutateAsync({
            name: data.name,
            description: data.description,
            query: data.query,
            charts: data.charts.map(({ id: _id, ...rest }) => rest),
          });

          setEditingReport(updatedReport);
          if (updatedReport.query && updatedReport.query !== sqlQuery) {
            setSqlQuery(updatedReport.query);
            await executeQuery(updatedReport.query);
          }

          if (updatedReport.charts && updatedReport.charts.length > 0) {
            setSelectedChartConfig(updatedReport.charts[0]);
          }
        }

        void refetchReports();
        return updatedReport;
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
      refetchReports,
      setSqlQuery,
    ]
  );

  const handleLoadReport = useCallback(
    async (report: UnifiedReport) => {
      setSqlQuery(report.query);
      setEditingReport(report);
      setShowReportsDialog(false);
      toast.success('Report Loaded', {
        description: `Successfully loaded "${report.name}"`,
      });

      if (report.charts && report.charts.length > 0) {
        setSelectedChartConfig(report.charts[0]);
      } else {
        setSelectedChartConfig(null);
      }
    },
    [setSqlQuery]
  );

  const handleEditReport = useCallback(
    async (report: UnifiedReport) => {
      setSqlQuery(report.query);
      setEditingReport(report);
      setShowReportsDialog(false);
      setShowSaveReportDialog(true);

      if (report.charts && report.charts.length > 0) {
        setSelectedChartConfig(report.charts[0]);
      } else {
        setSelectedChartConfig(null);
      }
    },
    [setSqlQuery]
  );

  const handleDeleteReport = useCallback(
    async (reportId: string) => {
      try {
        await deleteReportMutation.mutateAsync(reportId);
        toast.success('Report Deleted', {
          description: 'The report has been deleted successfully.',
        });

        if (editingReport?.id === reportId) {
          setEditingReport(null);
          setSelectedChartConfig(null);
        }
      } catch (error) {
        toastError('Delete Failed', error, 'Failed to delete report');
      }
    },
    [editingReport, deleteReportMutation]
  );

  const handleCreateReport = useCallback(() => {
    setShowSaveReportDialog(true);
  }, []);

  const handleNewReport = useCallback(() => {
    setEditingReport(null);
    setShowSaveReportDialog(true);
  }, []);

  return {
    showReportsDialog,
    showSaveReportDialog,
    editingReport,
    selectedChartConfig,
    savedReports,

    setShowReportsDialog,
    setShowSaveReportDialog,
    setEditingReport,
    setSelectedChartConfig,

    handleSaveReport,
    handleLoadReport,
    handleEditReport,
    handleDeleteReport,
    handleCreateReport,
    handleNewReport,
  };
}
