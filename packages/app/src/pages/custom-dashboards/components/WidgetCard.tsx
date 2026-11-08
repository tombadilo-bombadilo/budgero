import { Trans, useLingui } from '@lingui/react/macro';
import { useMemo, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ChartConfiguration,
  CustomDashboardWidget,
  UnifiedReport,
} from '@budgero/core/browser';
import { useRuntime } from '@shared/runtime/runtime-provider';
import {
  getNormalizedReportQueryError,
  type QueryResult,
  type SqlDatabase,
} from '@shared/lib/sql/report-query-executor';
import { ChartViewer } from '@features/analytics/ui/chart-viewer';
import {
  hasDashboardFilters,
  resolveStacking,
  type DashboardFilters,
} from '@features/reports/lib/question';
import { QuestionVisualization } from '@features/reports/ui/notebook/QuestionVisualization';
import { ExportMenu } from '@features/reports/ui/notebook/viz/ExportMenu';
import { refineAutoVisualization } from '@features/reports/ui/notebook/viz/transforms';
import { getLocaleTag } from '@shared/i18n';
import { useUiStore } from '@shared/store/useUiStore';
import { Tooltip, TooltipContent, TooltipTrigger } from '@shared/ui/tooltip';
import { Button } from '@shared/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import { Badge } from '@shared/ui/badge';
import {
  Filter,
  FilterX,
  RefreshCcw,
  Trash2,
  ArrowUpWideNarrow,
  MoveHorizontal,
  MoveVertical,
  PenSquare,
  SquareArrowOutUpRight,
} from 'lucide-react';
import { runWidgetQuery, widgetQueryKey, widgetQuestion } from './widget-query';

interface WidgetCardProps {
  widget: CustomDashboardWidget;
  report: UnifiedReport | null;
  chart: ChartConfiguration | null;
  isEditMode: boolean;
  isMobile: boolean;
  onRemove: (widgetId: string) => Promise<void>;
  onSelectNewChart: (widgetId: string) => void;
  onUpdateDesktopLayout: (
    widgetId: string,
    patch: Partial<{ colSpan: number; rowSpan: number }>
  ) => Promise<void>;
  onUpdateMobileSize: (widgetId: string, size: 's' | 'm' | 'l') => Promise<void>;
  onEditChart: (input: {
    reportId: string;
    reportName: string;
    chart: ChartConfiguration;
    queryResult: QueryResult;
  }) => void;
  onOpenReportInExplorer: (reportId: string) => void;
  /** Dashboard-level filters applied to notebook questions. */
  filters?: DashboardFilters;
}

const NO_FILTERS: DashboardFilters = {};

const MOBILE_HEIGHTS: Record<'s' | 'm' | 'l', string> = {
  s: 'h-[320px]',
  m: 'h-[420px]',
  l: 'h-[520px]',
};

/** Edit-mode layout controls: desktop col/row span steppers or mobile size picker. */
function WidgetLayoutControls({
  widget,
  isMobile,
  onUpdateDesktopLayout,
  onUpdateMobileSize,
}: {
  widget: CustomDashboardWidget;
  isMobile: boolean;
  onUpdateDesktopLayout: WidgetCardProps['onUpdateDesktopLayout'];
  onUpdateMobileSize: WidgetCardProps['onUpdateMobileSize'];
}) {
  const { t } = useLingui();

  const DESKTOP_LAYOUT_BUTTONS: {
    label: string;
    icon: typeof MoveHorizontal;
    patch: (
      layout: CustomDashboardWidget['desktopLayout']
    ) => Partial<{ colSpan: number; rowSpan: number }>;
  }[] = [
    {
      label: t`Width -`,
      icon: MoveHorizontal,
      patch: (layout) => ({ colSpan: Math.max(3, layout.colSpan - 1) }),
    },
    {
      label: t`Width +`,
      icon: MoveHorizontal,
      patch: (layout) => ({ colSpan: Math.min(12, layout.colSpan + 1) }),
    },
    {
      label: t`Height -`,
      icon: MoveVertical,
      patch: (layout) => ({ rowSpan: Math.max(3, layout.rowSpan - 1) }),
    },
    {
      label: t`Height +`,
      icon: MoveVertical,
      patch: (layout) => ({ rowSpan: Math.min(8, layout.rowSpan + 1) }),
    },
  ];

  if (isMobile) {
    return (
      <div className="flex items-center gap-2 pt-2">
        <span className="text-xs text-muted-foreground">
          <Trans>Size</Trans>
        </span>
        {(['s', 'm', 'l'] as const).map((size) => (
          <Button
            key={size}
            variant={widget.mobileLayout.size === size ? 'default' : 'outline'}
            size="sm"
            onClick={() => void onUpdateMobileSize(widget.id, size)}
          >
            {size.toUpperCase()}
          </Button>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 pt-2">
      <Badge variant="outline">
        <Trans>Cols {widget.desktopLayout.colSpan}</Trans>
      </Badge>
      <Badge variant="outline">
        <Trans>Rows {widget.desktopLayout.rowSpan}</Trans>
      </Badge>
      {DESKTOP_LAYOUT_BUTTONS.map(({ label, icon: Icon, patch }) => (
        <Button
          key={label}
          variant="outline"
          size="sm"
          onClick={() => void onUpdateDesktopLayout(widget.id, patch(widget.desktopLayout))}
        >
          <Icon className="h-3 w-3 mr-1" />
          {label}
        </Button>
      ))}
    </div>
  );
}

function WidgetErrorCard({
  title,
  description,
  onSelectNewChart,
  onRemove,
}: {
  title: string;
  description: string;
  onSelectNewChart: () => void;
  onRemove: () => Promise<void>;
}) {
  return (
    <Card className="h-full border-dashed">
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={onSelectNewChart}>
          <Trans>Select new chart</Trans>
        </Button>
        <Button variant="destructive" size="sm" onClick={() => void onRemove()}>
          <Trans>Remove widget</Trans>
        </Button>
      </CardContent>
    </Card>
  );
}

export function WidgetCard({
  widget,
  report,
  chart,
  isEditMode,
  isMobile,
  onRemove,
  onSelectNewChart,
  onUpdateDesktopLayout,
  onUpdateMobileSize,
  onEditChart,
  onOpenReportInExplorer,
  filters = NO_FILTERS,
}: WidgetCardProps) {
  const { t } = useLingui();

  const runtime = useRuntime();
  const queryClient = useQueryClient();
  const budgetId = useUiStore((state) => state.selectedBudget?.ID ?? 0);
  const chartRef = useRef<HTMLDivElement | null>(null);

  // Saved questions render with the notebook's visualization (legend, human
  // labels, money formatting) and take the dashboard's filters; other reports
  // use the generic chart viewer and run unchanged.
  const question = useMemo(
    () => widgetQuestion(report, chart, filters, budgetId),
    [report, chart, filters, budgetId]
  );
  const queryKey = widgetQueryKey(widget, report, question);

  const dataQuery = useQuery({
    queryKey,
    queryFn: async () =>
      await runWidgetQuery(report, question, runtime.getDatabase() as SqlDatabase | null),
    enabled: Boolean(report && chart),
    staleTime: 30 * 1000,
  });

  const title = widget.titleOverride || chart?.title || report?.name || t`Widget`;
  const subtitle = report?.description?.trim() || null;
  const filtersActive = hasDashboardFilters(filters);
  const visualization =
    question && dataQuery.data
      ? refineAutoVisualization(
          question.spec,
          question.visualization,
          dataQuery.data,
          question.columns
        )
      : question?.visualization;
  const updatedAt = dataQuery.dataUpdatedAt
    ? new Date(dataQuery.dataUpdatedAt).toLocaleTimeString(getLocaleTag(), {
        hour: '2-digit',
        minute: '2-digit',
      })
    : null;

  const refreshWidgetData = async () => {
    await queryClient.invalidateQueries({ queryKey: queryKey.slice(0, 3) });
  };

  const queryError = dataQuery.error ? getNormalizedReportQueryError(dataQuery.error) : null;

  const mobileSize = widget.mobileLayout.size;
  const mobileHeightClass = MOBILE_HEIGHTS[mobileSize];

  const isNonReadOnlyError = useMemo(() => {
    return queryError && queryError.code === 'NON_READ_ONLY_QUERY';
  }, [queryError]);

  if (!report) {
    return (
      <WidgetErrorCard
        title={title}
        description={t`Source report is missing. Choose another chart or remove this widget.`}
        onSelectNewChart={() => onSelectNewChart(widget.id)}
        onRemove={() => onRemove(widget.id)}
      />
    );
  }

  if (!chart) {
    return (
      <WidgetErrorCard
        title={title}
        description={t`Source chart is missing in this report.`}
        onSelectNewChart={() => onSelectNewChart(widget.id)}
        onRemove={() => onRemove(widget.id)}
      />
    );
  }

  if (queryError) {
    return (
      <WidgetErrorCard
        title={title}
        description={
          isNonReadOnlyError
            ? t`This report query is not read-only and cannot run in dashboard widgets.`
            : queryError.message
        }
        onSelectNewChart={() => onSelectNewChart(widget.id)}
        onRemove={() => onRemove(widget.id)}
      />
    );
  }

  return (
    <Card
      className={`${isMobile ? mobileHeightClass : 'h-full'} flex flex-col overflow-hidden gap-2 py-4`}
    >
      <CardHeader className="pb-1 gap-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 space-y-0.5">
            <CardTitle className="text-base truncate" title={title}>
              {title}
            </CardTitle>
            {subtitle && (
              <CardDescription className="truncate text-xs" title={subtitle}>
                {subtitle}
              </CardDescription>
            )}
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
              {updatedAt && (
                <span>
                  <Trans>Updated {updatedAt}</Trans>
                </span>
              )}
              {filtersActive && question && question.applied.length > 0 && (
                <span className="inline-flex items-center gap-1 text-foreground/80">
                  <Filter className="h-3 w-3" aria-hidden />
                  <Trans>Dashboard filters applied</Trans>
                </span>
              )}
              {filtersActive && (!question || question.applied.length === 0) && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="inline-flex cursor-help items-center gap-1 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <FilterX className="h-3 w-3" aria-hidden />
                      <Trans>Not filtered</Trans>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-60">
                    {question
                      ? t`This question’s data has no field the dashboard filters use.`
                      : t`SQL reports run as written; dashboard filters only apply to questions built in the notebook.`}
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => void refreshWidgetData()}
              disabled={dataQuery.isFetching}
              aria-label={dataQuery.isFetching ? t`Refreshing widget data` : t`Refresh widget data`}
              title={dataQuery.isFetching ? t`Refreshing...` : t`Refresh widget data`}
            >
              <RefreshCcw className={`h-4 w-4 ${dataQuery.isFetching ? 'animate-spin' : ''}`} />
            </Button>
            <ExportMenu
              name={title}
              result={dataQuery.data ?? null}
              columns={question?.columns}
              source={question?.spec.source}
              chartRef={chartRef}
              className="h-9 w-9"
            />
            {report && (
              <Button
                variant="ghost"
                size="icon"
                title={t`Open the question`}
                aria-label={t`Open the question`}
                onClick={() => onOpenReportInExplorer(report.id)}
              >
                <SquareArrowOutUpRight className="h-4 w-4" />
              </Button>
            )}
            {report && dataQuery.data && (
              <Button
                variant="ghost"
                size="icon"
                title={t`Edit source visualization`}
                aria-label={t`Edit source visualization`}
                onClick={() =>
                  onEditChart({
                    reportId: report.id,
                    reportName: report.name,
                    chart,
                    queryResult: dataQuery.data,
                  })
                }
              >
                <PenSquare className="h-4 w-4" />
              </Button>
            )}
            {isEditMode && (
              <>
                <Button variant="ghost" size="icon" onClick={() => onSelectNewChart(widget.id)}>
                  <ArrowUpWideNarrow className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" onClick={() => void onRemove(widget.id)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </>
            )}
          </div>
        </div>
        {isEditMode && (
          <WidgetLayoutControls
            widget={widget}
            isMobile={isMobile}
            onUpdateDesktopLayout={onUpdateDesktopLayout}
            onUpdateMobileSize={onUpdateMobileSize}
          />
        )}
      </CardHeader>
      <CardContent className="flex-1 min-h-0 pt-0">
        {dataQuery.isPending && (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            <Trans>Loading chart...</Trans>
          </div>
        )}
        {!dataQuery.isPending && dataQuery.data && question && visualization && (
          <div ref={chartRef} className="h-full overflow-auto">
            <QuestionVisualization
              result={dataQuery.data}
              columns={question.columns}
              source={question.spec.source}
              visualization={visualization}
              stacking={resolveStacking(
                question.spec,
                visualization === 'row' ? 'bar' : visualization
              )}
              display={question.spec.display}
              spec={question.spec}
              exportName={title}
              fitHeight
            />
          </div>
        )}
        {!dataQuery.isPending && dataQuery.data && !question && (
          <div ref={chartRef} className="h-full overflow-hidden">
            <ChartViewer
              queryResult={dataQuery.data}
              chartConfig={chart}
              fitHeight
              compactToolbar
              showLegendSummary={false}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
