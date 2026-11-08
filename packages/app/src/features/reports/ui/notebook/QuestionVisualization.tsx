import { Trans, useLingui } from '@lingui/react/macro';
import { useCallback, useMemo, useState } from 'react';
import type { EChartsCoreOption } from 'echarts/core';
import type {
  QuestionColumn,
  QuestionDisplay,
  QuestionSource,
  QuestionSpec,
  ResolvedStacking,
  ResolvedVisualization,
} from '@features/reports/lib/question';
import type { QueryResult } from '@shared/lib/sql/report-query-executor';
import { EChart } from '@shared/ui/echart';
import {
  BAR_MAX_WIDTH,
  BAR_RADIUS_TOP,
  tooltipBase,
  tooltipHtml,
  useChartPalette,
  type TooltipRow,
} from '@shared/lib/charts/echarts-chrome';
import { cn } from '@shared/lib/utils';
import { buildChartModel, OTHER_SERIES_ID, type ChartSeries } from './chart-model';
import { columnLabel } from './question-labels';
import { QuestionTable } from './QuestionTable';
import { useQuestionFormatters } from './useQuestionFormatters';
import { applyCartesianDisplay, goalText } from './viz/display';
import { renderExtraVisualization } from './viz';
import { applyCategoryDisplay, isOther } from './viz/transforms';

interface QuestionVisualizationProps {
  result: QueryResult;
  columns: QuestionColumn[];
  source: QuestionSource;
  visualization: ResolvedVisualization;
  /** Bar/area: side by side, stacked, or stacked to 100% (see resolveStacking). */
  stacking?: ResolvedStacking;
  /** Fill the parent's height (dashboard widgets). */
  fitHeight?: boolean;
  className?: string;
  /** Chart settings: values on marks, goal line, sort, top N, dual axis. */
  display?: QuestionDisplay;
  /** The question itself (number with trend re-runs it for the period before). */
  spec?: QuestionSpec;
  /** Base file name for downloads made inside a view (pivot CSV). */
  exportName?: string;
}

/**
 * Renders a question result as a number, line / bar / area / pie chart or
 * table, with a real legend, human date labels and budget-currency values.
 */
export function QuestionVisualization({
  result,
  columns,
  source,
  visualization,
  stacking = 'none',
  fitHeight = false,
  className,
  display,
  spec,
  exportName,
}: QuestionVisualizationProps) {
  if (result.rows.length === 0) {
    return (
      <div
        className={cn(
          'flex h-48 items-center justify-center text-sm text-muted-foreground',
          className
        )}
      >
        <Trans>No rows match this question.</Trans>
      </div>
    );
  }
  if (visualization === 'table') {
    return (
      <QuestionTable result={result} columns={columns} source={source} className={className} />
    );
  }
  if (visualization === 'number') {
    return <NumberView result={result} columns={columns} source={source} className={className} />;
  }
  const extra = renderExtraVisualization(visualization, {
    result,
    columns,
    source,
    display,
    stacking,
    spec,
    fitHeight,
    className,
    exportName,
  });
  if (extra) return extra;
  return (
    <ChartView
      result={result}
      columns={columns}
      source={source}
      visualization={visualization}
      stacking={stacking}
      fitHeight={fitHeight}
      className={className}
      display={display}
    />
  );
}

function NumberView({
  result,
  columns,
  source,
  className,
}: Pick<QuestionVisualizationProps, 'result' | 'columns' | 'source' | 'className'>) {
  const format = useQuestionFormatters(source);
  const metrics = columns.filter((column) => column.kind === 'aggregation');
  const index = new Map(result.columns.map((name, position) => [name, position]));
  const row = result.rows[0] ?? [];
  return (
    <div
      className={cn(
        'grid min-h-40 gap-4 py-6',
        metrics.length > 1 ? 'sm:grid-cols-2' : '',
        metrics.length > 2 ? 'lg:grid-cols-3' : '',
        className
      )}
    >
      {metrics.map((metric) => (
        <div key={metric.key} className="flex flex-col items-center justify-center text-center">
          <div className="text-3xl font-semibold tabular-nums sm:text-5xl">
            {format.cell(metric, row[index.get(metric.key) ?? -1])}
          </div>
          <div className="mt-2 text-sm text-muted-foreground">{columnLabel(source, metric)}</div>
        </div>
      ))}
    </div>
  );
}

function ChartView({
  result,
  columns,
  source,
  visualization,
  stacking = 'none',
  fitHeight,
  className,
  display,
}: QuestionVisualizationProps) {
  const { t } = useLingui();
  const palette = useChartPalette();
  const format = useQuestionFormatters(source);
  const model = useMemo(() => {
    const base = buildChartModel(result, columns);
    // Bars sort; bars and pie slices fold past the top N into "Other".
    if (visualization !== 'bar' && visualization !== 'pie') return { ...base, otherXCount: 0 };
    return applyCategoryDisplay(base, {
      sort: visualization === 'bar' ? display?.sort : undefined,
      topN: display?.topN,
    });
  }, [result, columns, visualization, display?.sort, display?.topN]);
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  const seriesName = useCallback(
    (series: ChartSeries): string => {
      const { otherCount, seriesColumn } = model;
      if (series.id === OTHER_SERIES_ID) return t`Other (${otherCount})`;
      if (seriesColumn) return format.cell(seriesColumn, series.groupValue, 'long');
      return columnLabel(source, series.metric);
    },
    [model, format, source, t]
  );
  const colorOf = useCallback(
    (position: number) => palette.series[position % palette.series.length],
    [palette]
  );

  const isPie = visualization === 'pie';
  const { otherXCount } = model;
  const otherX = t`Other (${otherXCount})`;
  const xLabel = useCallback(
    (value: unknown, style?: 'long') =>
      isOther(value) ? otherX : model.x ? format.cell(model.x, value, style) : '',
    [model, format, otherX]
  );
  const xLabels = useMemo(() => model.xValues.map((value) => xLabel(value)), [model, xLabel]);
  const xLongLabels = useMemo(
    () => model.xValues.map((value) => xLabel(value, 'long')),
    [model, xLabel]
  );

  const legend = isPie
    ? xLabels.map((label, position) => ({ id: `${position}`, label, color: colorOf(position) }))
    : model.series.map((series, position) => ({
        id: series.id,
        label: seriesName(series),
        color: colorOf(position),
      }));
  const showLegend = isPie ? legend.length > 1 : model.series.length > 1;

  const option = useMemo<EChartsCoreOption | null>(() => {
    const { chrome } = palette;
    if (!model.x || model.series.length === 0) return null;
    const [{ metric }] = model.series;

    if (isPie) {
      const [first] = model.series;
      const slices = first.values
        .map((value, position) => ({ value: Math.abs(value), position }))
        .filter((slice) => slice.value > 0 && !hidden.has(`${slice.position}`));
      if (slices.length === 0) return null;
      const total = slices.reduce((sum, slice) => sum + slice.value, 0);
      return {
        tooltip: {
          ...tooltipBase(chrome),
          trigger: 'item' as const,
          formatter: (params: unknown) => {
            const item = params as { dataIndex: number; value: number; color?: string };
            const slice = slices[item.dataIndex];
            const share = total > 0 ? ((item.value / total) * 100).toFixed(1) : '0';
            return tooltipHtml(xLongLabels[slice.position] ?? '', [
              {
                color: typeof item.color === 'string' ? item.color : chrome.other,
                name: `${columnLabel(source, metric)} · ${share}%`,
                value: format.cell(metric, first.values[slice.position]),
              },
            ]);
          },
        },
        series: [
          {
            type: 'pie' as const,
            radius: ['48%', '76%'],
            padAngle: 1,
            data: slices.map((slice) => ({
              name: format.masked ? '•••' : xLabels[slice.position],
              value: slice.value,
              // Small slices get no label (or leader line); the legend names them.
              label: { show: slice.value / total > 0.05 },
              labelLine: { show: slice.value / total > 0.05 },
              itemStyle: {
                color: colorOf(slice.position),
                borderColor: chrome.surface,
                borderWidth: 2,
              },
            })),
            label: {
              color: chrome.inkPrimary,
              fontSize: 11,
              formatter: (params: { name: string; percent?: number }) =>
                `${params.name}\n${params.percent?.toFixed(0)}%`,
            },
            labelLine: { lineStyle: { color: chrome.axisLine } },
          },
        ],
      };
    }

    const visible = model.series
      .map((series, position) => ({ series, position }))
      .filter(({ series }) => !hidden.has(series.id));
    if (visible.length === 0) return null;
    const stack = stacking !== 'none' && visible.length > 1;
    const percent = stack && stacking === 'percent';
    // 100%: each x value's visible series as shares of their total.
    const totals = model.xValues.map((_, index) =>
      visible.reduce((sum, { series }) => sum + Math.abs(series.values[index] ?? 0), 0)
    );
    const plotted = (values: number[]) =>
      percent
        ? values.map((value, index) =>
            totals[index] > 0 ? (Math.abs(value ?? 0) / totals[index]) * 100 : 0
          )
        : values;
    const share = (value: number, index: number) =>
      totals[index] > 0 ? `${((Math.abs(value) / totals[index]) * 100).toFixed(0)}%` : '0%';

    const cartesian = {
      grid: { left: 8, right: 28, top: 16, bottom: 4, containLabel: true },
      xAxis: {
        type: 'category' as const,
        data: xLabels,
        axisLine: { lineStyle: { color: chrome.axisLine } },
        axisTick: { show: false },
        axisLabel: {
          color: chrome.axisText,
          fontSize: 11,
          hideOverlap: true,
          rotate: xLabels.length > 12 && visualization === 'bar' ? 35 : 0,
        },
      },
      yAxis: {
        type: 'value' as const,
        ...(percent ? { max: 100 } : {}),
        axisLabel: {
          color: chrome.axisText,
          fontSize: 11,
          formatter: (value: number) => (percent ? `${value}%` : format.compact(metric, value)),
        },
        splitLine: { lineStyle: { color: chrome.grid, width: 1 } },
        axisLine: { show: false },
      },
      tooltip: {
        ...tooltipBase(chrome),
        trigger: 'axis' as const,
        axisPointer: { type: 'line' as const, lineStyle: { color: chrome.axisLine } },
        formatter: (params: unknown) => {
          const items = params as { dataIndex: number }[];
          if (!items.length) return '';
          const { dataIndex } = items[0];
          const rows: TooltipRow[] = visible.map(({ series, position }) => ({
            color: colorOf(position),
            name: seriesName(series),
            value: stack
              ? `${format.cell(series.metric, series.values[dataIndex])} · ${share(series.values[dataIndex] ?? 0, dataIndex)}`
              : format.cell(series.metric, series.values[dataIndex]),
          }));
          return tooltipHtml(xLongLabels[dataIndex] ?? '', rows);
        },
      },
      series: visible.map(({ series, position }) =>
        visualization === 'bar'
          ? {
              name: series.id,
              type: 'bar' as const,
              stack: stack ? 'stack' : undefined,
              data: plotted(series.values),
              barMaxWidth: BAR_MAX_WIDTH,
              itemStyle: stack
                ? { color: colorOf(position), borderColor: chrome.surface, borderWidth: 1 }
                : { color: colorOf(position), borderRadius: BAR_RADIUS_TOP },
            }
          : {
              name: series.id,
              type: 'line' as const,
              stack: stack ? 'stack' : undefined,
              data: plotted(series.values),
              lineStyle: { color: colorOf(position), width: 2 },
              itemStyle: { color: colorOf(position), borderColor: chrome.surface, borderWidth: 2 },
              symbol: 'circle',
              symbolSize: 7,
              showSymbol: series.values.length <= 36,
              ...(visualization === 'area'
                ? { areaStyle: { color: colorOf(position), opacity: stack ? 0.55 : 0.15 } }
                : {}),
            }
      ),
    };
    return applyCartesianDisplay(cartesian, display, {
      chrome,
      formatValue: (value) => format.compact(metric, value),
      goalLabel: goalText(display?.goal, (value) => format.cell(metric, value)),
      percent,
    });
  }, [
    model,
    hidden,
    palette,
    format,
    isPie,
    visualization,
    stacking,
    xLabels,
    xLongLabels,
    source,
    seriesName,
    colorOf,
    display,
  ]);

  const toggle = (id: string) =>
    setHidden((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else if (legend.length - next.size > 1) next.add(id);
      return next;
    });

  const metricName = model.series.length > 0 ? columnLabel(source, model.series[0].metric) : '';
  const title = metricName ? t`${metricName} chart` : t`Chart`;

  return (
    <div className={cn('flex min-h-0 flex-col gap-2', fitHeight && 'h-full', className)}>
      {showLegend && (
        <ul
          className="flex max-h-20 flex-wrap gap-x-3 gap-y-1 overflow-y-auto text-xs"
          aria-label={t`Legend`}
        >
          {legend.map((item) => {
            const off = hidden.has(item.id);
            return (
              <li key={item.id}>
                <button
                  type="button"
                  aria-pressed={!off}
                  onClick={() => toggle(item.id)}
                  className={cn(
                    'flex items-center gap-1.5 rounded px-1 py-0.5 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    off && 'text-muted-foreground line-through opacity-60'
                  )}
                >
                  <span
                    aria-hidden
                    className="h-2.5 w-2.5 shrink-0 rounded-sm"
                    style={{ backgroundColor: item.color }}
                  />
                  <span className="max-w-48 truncate">{item.label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className={cn('min-h-0 w-full', fitHeight ? 'min-h-[200px] flex-1' : 'h-72 sm:h-96')}>
        {option ? (
          <EChart option={option} ariaLabel={title} className="h-full w-full" />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            <Trans>Nothing to chart for these rows.</Trans>
          </div>
        )}
      </div>
    </div>
  );
}
