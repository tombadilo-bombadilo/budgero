import { useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ChartConfiguration,
  CustomDashboardWidget,
  UnifiedReport,
} from '@budgero/core/browser';
import { useRuntime } from '@shared/runtime/runtime-provider';
import {
  executeReportQuery,
  getNormalizedReportQueryError,
  type QueryResult,
  type SqlDatabase,
} from '@shared/lib/sql/report-query-executor';
import { ChartViewer } from '@features/analytics/ui/chart-viewer';
import { Button } from '@shared/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import { Badge } from '@shared/ui/badge';
import {
  RefreshCcw,
  Trash2,
  ArrowUpWideNarrow,
  MoveHorizontal,
  MoveVertical,
  PenSquare,
  SquareArrowOutUpRight,
} from 'lucide-react';

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
}

const MOBILE_HEIGHTS: Record<'s' | 'm' | 'l', string> = {
  s: 'h-[320px]',
  m: 'h-[420px]',
  l: 'h-[520px]',
};

const DESKTOP_LAYOUT_BUTTONS: {
  label: string;
  icon: typeof MoveHorizontal;
  patch: (
    layout: CustomDashboardWidget['desktopLayout']
  ) => Partial<{ colSpan: number; rowSpan: number }>;
}[] = [
  {
    label: 'Width -',
    icon: MoveHorizontal,
    patch: (layout) => ({ colSpan: Math.max(3, layout.colSpan - 1) }),
  },
  {
    label: 'Width +',
    icon: MoveHorizontal,
    patch: (layout) => ({ colSpan: Math.min(12, layout.colSpan + 1) }),
  },
  {
    label: 'Height -',
    icon: MoveVertical,
    patch: (layout) => ({ rowSpan: Math.max(3, layout.rowSpan - 1) }),
  },
  {
    label: 'Height +',
    icon: MoveVertical,
    patch: (layout) => ({ rowSpan: Math.min(8, layout.rowSpan + 1) }),
  },
];

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
  if (isMobile) {
    return (
      <div className="flex items-center gap-2 pt-2">
        <span className="text-xs text-muted-foreground">Size</span>
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
      <Badge variant="outline">Cols {widget.desktopLayout.colSpan}</Badge>
      <Badge variant="outline">Rows {widget.desktopLayout.rowSpan}</Badge>
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
          Select new chart
        </Button>
        <Button variant="destructive" size="sm" onClick={() => void onRemove()}>
          Remove widget
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
}: WidgetCardProps) {
  const runtime = useRuntime();
  const queryClient = useQueryClient();
  const reportUpdatedAt = report?.updatedAt ?? 'missing';

  const dataQuery = useQuery({
    queryKey: ['dashboardWidgetData', widget.reportId, reportUpdatedAt],
    queryFn: async () => {
      return await executeReportQuery(
        report?.query ?? '',
        runtime.getDatabase() as SqlDatabase | null
      );
    },
    enabled: Boolean(report && chart),
    staleTime: 30 * 1000,
  });

  const title = widget.titleOverride || chart?.title || report?.name || 'Widget';

  const refreshWidgetData = async () => {
    await queryClient.invalidateQueries({
      queryKey: ['dashboardWidgetData', widget.reportId, reportUpdatedAt],
    });
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
        description="Source report is missing. Choose another chart or remove this widget."
        onSelectNewChart={() => onSelectNewChart(widget.id)}
        onRemove={() => onRemove(widget.id)}
      />
    );
  }

  if (!chart) {
    return (
      <WidgetErrorCard
        title={title}
        description="Source chart is missing in this report."
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
            ? 'This report query is not read-only and cannot run in dashboard widgets.'
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
          <div className="min-w-0">
            <CardTitle className="text-base truncate">{title}</CardTitle>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => void refreshWidgetData()}
              disabled={dataQuery.isFetching}
              aria-label={dataQuery.isFetching ? 'Refreshing widget data' : 'Refresh widget data'}
              title={dataQuery.isFetching ? 'Refreshing...' : 'Refresh widget data'}
            >
              <RefreshCcw className={`h-4 w-4 ${dataQuery.isFetching ? 'animate-spin' : ''}`} />
            </Button>
            {report && (
              <Button
                variant="ghost"
                size="icon"
                title="Open source report in Explorer"
                aria-label="Open source report in Explorer"
                onClick={() => onOpenReportInExplorer(report.id)}
              >
                <SquareArrowOutUpRight className="h-4 w-4" />
              </Button>
            )}
            {report && dataQuery.data && (
              <Button
                variant="ghost"
                size="icon"
                title="Edit source visualization"
                aria-label="Edit source visualization"
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
            Loading chart...
          </div>
        )}
        {!dataQuery.isPending && dataQuery.data && (
          <div className="h-full overflow-hidden">
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
