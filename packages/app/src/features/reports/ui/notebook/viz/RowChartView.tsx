import { Trans, useLingui } from '@lingui/react/macro';
import { useCallback, useMemo, useState } from 'react';
import type { EChartsCoreOption } from 'echarts/core';
import { EChart } from '@shared/ui/echart';
import {
  BAR_MAX_WIDTH,
  tooltipBase,
  tooltipHtml,
  useChartPalette,
} from '@shared/lib/charts/echarts-chrome';
import { cn } from '@shared/lib/utils';
import { buildChartModel, OTHER_SERIES_ID, type ChartSeries } from '../chart-model';
import { columnLabel } from '../question-labels';
import { useQuestionFormatters } from '../useQuestionFormatters';
import { ChartLegend } from './ChartLegend';
import { applyCartesianDisplay, goalText, toggleHidden } from './display';
import { applyCategoryDisplay, isOther } from './transforms';
import type { VizViewProps } from './types';

const ROW_HEIGHT = 26;
const BAR_RADIUS_END: [number, number, number, number] = [0, 4, 4, 0];

/**
 * Horizontal bars: room for long category names and many categories. The
 * first category sits on top; a second grouping stacks (or not) like bars.
 */
export function RowChartView({
  result,
  columns,
  source,
  display,
  stacking = 'none',
  fitHeight,
  className,
}: VizViewProps) {
  const { t } = useLingui();
  const palette = useChartPalette();
  const format = useQuestionFormatters(source);
  const model = useMemo(
    () =>
      applyCategoryDisplay(buildChartModel(result, columns), {
        sort: display?.sort,
        topN: display?.topN,
      }),
    [result, columns, display?.sort, display?.topN]
  );
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const colorOf = useCallback(
    (position: number) => palette.series[position % palette.series.length],
    [palette]
  );
  const seriesName = useCallback(
    (series: ChartSeries): string => {
      const { otherCount, seriesColumn } = model;
      if (series.id === OTHER_SERIES_ID) return t`Other (${otherCount})`;
      if (seriesColumn) return format.cell(seriesColumn, series.groupValue, 'long');
      return columnLabel(source, series.metric);
    },
    [model, format, source, t]
  );
  const legend = model.series.map((series, position) => ({
    id: series.id,
    label: seriesName(series),
    color: colorOf(position),
  }));

  const option = useMemo<EChartsCoreOption | null>(() => {
    const { chrome } = palette;
    if (!model.x || model.series.length === 0) return null;
    const { x } = model;
    const { otherXCount } = model;
    const labels = model.xValues.map((value) =>
      isOther(value) ? t`Other (${otherXCount})` : format.cell(x, value)
    );
    const longLabels = model.xValues.map((value) =>
      isOther(value) ? t`Other (${otherXCount})` : format.cell(x, value, 'long')
    );
    const visible = model.series
      .map((series, position) => ({ series, position }))
      .filter(({ series }) => !hidden.has(series.id));
    if (visible.length === 0) return null;
    const stack = stacking !== 'none' && visible.length > 1;
    const percent = stack && stacking === 'percent';
    const totals = model.xValues.map((_, index) =>
      visible.reduce((sum, { series }) => sum + Math.abs(series.values[index] ?? 0), 0)
    );
    const plotted = (values: number[]) =>
      percent
        ? values.map((value, index) =>
            totals[index] > 0 ? (Math.abs(value) / totals[index]) * 100 : 0
          )
        : values;
    const [{ metric }] = model.series;

    const base = {
      grid: { left: 8, right: 40, top: 8, bottom: 4, containLabel: true },
      yAxis: {
        type: 'category' as const,
        data: labels,
        inverse: true,
        axisLine: { lineStyle: { color: chrome.axisLine } },
        axisTick: { show: false },
        axisLabel: {
          color: chrome.axisText,
          fontSize: 11,
          width: 160,
          overflow: 'truncate' as const,
        },
      },
      xAxis: {
        type: 'value' as const,
        ...(percent ? { max: 100 } : {}),
        axisLabel: {
          color: chrome.axisText,
          fontSize: 11,
          hideOverlap: true,
          formatter: (value: number) => (percent ? `${value}%` : format.compact(metric, value)),
        },
        splitLine: { lineStyle: { color: chrome.grid, width: 1 } },
      },
      tooltip: {
        ...tooltipBase(chrome),
        trigger: 'axis' as const,
        axisPointer: { type: 'shadow' as const },
        formatter: (params: unknown) => {
          const items = params as { dataIndex: number }[];
          if (!items.length) return '';
          const { dataIndex } = items[0];
          return tooltipHtml(
            longLabels[dataIndex] ?? '',
            visible.map(({ series, position }) => ({
              color: colorOf(position),
              name: seriesName(series),
              value: format.cell(series.metric, series.values[dataIndex]),
            }))
          );
        },
      },
      series: visible.map(({ series, position }) => ({
        name: series.id,
        type: 'bar' as const,
        stack: stack ? 'stack' : undefined,
        data: plotted(series.values),
        barMaxWidth: BAR_MAX_WIDTH,
        itemStyle: stack
          ? { color: colorOf(position), borderColor: chrome.surface, borderWidth: 1 }
          : { color: colorOf(position), borderRadius: BAR_RADIUS_END },
      })),
    };
    return applyCartesianDisplay(base, display, {
      chrome,
      formatValue: (value) => format.compact(metric, value),
      goalLabel: goalText(display?.goal, (value) => format.cell(metric, value)),
      horizontal: true,
      percent,
    });
  }, [model, hidden, palette, format, stacking, display, t, seriesName, colorOf]);

  const height = Math.max(240, model.xValues.length * ROW_HEIGHT + 48);
  return (
    <div className={cn('flex min-h-0 flex-col gap-2', fitHeight && 'h-full', className)}>
      {model.series.length > 1 && (
        <ChartLegend
          items={legend}
          hidden={hidden}
          onToggle={(id) => setHidden((previous) => toggleHidden(previous, id, legend.length))}
        />
      )}
      <div className={cn('min-h-0 w-full', fitHeight && 'min-h-[200px] flex-1 overflow-y-auto')}>
        {option ? (
          <div
            style={{ height: Math.min(height, 2400), minHeight: fitHeight ? '100%' : undefined }}
          >
            <EChart option={option} ariaLabel={t`Row chart`} className="h-full w-full" />
          </div>
        ) : (
          <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
            <Trans>Nothing to chart for these rows.</Trans>
          </div>
        )}
      </div>
    </div>
  );
}
