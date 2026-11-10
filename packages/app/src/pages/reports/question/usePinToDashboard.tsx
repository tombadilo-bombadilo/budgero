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
import { AddToDashboardDialog } from '@pages/custom-dashboards/components/AddToDashboardDialog';

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
    <AddToDashboardDialog
      open={open}
      onOpenChange={setOpen}
      questions={reports}
      question={report ? (reports.find((item) => item.id === report.id) ?? report) : null}
      dashboards={dashboardsQuery.data ?? []}
      title={t`Add to dashboard`}
      description={t`Pick the dashboard to show this question on.`}
      confirmLabel={t`Add to dashboard`}
      onCreateDashboard={async () => {
        await createDashboard.mutateAsync({ budgetId, name: t`My Dashboard` });
        await dashboardsQuery.refetch();
      }}
      onSubmit={async ({ dashboardId, reportId, chartId, titleOverride }) => {
        await addWidget.mutateAsync({ dashboardId, reportId, chartId, titleOverride });
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
