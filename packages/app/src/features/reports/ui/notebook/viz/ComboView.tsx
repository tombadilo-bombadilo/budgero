import { Trans, useLingui } from '@lingui/react/macro';
import { useCallback, useMemo } from 'react';
import type { EChartsCoreOption } from 'echarts/core';
import { EChart } from '@shared/ui/echart';
import {
  BAR_MAX_WIDTH,
  BAR_RADIUS_TOP,
  tooltipBase,
  tooltipHtml,
  useChartPalette,
} from '@shared/lib/charts/echarts-chrome';
import { cn } from '@shared/lib/utils';
import { buildChartModel } from '../chart-model';
import { columnFormat, columnLabel } from '../question-labels';
import { useQuestionFormatters } from '../useQuestionFormatters';
import { ChartLegend } from './ChartLegend';
import { applyCartesianDisplay, goalText } from './display';
import { seriesColor, useHiddenSeries } from './series';
import type { VizViewProps } from './types';

/**
 * Bars for the first metric, a line for each further metric. The line gets
 * its own axis when the units differ (money vs count) or the dual-axis
 * setting asks for it.
 */
export function ComboView({
  result,
  columns,
  source,
  display,
  fitHeight,
  className,
}: VizViewProps) {
  const { t } = useLingui();
  const palette = useChartPalette();
  const format = useQuestionFormatters(source, result);
  const model = useMemo(() => buildChartModel(result, columns), [result, columns]);
  const { hidden, toggle } = useHiddenSeries(model.series.map((series) => series.id));
  const [firstSeries, secondSeries] = model.series;
  const dualAxis =
    display?.dualAxis ??
    (firstSeries && secondSeries
      ? columnFormat(firstSeries.metric) !== columnFormat(secondSeries.metric)
      : false);

  const colorOf = useCallback(
    (position: number) => seriesColor(palette.series, position),
    [palette]
  );
  const legend = model.series.map((series, position) => ({
    id: series.id,
    label: columnLabel(source, series.metric),
    color: colorOf(position),
  }));

  const option = useMemo<EChartsCoreOption | null>(() => {
    const { chrome } = palette;
    const [barSeries, ...lineSeries] = model.series;
    if (!model.x || !barSeries) return null;
    const { x } = model;
    const xLabels = model.xValues.map((value) => format.cell(x, value));
    const xLong = model.xValues.map((value) => format.cell(x, value, 'long'));
    const leftMetric = barSeries.metric;
    const rightMetric = lineSeries[0]?.metric ?? leftMetric;
    const axis = (metric: typeof leftMetric, show: boolean) => ({
      type: 'value' as const,
      show,
      axisLabel: {
        color: chrome.axisText,
        fontSize: 11,
        formatter: (value: number) => format.compact(metric, value),
      },
      splitLine: { lineStyle: { color: chrome.grid, width: 1 }, show: metric === leftMetric },
      axisLine: { show: false },
    });
    const visible = model.series
      .map((series, position) => ({ series, position }))
      .filter(({ series }) => !hidden.has(series.id));
    const base = {
      grid: { left: 8, right: dualAxis ? 8 : 28, top: 16, bottom: 4, containLabel: true },
      xAxis: {
        type: 'category' as const,
        data: xLabels,
        axisLine: { lineStyle: { color: chrome.axisLine } },
        axisTick: { show: false },
        axisLabel: { color: chrome.axisText, fontSize: 11, hideOverlap: true },
      },
      yAxis: dualAxis
        ? [axis(leftMetric, true), axis(rightMetric, true)]
        : [axis(leftMetric, true)],
      tooltip: {
        ...tooltipBase(chrome),
        trigger: 'axis' as const,
        axisPointer: { type: 'shadow' as const },
        formatter: (params: unknown) => {
          const items = params as { dataIndex: number }[];
          if (!items.length) return '';
          const { dataIndex } = items[0];
          return tooltipHtml(
            xLong[dataIndex] ?? '',
            visible.map(({ series, position }) => ({
              color: colorOf(position),
              name: columnLabel(source, series.metric),
              value: format.cell(series.metric, series.values[dataIndex]),
            }))
          );
        },
      },
      series: visible.map(({ series, position }) =>
        position === 0
          ? {
              name: series.id,
              type: 'bar' as const,
              data: series.values,
              barMaxWidth: BAR_MAX_WIDTH * 1.5,
              itemStyle: { color: colorOf(position), borderRadius: BAR_RADIUS_TOP },
            }
          : {
              name: series.id,
              type: 'line' as const,
              yAxisIndex: dualAxis ? 1 : 0,
              data: series.values,
              smooth: true,
              symbol: 'circle',
              symbolSize: 6,
              showSymbol: series.values.length <= 36,
              lineStyle: { color: colorOf(position), width: 2.5 },
              itemStyle: { color: colorOf(position), borderColor: chrome.surface, borderWidth: 2 },
            }
      ),
    };
    return applyCartesianDisplay(base, display, {
      chrome,
      formatValue: (value) => format.compact(leftMetric, value),
      goalLabel: goalText(display?.goal, (value) => format.cell(leftMetric, value)),
    });
  }, [model, hidden, palette, format, dualAxis, display, source, colorOf]);

  if (!option) {
    return (
      <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
        <Trans>Nothing to chart for these rows.</Trans>
      </div>
    );
  }
  return (
    <div className={cn('flex min-h-0 flex-col gap-2', fitHeight && 'h-full', className)}>
      <ChartLegend items={legend} hidden={hidden} onToggle={toggle} />
      <div className={cn('min-h-0 w-full', fitHeight ? 'min-h-[200px] flex-1' : 'h-72 sm:h-96')}>
        <EChart option={option} ariaLabel={t`Combo chart`} className="h-full w-full" />
      </div>
    </div>
  );
}
