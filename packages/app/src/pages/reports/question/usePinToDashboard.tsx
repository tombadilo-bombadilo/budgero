import { useLingui } from '@lingui/react/macro';
import { useState } from 'react';
import { toast } from 'sonner';
import type { UnifiedReport } from '@budgero/core/browser';
import { useReports } from '@entities/report/api/useReports';
import {
  useAddDashboardWidget,
  useCreateCustomDashboard,
  useCustomDashboards,
} from '@features/custom-dashboards/api/useCustomDashboards';
import { PinChartDialog } from '@pages/custom-dashboards/components/PinChartDialog';

/** "Add to dashboard" for a saved question: open(report) + the dialog to render. */
export function usePinToDashboard(budgetId: number) {
  const { t } = useLingui();
  const [report, setReport] = useState<UnifiedReport | null>(null);
  const [open, setOpen] = useState(false);
  const { data: reports = [] } = useReports();
  const dashboardsQuery = useCustomDashboards(budgetId);
  const addWidget = useAddDashboardWidget();
  const createDashboard = useCreateCustomDashboard();

  const dialog = (
    <PinChartDialog
      open={open}
      onOpenChange={setOpen}
      reports={
        report && !reports.some((item) => item.id === report.id) ? [...reports, report] : reports
      }
      dashboards={dashboardsQuery.data ?? []}
      defaultReportId={report?.id}
      defaultChartId={report?.charts?.[0]?.id}
      onCreateDashboard={async () => {
        await createDashboard.mutateAsync({ budgetId, name: t`My Dashboard` });
        await dashboardsQuery.refetch();
      }}
      onPin={async ({ dashboardId, reportId, chartId }) => {
        await addWidget.mutateAsync({ dashboardId, reportId, chartId });
        toast.success(t`Added to dashboard`);
      }}
    />
  );

  return {
    open: (next: UnifiedReport) => {
      setReport(next);
      setOpen(true);
    },
    dialog,
  };
}
