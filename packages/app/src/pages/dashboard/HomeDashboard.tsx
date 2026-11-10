import { Trans, useLingui } from '@lingui/react/macro';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { LayoutDashboard, MoreHorizontal, RotateCcw, SquareArrowOutUpRight } from 'lucide-react';
import { HOME_DEFAULT_ORIGIN, type CustomDashboardWidget } from '@budgero/core/browser';
import { useUiStore } from '@shared/store/useUiStore';
import { Button } from '@shared/ui/button';
import { ConfirmDialog } from '@shared/ui/confirm-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@shared/ui/dropdown-menu';
import { PeriodTabs } from '@shared/ui/PeriodTabs';
import { getErrorMessage } from '@shared/lib/errors';
import { useReports } from '@entities/report/api/useReports';
import {
  useCustomDashboard,
  useCustomDashboards,
  useUpdateCustomDashboard,
} from '@features/custom-dashboards/api/useCustomDashboards';
import {
  hasDashboardFilters,
  normalizeDashboardFilters,
  type DashboardFilters,
} from '@features/reports/lib/question';
import {
  builtinKeyOf,
  defaultHomeDashboard,
  resolveHomeDashboard,
  widgetUsesPeriod,
} from '@widgets/dashboard/builtin/builtin-cards';
import { useDashboardPeriod } from '@widgets/dashboard/builtin/useDashboardPeriod';
import { DashboardGrid } from '@pages/custom-dashboards/components/DashboardGrid';
import { DashboardFilterBar } from '@pages/custom-dashboards/components/DashboardFilterBar';
import { AddToDashboardDialog } from '@pages/custom-dashboards/components/AddToDashboardDialog';
import { HOME_SPACING } from '@pages/custom-dashboards/components/grid-layout';
import { useDashboardEditor, useHomeActions } from '@pages/custom-dashboards/useDashboardEditor';

function HomePeriodTabs() {
  const { dateRange, setDateRange } = useDashboardPeriod();
  return <PeriodTabs value={dateRange} onChange={setDateRange} />;
}

/**
 * The home page: a dashboard like any other. Until its first edit it shows
 * the default cards (never stored); a budget can also show one of its custom
 * dashboards here instead.
 */
export function HomeDashboard({ isMobile }: { isMobile: boolean }) {
  const { t } = useLingui();
  const navigate = useNavigate();
  const budgetId = useUiStore((state) => state.selectedBudget?.ID || 0);
  const platform = isMobile ? 'mobile' : 'desktop';

  const dashboardsQuery = useCustomDashboards(budgetId);
  const dashboards = useMemo(() => dashboardsQuery.data ?? [], [dashboardsQuery.data]);
  const home = resolveHomeDashboard(dashboards);
  const homeQuery = useCustomDashboard(home?.id);
  const defaultHome = useMemo(() => defaultHomeDashboard(budgetId, ''), [budgetId]);
  const loading = Boolean(budgetId) && (dashboardsQuery.isLoading || (home && homeQuery.isLoading));
  const dashboard = (home && homeQuery.data) || defaultHome;
  const stored = dashboard !== defaultHome;
  const madeFromDefault = stored && dashboard.origin === HOME_DEFAULT_ORIGIN;

  const [isEditMode, setIsEditMode] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [pinWidget, setPinWidget] = useState<CustomDashboardWidget | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetting, setResetting] = useState(false);

  const editor = useDashboardEditor({
    dashboard,
    budgetId,
    platform,
    dashboards,
    claimHome: true,
  });
  const homeActions = useHomeActions();
  const updateDashboard = useUpdateCustomDashboard();

  const { data: reports = [] } = useReports();
  const reportsById = useMemo(
    () => new Map(reports.map((report) => [report.id, report])),
    [reports]
  );

  const hasQuestions = dashboard.widgets.some((widget) => builtinKeyOf(widget) === null);
  const [pendingFilters, setPendingFilters] = useState<{
    id: string;
    filters: DashboardFilters;
  } | null>(null);
  const savedFilters = useMemo(
    () => normalizeDashboardFilters(dashboard.filters),
    [dashboard.filters]
  );
  const filters =
    pendingFilters && pendingFilters.id === dashboard.id ? pendingFilters.filters : savedFilters;
  // Filters only reach questions; a home of built-in cards has nothing to filter.
  const showFilterBar = stored && (hasQuestions || hasDashboardFilters(savedFilters));
  const showPeriodTabs = dashboard.widgets.some(widgetUsesPeriod);

  const handleFiltersChange = async (next: DashboardFilters) => {
    if (!stored) return;
    const { id } = dashboard;
    setPendingFilters({ id, filters: next });
    try {
      await updateDashboard.mutateAsync({
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

  const handleReset = async () => {
    if (!stored) return;
    setResetting(true);
    try {
      await homeActions.resetHome(dashboards);
      setResetOpen(false);
      setIsEditMode(false);
    } catch {
      // Reported by the action.
    } finally {
      setResetting(false);
    }
  };

  const title = stored && !madeFromDefault ? dashboard.name : t`Dashboard`;

  const homeMenu = stored ? (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-8 w-8 p-0" aria-label={t`Home page options`}>
          <MoreHorizontal className="h-4 w-4" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          onSelect={() => void navigate(`/reports/dashboards/${encodeURIComponent(dashboard.id)}`)}
        >
          <SquareArrowOutUpRight className="h-4 w-4" aria-hidden />
          <Trans>Open in custom dashboards</Trans>
        </DropdownMenuItem>
        {madeFromDefault ? (
          <DropdownMenuItem onSelect={() => setTimeout(() => setResetOpen(true), 0)}>
            <RotateCcw className="h-4 w-4" aria-hidden />
            <Trans>Reset to default</Trans>
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem
            onSelect={() => {
              setIsEditMode(false);
              void homeActions.unsetHome(dashboard.id, dashboards).catch(() => undefined);
            }}
          >
            <RotateCcw className="h-4 w-4" aria-hidden />
            <Trans>Stop using as home page</Trans>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  ) : null;

  const editButtons = isEditMode ? (
    <>
      <Button size="sm" variant="outline" onClick={() => setAddOpen(true)}>
        <Trans>Add a card</Trans>
      </Button>
      <Button size="sm" onClick={() => setIsEditMode(false)}>
        <Trans>Done</Trans>
      </Button>
    </>
  ) : (
    <Button
      size="sm"
      variant="ghost"
      className="text-muted-foreground"
      onClick={() => setIsEditMode(true)}
    >
      <LayoutDashboard className="h-4 w-4" aria-hidden />
      <Trans>Customize</Trans>
    </Button>
  );

  const grid = loading ? null : (
    <DashboardGrid
      dashboard={dashboard}
      reportsById={reportsById}
      isMobile={isMobile}
      isEditMode={isEditMode}
      filters={filters}
      spacing={HOME_SPACING}
      periodControl={showPeriodTabs ? <HomePeriodTabs /> : undefined}
      onReorderWidgets={editor.reorder}
      onRemoveWidget={editor.remove}
      onUpdateDesktopLayout={editor.updateDesktopLayout}
      onUpdateMobileSize={editor.updateMobileSize}
      onSelectNewChart={(widgetId) =>
        setPinWidget(dashboard.widgets.find((item) => item.id === widgetId) ?? null)
      }
      onOpenReportInExplorer={(reportId) =>
        void navigate(`/reports/question/${encodeURIComponent(reportId)}`)
      }
      emptyState={
        <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          <Trans>Your home page is empty. Use “Customize” to add cards.</Trans>
        </div>
      }
    />
  );

  const dialogs = (
    <>
      <AddToDashboardDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        questions={reports}
        dashboards={[dashboard]}
        dashboardId={dashboard.id}
        title={t`Add a card`}
        description={t`Pick a saved question or a built-in card to show on your home page.`}
        confirmLabel={t`Add to home page`}
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
        dashboards={[dashboard]}
        dashboardId={dashboard.id}
        defaultQuestionId={pinWidget?.reportId}
        defaultChartId={pinWidget?.chartId}
        withTitle={false}
        title={t`Choose another question`}
        description={t`Show a different question in this place on the dashboard.`}
        confirmLabel={t`Show this question`}
        onSubmit={async ({ reportId, chartId }) => {
          if (!pinWidget) return;
          await editor.replaceQuestion(pinWidget.id, { reportId, chartId });
          setPinWidget(null);
        }}
      />
      <ConfirmDialog
        open={resetOpen}
        onOpenChange={setResetOpen}
        title={t`Reset the home page?`}
        description={t`Your changes to the home page are removed and it shows the default cards again. You can undo this.`}
        confirmText={t`Reset`}
        cancelText={t`Cancel`}
        loadingText={t`Saving...`}
        variant="destructive"
        isLoading={resetting}
        onConfirm={handleReset}
      />
    </>
  );

  if (isMobile) {
    return (
      <div className="p-4 pb-20 space-y-4">
        {isEditMode && (
          <div className="flex flex-wrap items-center justify-end gap-2">
            {editButtons}
            {homeMenu}
          </div>
        )}
        {showFilterBar && (
          <DashboardFilterBar
            budgetId={budgetId}
            filters={filters}
            onChange={(next) => void handleFiltersChange(next)}
          />
        )}
        {grid}
        {!isEditMode && !loading && (
          <div className="flex items-center justify-center gap-1">
            {editButtons}
            {homeMenu}
          </div>
        )}
        {dialogs}
      </div>
    );
  }

  return (
    <div className="px-8 py-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-foreground">{title}</h1>
        <div className="flex flex-wrap items-center gap-2">
          {editButtons}
          {homeMenu}
          {showPeriodTabs && <HomePeriodTabs />}
        </div>
      </div>
      {showFilterBar && (
        <DashboardFilterBar
          budgetId={budgetId}
          filters={filters}
          onChange={(next) => void handleFiltersChange(next)}
        />
      )}
      {grid}
      {dialogs}
    </div>
  );
}
