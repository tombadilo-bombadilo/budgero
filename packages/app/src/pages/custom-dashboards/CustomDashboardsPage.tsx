import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '@shared/ui/button';
import { getErrorMessage } from '@shared/lib/errors';
import { toast } from 'sonner';
import { useUiStore } from '@shared/store/useUiStore';
import { useIsMobile } from '@shared/hooks/useIsMobile';
import { useReports, useUpdateChartInReport } from '@entities/report/api/useReports';
import {
  useAddDashboardWidget,
  useCreateCustomDashboard,
  useCustomDashboard,
  useCustomDashboards,
  useDeleteCustomDashboard,
  useDeleteDashboardWidget,
  useReorderDashboardWidgets,
  useUpdateCustomDashboard,
  useUpdateDashboardWidget,
} from '@features/custom-dashboards/api/useCustomDashboards';
import type { QueryResult } from '@shared/lib/sql/report-query-executor';
import type { ChartConfiguration, CustomDashboardWidget } from '@budgero/core/browser';
import { DashboardSwitcher } from './components/DashboardSwitcher';
import { DashboardGrid } from './components/DashboardGrid';
import { AddWidgetDialog } from './components/AddWidgetDialog';
import { PinChartDialog } from './components/PinChartDialog';
import { EditWidgetChartDialog } from './components/EditWidgetChartDialog';

const DEFAULT_DASHBOARD_NAME = 'My Dashboard';

export default function CustomDashboardsPage() {
  const selectedBudget = useUiStore((state) => state.selectedBudget);
  const budgetId = selectedBudget?.ID ?? 0;
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const { dashboardId } = useParams<{ dashboardId?: string }>();

  const [isEditMode, setIsEditMode] = useState(false);
  const [addWidgetDialogOpen, setAddWidgetDialogOpen] = useState(false);
  const [pinWidget, setPinWidget] = useState<CustomDashboardWidget | null>(null);
  const [editingChartContext, setEditingChartContext] = useState<{
    reportId: string;
    reportName: string;
    chart: ChartConfiguration;
    queryResult: QueryResult;
  } | null>(null);

  const dashboardsQuery = useCustomDashboards(budgetId);
  const dashboards = useMemo(() => dashboardsQuery.data ?? [], [dashboardsQuery.data]);

  const createDashboardMutation = useCreateCustomDashboard();
  const updateDashboardMutation = useUpdateCustomDashboard();
  const deleteDashboardMutation = useDeleteCustomDashboard();
  const addWidgetMutation = useAddDashboardWidget();
  const updateWidgetMutation = useUpdateDashboardWidget();
  const deleteWidgetMutation = useDeleteDashboardWidget();
  const reorderWidgetsMutation = useReorderDashboardWidgets();
  const updateChartMutation = useUpdateChartInReport();

  const { data: reports = [] } = useReports();
  const reportsById = useMemo(() => {
    return new Map(reports.map((report) => [report.id, report]));
  }, [reports]);

  const activeDashboardId = useMemo(() => {
    if (!dashboards.length) return null;
    if (dashboardId && dashboards.some((dashboard) => dashboard.id === dashboardId)) {
      return dashboardId;
    }
    return dashboards[0].id;
  }, [dashboards, dashboardId]);

  const activeDashboardQuery = useCustomDashboard(activeDashboardId);
  const activeDashboard = activeDashboardQuery.data;

  const defaultCreatedRef = useRef(false);

  useEffect(() => {
    defaultCreatedRef.current = false;
  }, [budgetId]);

  useEffect(() => {
    if (
      !budgetId ||
      dashboardsQuery.isLoading ||
      dashboards.length > 0 ||
      defaultCreatedRef.current
    ) {
      return;
    }
    defaultCreatedRef.current = true;
    void createDashboardMutation
      .mutateAsync({ budgetId, name: DEFAULT_DASHBOARD_NAME })
      .then((dashboard) => {
        void navigate(`/reports/dashboards/${dashboard.id}`, { replace: true });
      })
      .catch((error) => {
        defaultCreatedRef.current = false;
        toast.error(getErrorMessage(error, 'Failed to create default dashboard'));
      });
  }, [budgetId, dashboardsQuery.isLoading, dashboards.length, createDashboardMutation, navigate]);

  useEffect(() => {
    if (!activeDashboardId || !dashboards.length) return;
    if (dashboardId !== activeDashboardId) {
      void navigate(`/reports/dashboards/${activeDashboardId}`, { replace: true });
    }
  }, [dashboardId, activeDashboardId, dashboards.length, navigate]);

  useEffect(() => {
    if (!isMobile) return;
    const frameId = requestAnimationFrame(() => {
      setIsEditMode(false);
    });
    return () => cancelAnimationFrame(frameId);
  }, [activeDashboardId, isMobile]);

  const handleCreateDashboard = async (name: string) => {
    const dashboard = await createDashboardMutation.mutateAsync({ budgetId, name });
    await navigate(`/reports/dashboards/${dashboard.id}`);
  };

  const handleRenameDashboard = async (id: string, name: string) => {
    await updateDashboardMutation.mutateAsync({ id, name, budgetId });
  };

  const handleDeleteDashboard = async (id: string) => {
    const existing = dashboards;
    const activeIndex = existing.findIndex((dashboard) => dashboard.id === id);
    await deleteDashboardMutation.mutateAsync({ id, budgetId });

    const remaining = existing.filter((dashboard) => dashboard.id !== id);
    if (remaining.length > 0) {
      const fallback = remaining[Math.min(activeIndex, remaining.length - 1)];
      await navigate(`/reports/dashboards/${fallback.id}`, { replace: true });
      return;
    }

    const created = await createDashboardMutation.mutateAsync({
      budgetId,
      name: DEFAULT_DASHBOARD_NAME,
    });
    await navigate(`/reports/dashboards/${created.id}`, { replace: true });
  };

  const handleAddWidget = async (input: {
    reportId: string;
    chartId: string;
    titleOverride?: string;
  }) => {
    if (!activeDashboardId) throw new Error('No active dashboard selected');
    await addWidgetMutation.mutateAsync({
      dashboardId: activeDashboardId,
      reportId: input.reportId,
      chartId: input.chartId,
      titleOverride: input.titleOverride,
    });
  };

  const handleReorderWidgets = async (orderedIds: string[]) => {
    if (!activeDashboardId) return;
    await reorderWidgetsMutation.mutateAsync({ dashboardId: activeDashboardId, orderedIds });
  };

  const handleRemoveWidget = async (widgetId: string) => {
    if (!activeDashboardId) return;
    await deleteWidgetMutation.mutateAsync({ id: widgetId, dashboardId: activeDashboardId });
  };

  const handleUpdateDesktopLayout = async (
    widgetId: string,
    patch: Partial<{ colSpan: number; rowSpan: number }>
  ) => {
    if (!activeDashboardId || !activeDashboard) return;
    const widget = activeDashboard.widgets.find((item) => item.id === widgetId);
    if (!widget) return;
    await updateWidgetMutation.mutateAsync({
      id: widgetId,
      dashboardId: activeDashboardId,
      desktopLayout: {
        colSpan: patch.colSpan ?? widget.desktopLayout.colSpan,
        rowSpan: patch.rowSpan ?? widget.desktopLayout.rowSpan,
      },
    });
  };

  const handleUpdateMobileSize = async (widgetId: string, size: 's' | 'm' | 'l') => {
    if (!activeDashboardId) return;
    await updateWidgetMutation.mutateAsync({
      id: widgetId,
      dashboardId: activeDashboardId,
      mobileLayout: { size },
    });
  };

  const handlePinSelectionForWidget = async ({
    reportId,
    chartId,
  }: {
    reportId: string;
    chartId: string;
  }) => {
    if (!pinWidget || !activeDashboardId) return;
    await updateWidgetMutation.mutateAsync({
      id: pinWidget.id,
      dashboardId: activeDashboardId,
      reportId,
      chartId,
    });
    setPinWidget(null);
  };

  const handleEditChart = (input: {
    reportId: string;
    reportName: string;
    chart: ChartConfiguration;
    queryResult: QueryResult;
  }) => {
    setEditingChartContext(input);
  };

  const handleSaveWidgetChart = async (chart: ChartConfiguration) => {
    if (!editingChartContext) {
      throw new Error('No chart selected for editing');
    }
    const updated = await updateChartMutation.mutateAsync({
      reportId: editingChartContext.reportId,
      chartId: editingChartContext.chart.id,
      updates: {
        chartType: chart.chartType,
        title: chart.title,
        xAxisColumn: chart.xAxisColumn,
        yAxisColumn: chart.yAxisColumn,
        groupByColumn: chart.groupByColumn,
        aggregateFunction: chart.aggregateFunction,
      },
    });
    const updatedChart =
      updated.charts.find((item) => item.id === editingChartContext.chart.id) ?? chart;
    setEditingChartContext((prev) =>
      prev
        ? {
            ...prev,
            chart: updatedChart,
          }
        : prev
    );
  };

  const handleOpenReportInExplorer = (reportId: string) => {
    void navigate('/reports/explorer', {
      state: { editReportId: reportId, openSaveDialog: true },
    });
  };

  if (!budgetId) {
    return (
      <div className="px-6 py-6">
        <p className="text-sm text-muted-foreground">
          Select a budget to manage custom dashboards.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4 px-4 py-6 pb-[calc(var(--mobile-bottom-nav-height,96px)+1.5rem)] sm:pb-8 md:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Custom Dashboards</h1>
          <p className="text-sm text-muted-foreground">
            Build dashboard layouts from Explorer charts. Drag to reorder, resize on desktop, and
            use size presets on mobile.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={isEditMode ? 'default' : 'outline'}
            onClick={() => setIsEditMode((prev) => !prev)}
            disabled={!activeDashboard}
          >
            {isEditMode ? 'Done Editing' : 'Edit Layout'}
          </Button>
          <Button onClick={() => setAddWidgetDialogOpen(true)} disabled={!activeDashboard}>
            Add Widget
          </Button>
        </div>
      </div>

      <DashboardSwitcher
        dashboards={dashboards}
        activeDashboardId={activeDashboardId}
        onSelectDashboard={(id) => navigate(`/reports/dashboards/${id}`)}
        onCreateDashboard={handleCreateDashboard}
        onRenameDashboard={handleRenameDashboard}
        onDeleteDashboard={handleDeleteDashboard}
      />

      {!activeDashboard && (dashboardsQuery.isLoading || activeDashboardQuery.isLoading) && (
        <div className="rounded-md border p-6 text-sm text-muted-foreground">
          Loading dashboards...
        </div>
      )}

      {activeDashboard && (
        <DashboardGrid
          dashboard={activeDashboard}
          reportsById={reportsById}
          isMobile={isMobile}
          isEditMode={isEditMode}
          onReorderWidgets={handleReorderWidgets}
          onRemoveWidget={handleRemoveWidget}
          onUpdateDesktopLayout={handleUpdateDesktopLayout}
          onUpdateMobileSize={handleUpdateMobileSize}
          onSelectNewChart={(widgetId) => {
            const widget = activeDashboard.widgets.find((item) => item.id === widgetId) ?? null;
            setPinWidget(widget);
          }}
          onEditChart={handleEditChart}
          onOpenReportInExplorer={handleOpenReportInExplorer}
        />
      )}

      <AddWidgetDialog
        open={addWidgetDialogOpen}
        onOpenChange={setAddWidgetDialogOpen}
        reports={reports}
        onAddWidget={handleAddWidget}
      />

      <PinChartDialog
        open={Boolean(pinWidget)}
        onOpenChange={(open) => {
          if (!open) setPinWidget(null);
        }}
        reports={reports}
        dashboards={activeDashboard ? [activeDashboard] : []}
        defaultDashboardId={activeDashboard?.id}
        defaultReportId={pinWidget?.reportId}
        defaultChartId={pinWidget?.chartId}
        confirmLabel="Update Widget"
        title="Select New Chart"
        description="Choose a different source chart for this widget."
        onPin={handlePinSelectionForWidget}
      />

      <EditWidgetChartDialog
        open={Boolean(editingChartContext)}
        onOpenChange={(open) => {
          if (!open) setEditingChartContext(null);
        }}
        queryResult={editingChartContext?.queryResult ?? null}
        initialChart={editingChartContext?.chart ?? null}
        reportName={editingChartContext?.reportName}
        onSave={handleSaveWidgetChart}
      />
    </div>
  );
}
