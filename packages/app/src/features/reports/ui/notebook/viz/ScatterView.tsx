import { Trans, useLingui } from '@lingui/react/macro';
import { useMemo } from 'react';
import type { EChartsCoreOption } from 'echarts/core';
import { EChart } from '@shared/ui/echart';
import { tooltipBase, tooltipHtml, useChartPalette } from '@shared/lib/charts/echarts-chrome';
import { cn } from '@shared/lib/utils';
import { columnLabel } from '../question-labels';
import { useQuestionFormatters } from '../useQuestionFormatters';
import { withAlpha } from './display';
import { buildScatter } from './transforms';
import type { VizViewProps } from './types';

/** One point per grouping value: first metric across, second metric up. */
export function ScatterView({ result, columns, source, fitHeight, className }: VizViewProps) {
  const { t } = useLingui();
  const palette = useChartPalette();
  const format = useQuestionFormatters(source);
  const data = useMemo(() => buildScatter(result, columns), [result, columns]);

  const option = useMemo<EChartsCoreOption | null>(() => {
    if (!data || data.points.length === 0) return null;
    const { chrome } = palette;
    const color = palette.series[0];
    const pointName = (labels: unknown[]) =>
      labels.map((value, index) => format.cell(data.groupings[index], value, 'long')).join(' · ');
    const axis = (metric: typeof data.xMetric, name: string, horizontal: boolean) => ({
      type: 'value' as const,
      name,
      nameLocation: 'middle' as const,
      nameGap: horizontal ? 28 : 52,
      nameTextStyle: { color: chrome.axisText, fontSize: 11 },
      scale: true,
      axisLabel: {
        color: chrome.axisText,
        fontSize: 11,
        formatter: (value: number) => format.compact(metric, value),
      },
      splitLine: { lineStyle: { color: chrome.grid, width: 1 } },
      axisLine: { lineStyle: { color: chrome.axisLine } },
    });
    return {
      grid: { left: 64, right: 24, top: 16, bottom: 44, containLabel: false },
      xAxis: axis(data.xMetric, columnLabel(source, data.xMetric), true),
      yAxis: axis(data.yMetric, columnLabel(source, data.yMetric), false),
      tooltip: {
        ...tooltipBase(chrome),
        trigger: 'item' as const,
        formatter: (params: unknown) => {
          const { dataIndex } = params as { dataIndex: number };
          const point = data.points[dataIndex];
          if (!point) return '';
          return tooltipHtml(pointName(point.labels), [
            {
              color,
              name: columnLabel(source, data.xMetric),
              value: format.cell(data.xMetric, point.x),
            },
            {
              color,
              name: columnLabel(source, data.yMetric),
              value: format.cell(data.yMetric, point.y),
            },
          ]);
        },
      },
      series: [
        {
          type: 'scatter' as const,
          data: data.points.map((point) => [point.x, point.y]),
          symbolSize: data.points.length > 200 ? 6 : 10,
          itemStyle: {
            color: withAlpha(color, 0.7),
            borderColor: color,
            borderWidth: 1,
          },
          emphasis: { scale: 1.6 },
        },
      ],
    };
  }, [data, palette, format, source]);

  if (!option) {
    return (
      <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
        <Trans>Nothing to chart for these rows.</Trans>
      </div>
    );
  }
  return (
    <div
      className={cn(
        'min-h-0 w-full',
        fitHeight ? 'h-full min-h-[200px]' : 'h-72 sm:h-96',
        className
      )}
    >
      <EChart option={option} ariaLabel={t`Scatter chart`} className="h-full w-full" />
    </div>
  );
}
