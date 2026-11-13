import { msg, plural } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@shared/ui/button';
import { getErrorMessage } from '@shared/lib/errors';
import { toast } from 'sonner';
import { useUiStore } from '@shared/store/useUiStore';
import { useIsMobile } from '@shared/hooks/useIsMobile';
import { useReports } from '@entities/report/api/useReports';
import {
  useCreateCustomDashboard,
  useCustomDashboard,
  useCustomDashboards,
  useDeleteCustomDashboard,
  useUpdateCustomDashboard,
} from '@features/custom-dashboards/api/useCustomDashboards';
import type { SqlDatabase } from '@shared/lib/sql/report-query-executor';
import { useRuntime } from '@shared/runtime/runtime-provider';
import {
  hasDashboardFilters,
  normalizeDashboardFilters,
  type DashboardFilters,
} from '@features/reports/lib/question';
import { questionResultCsv } from '@features/reports/ui/notebook/viz/export';
import { downloadBlob } from '@shared/lib/download';
import type { CustomDashboardWidget } from '@budgero/core/browser';
import { BackToReports } from '@pages/reports/BackToReports';
import { PeriodTabs } from '@shared/ui/PeriodTabs';
import { dashboardDisplayName, widgetUsesPeriod } from '@widgets/dashboard/builtin/builtin-cards';
import { DashboardPeriodProvider } from '@widgets/dashboard/builtin/DashboardPeriod';
import { useDashboardPeriod } from '@widgets/dashboard/builtin/useDashboardPeriod';
import { DashboardSwitcher } from './components/DashboardSwitcher';
import { DashboardGrid } from './components/DashboardGrid';
import { AddToDashboardDialog } from './components/AddToDashboardDialog';
import { DashboardFilterBar } from './components/DashboardFilterBar';
import { DashboardEditBar } from './components/DashboardEditBar';
import { buildCsvZip, zipFileName, type WidgetCsv } from './export-dashboard';
import { runWidgetQuery, widgetQueryKey, widgetQuestion } from './components/widget-query';
import { useDashboardEditor, useHomeActions } from './useDashboardEditor';

const DEFAULT_DASHBOARD_NAME = msg`My Dashboard`;

/** The period tabs of a dashboard's built-in cards. */
function DashboardPeriodTabs() {
  const { dateRange, setDateRange } = useDashboardPeriod();
  return <PeriodTabs value={dateRange} onChange={setDateRange} />;
}

export default function CustomDashboardsPage() {
  const isMobile = useIsMobile();
  const platform = isMobile ? 'mobile' : 'desktop';
  return (
    <DashboardPeriodProvider key={platform} platform={platform}>
      <CustomDashboardsView isMobile={isMobile} />
    </DashboardPeriodProvider>
  );
}

function CustomDashboardsView({ isMobile }: { isMobile: boolean }) {
  const { t } = useLingui();

  const selectedBudget = useUiStore((state) => state.selectedBudget);
  const budgetId = selectedBudget?.ID ?? 0;
  const navigate = useNavigate();
  const { dashboardId } = useParams<{ dashboardId?: string }>();

  const [isEditMode, setIsEditMode] = useState(false);
  const [addWidgetDialogOpen, setAddWidgetDialogOpen] = useState(false);
  const [pinWidget, setPinWidget] = useState<CustomDashboardWidget | null>(null);

  const dashboardsQuery = useCustomDashboards(budgetId);
  const dashboards = useMemo(() => dashboardsQuery.data ?? [], [dashboardsQuery.data]);

  const createDashboardMutation = useCreateCustomDashboard();
  const updateDashboardMutation = useUpdateCustomDashboard();
  const deleteDashboardMutation = useDeleteCustomDashboard();
  const homeActions = useHomeActions();

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
  const editor = useDashboardEditor({
    dashboard: activeDashboard,
    budgetId,
    platform: isMobile ? 'mobile' : 'desktop',
    dashboards,
  });
  const showPeriodTabs = Boolean(activeDashboard?.widgets.some(widgetUsesPeriod));
  const runtime = useRuntime();
  const queryClient = useQueryClient();

  // Filters show the pending change right away; the saved copy takes over once stored.
  const [pendingFilters, setPendingFilters] = useState<{
    id: string;
    filters: DashboardFilters;
  } | null>(null);
  const savedFilters = useMemo(
    () => normalizeDashboardFilters(activeDashboard?.filters),
    [activeDashboard?.filters]
  );
  const filters =
    pendingFilters && pendingFilters.id === activeDashboard?.id
      ? pendingFilters.filters
      : savedFilters;

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
      .mutateAsync({ budgetId, name: t(DEFAULT_DASHBOARD_NAME) })
      .then((dashboard) => {
        void navigate(`/reports/dashboards/${dashboard.id}`, { replace: true });
      })
      .catch((error) => {
        defaultCreatedRef.current = false;
        toast.error(getErrorMessage(error, t`Failed to create default dashboard`));
      });
  }, [
    budgetId,
    dashboardsQuery.isLoading,
    dashboards.length,
    createDashboardMutation,
    navigate,
    t,
  ]);

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
      name: t(DEFAULT_DASHBOARD_NAME),
    });
    await navigate(`/reports/dashboards/${created.id}`, { replace: true });
  };

  const handlePinSelectionForWidget = async ({
    reportId,
    chartId,
  }: {
    reportId: string;
    chartId: string;
  }) => {
    if (!pinWidget) return;
    await editor.replaceQuestion(pinWidget.id, { reportId, chartId });
    setPinWidget(null);
  };

  const handleFiltersChange = async (next: DashboardFilters) => {
    if (!activeDashboard) return;
    const { id } = activeDashboard;
    setPendingFilters({ id, filters: next });
    try {
      await updateDashboardMutation.mutateAsync({
        id,
        budgetId,
        filters: hasDashboardFilters(next) ? { ...next } : null,
      });
    } catch (error) {
      toast.error(getErrorMessage(error, t`Could not save the dashboard filters`));
    } finally {
      setPendingFilters((current) => (current?.filters === next ? null : current));
    }
  };

  const handleExportAll = async () => {
    if (!activeDashboard) return;
    const files: WidgetCsv[] = [];
    let failed = 0;
    for (const widget of activeDashboard.widgets) {
      const report = reportsById.get(widget.reportId) ?? null;
      const chart = report?.charts.find((item) => item.id === widget.chartId) ?? null;
      if (!report || !chart) continue;
      try {
        const question = widgetQuestion(report, chart, filters, budgetId);
        const result = await queryClient.fetchQuery({
          queryKey: widgetQueryKey(widget, report, question),
          queryFn: async () =>
            await runWidgetQuery(report, question, runtime.getDatabase() as SqlDatabase | null),
          staleTime: 30 * 1000,
        });
        const csv = question
          ? questionResultCsv(result, question.columns, question.spec.source)
          : questionResultCsv(result, [], 'transactions');
        files.push({ title: widget.titleOverride || chart.title || report.name, csv });
      } catch {
        failed += 1;
      }
    }
    if (failed > 0) {
      toast.error(
        plural(failed, {
          one: 'Could not export # widget',
          other: 'Could not export # widgets',
        })
      );
    }
    if (files.length === 0) return;
    try {
      const zip = await buildCsvZip(files);
      downloadBlob(zip, zipFileName(dashboardDisplayName(activeDashboard)), 'application/zip');
      toast.success(
        plural(files.length, {
          one: 'Downloaded # CSV file in a zip archive',
          other: 'Downloaded # CSV files in a zip archive',
        })
      );
    } catch (error) {
      toast.error(getErrorMessage(error, t`Could not create the zip archive`));
    }
  };

  const handleOpenReportInExplorer = (reportId: string) => {
    void navigate(`/reports/question/${encodeURIComponent(reportId)}`);
  };

  if (!budgetId) {
    return (
      <div className="px-6 py-6">
        <p className="text-sm text-muted-foreground">
          <Trans>Select a budget to manage custom dashboards.</Trans>
        </p>
      </div>
    );
  }

  return (
    <div
      className={
        isEditMode
          ? 'space-y-4 px-4 py-6 pb-[calc(var(--mobile-bottom-nav-height,96px)+5rem)] sm:pb-8 md:px-8'
          : 'space-y-4 px-4 py-6 pb-[calc(var(--mobile-bottom-nav-height,96px)+1.5rem)] sm:pb-8 md:px-8'
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <BackToReports />
          <h1 className="text-2xl font-semibold">
            <Trans>Custom Dashboards</Trans>
          </h1>
          <p className="text-sm text-muted-foreground">
            <Trans>Saved questions side by side, filtered together.</Trans>
          </p>
        </div>
        {!isEditMode && (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => {
                editor.beginSession();
                setIsEditMode(true);
              }}
              disabled={!activeDashboard}
            >
              <Trans>Edit Layout</Trans>
            </Button>
            <Button onClick={() => setAddWidgetDialogOpen(true)} disabled={!activeDashboard}>
              <Trans>Add a card</Trans>
            </Button>
          </div>
        )}
      </div>

      {isEditMode && activeDashboard && (
        <DashboardEditBar
          isMobile={isMobile}
          onAdd={() => setAddWidgetDialogOpen(true)}
          onDone={() => setIsEditMode(false)}
          onCancel={async () => {
            await editor.cancelSession();
            setIsEditMode(false);
          }}
        />
      )}

      <DashboardSwitcher
        dashboards={dashboards}
        activeDashboardId={activeDashboardId}
        onSelectDashboard={(id) => navigate(`/reports/dashboards/${id}`)}
        onCreateDashboard={handleCreateDashboard}
        onRenameDashboard={handleRenameDashboard}
        onDeleteDashboard={handleDeleteDashboard}
        onExportAll={() => void handleExportAll()}
        exportDisabled={!activeDashboard || activeDashboard.widgets.length === 0}
        onUseAsHome={homeActions.makeHome}
        onStopUsingAsHome={(id) => homeActions.unsetHome(id, dashboards)}
      />

      {!activeDashboard && (dashboardsQuery.isLoading || activeDashboardQuery.isLoading) && (
        <div className="rounded-md border p-6 text-sm text-muted-foreground">
          <Trans>Loading dashboards...</Trans>
        </div>
      )}

      {activeDashboard && (
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <DashboardFilterBar
              budgetId={budgetId}
              filters={filters}
              onChange={(next) => void handleFiltersChange(next)}
            />
          </div>
          {showPeriodTabs && !isMobile && <DashboardPeriodTabs />}
        </div>
      )}

      {activeDashboard && (
        <DashboardGrid
          filters={filters}
          dashboard={activeDashboard}
          reportsById={reportsById}
          isMobile={isMobile}
          isEditMode={isEditMode}
          onReorderWidgets={editor.reorder}
          onRemoveWidget={editor.remove}
          onUpdateDesktopLayout={editor.updateDesktopLayout}
          onUpdateMobileSize={editor.updateMobileSize}
          periodControl={showPeriodTabs ? <DashboardPeriodTabs /> : undefined}
          onSelectNewChart={(widgetId) => {
            const widget = activeDashboard.widgets.find((item) => item.id === widgetId) ?? null;
            setPinWidget(widget);
          }}
          onOpenReportInExplorer={handleOpenReportInExplorer}
        />
      )}

      <AddToDashboardDialog
        open={addWidgetDialogOpen}
        onOpenChange={setAddWidgetDialogOpen}
        questions={reports}
        dashboards={activeDashboard ? [activeDashboard] : []}
        dashboardId={activeDashboard?.id}
        title={t`Add a card`}
        description={t`Pick a saved question or a built-in card to show on this dashboard.`}
        confirmLabel={t`Add to dashboard`}
        onSubmit={({ reportId, chartId, titleOverride }) =>
          editor.addQuestion({ reportId, chartId, titleOverride })
        }
        builtinCards={editor.builtinChoices()}
        onSubmitBuiltin={editor.addBuiltin}
      />

      <AddToDashboardDialog
        open={Boolean(pinWidget)}
        onOpenChange={(open) => {
          if (!open) setPinWidget(null);
        }}
        questions={reports}
        dashboards={activeDashboard ? [activeDashboard] : []}
        dashboardId={activeDashboard?.id}
        defaultQuestionId={pinWidget?.reportId}
        defaultChartId={pinWidget?.chartId}
        withTitle={false}
        title={t`Choose another question`}
        description={t`Show a different question in this place on the dashboard.`}
        confirmLabel={t`Show this question`}
        onSubmit={({ reportId, chartId }) => handlePinSelectionForWidget({ reportId, chartId })}
      />
    </div>
  );
}
