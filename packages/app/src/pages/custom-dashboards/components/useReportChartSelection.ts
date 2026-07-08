import { useEffect, useMemo, useState } from 'react';
import type { UnifiedReport } from '@budgero/core/browser';

interface ReportChartDefaults {
  reportId?: string | null;
  chartId?: string | null;
}

/**
 * Shared report+chart picker state for dialogs that let a user choose a
 * saved report and one of its charts. Resets to `defaults` (falling back to
 * the first selectable report/chart) whenever `open` flips true, and keeps
 * `selectedChartId` valid whenever the selected report changes.
 */
export function useReportChartSelection(
  reports: UnifiedReport[],
  open: boolean,
  defaults?: ReportChartDefaults
) {
  const [selectedReportId, setSelectedReportId] = useState('');
  const [selectedChartId, setSelectedChartId] = useState('');

  const selectableReports = useMemo(
    () => reports.filter((report) => report.charts && report.charts.length > 0),
    [reports]
  );

  const selectedReport = useMemo(
    () => selectableReports.find((report) => report.id === selectedReportId) ?? null,
    [selectableReports, selectedReportId]
  );

  // Pre-existing reset-on-open pattern; the setState-in-effect calls are
  // intentional dialog-state resets.
  useEffect(() => {
    if (!open) return;
    const fallbackReport = selectableReports[0]?.id ?? '';
    const resolvedReportId = defaults?.reportId ?? fallbackReport;
    const chartsForReport =
      selectableReports.find((report) => report.id === resolvedReportId)?.charts ?? [];
    const fallbackChart = chartsForReport[0]?.id ?? '';

    // eslint-disable-next-line react-compiler/react-compiler
    setSelectedReportId(resolvedReportId);
    setSelectedChartId(defaults?.chartId ?? fallbackChart);
  }, [open, selectableReports, defaults?.reportId, defaults?.chartId]);

  useEffect(() => {
    if (!selectedReport) {
      // eslint-disable-next-line react-compiler/react-compiler
      setSelectedChartId('');
      return;
    }
    const chartExists = selectedReport.charts.some((chart) => chart.id === selectedChartId);
    if (!chartExists) {
      setSelectedChartId(selectedReport.charts[0]?.id ?? '');
    }
  }, [selectedReport, selectedChartId]);

  return {
    selectableReports,
    selectedReport,
    selectedReportId,
    setSelectedReportId,
    selectedChartId,
    setSelectedChartId,
  };
}
