import { Trans, useLingui } from '@lingui/react/macro';
import { useCallback, useMemo, useRef } from 'react';
import type { EChartsCoreOption } from 'echarts/core';
import { EChart } from '@shared/ui/echart';
import { tooltipBase, tooltipHtml, useChartPalette } from '@shared/lib/charts/echarts-chrome';
import { cn } from '@shared/lib/utils';
import { buildChartModel, OTHER_SERIES_ID, type ChartSeries } from '../chart-model';
import { columnLabel } from '../question-labels';
import { useQuestionFormatters } from '../useQuestionFormatters';
import { ChartLegend } from './ChartLegend';
import { withAlpha } from './display';
import { seriesColor, useHiddenSeries } from './series';
import { applyCategoryDisplay, isOther } from './transforms';
import type { VizViewProps } from './types';
import { MAX_RADAR_AXES, MIN_RADAR_AXES, radarPoint } from './radar-data';
import { useElementWidth } from './useElementWidth';

/**
 * One polygon per metric (or per value of a second grouping) over the first
 * grouping's values. Negative values sit at the centre; the tooltip says so.
 */
export function RadarView({
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
  const model = useMemo(() => {
    const base = buildChartModel(result, columns);
    const topN =
      display?.topN ?? (base.xValues.length > MAX_RADAR_AXES ? MAX_RADAR_AXES - 1 : undefined);
    return applyCategoryDisplay(base, { topN });
  }, [result, columns, display?.topN]);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const width = useElementWidth(hostRef, 600);
  const narrow = width < 460;

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
    (position: number) => seriesColor(palette.series, position),
    [palette]
  );
  const legend = model.series.map((series, position) => ({
    id: series.id,
    label: seriesName(series),
    color: colorOf(position),
  }));
  const { hidden, toggle } = useHiddenSeries(legend.map((item) => item.id));
  const axisCount = model.xValues.length;

  const option = useMemo<EChartsCoreOption | null>(() => {
    if (!model.x || axisCount < MIN_RADAR_AXES) return null;
    const { chrome } = palette;
    const visible = model.series
      .map((series, position) => ({ series, position }))
      .filter(({ series }) => !hidden.has(series.id));
    if (visible.length === 0) return null;
    const { otherXCount, x } = model;
    const names = model.xValues.map((value) =>
      isOther(value) ? t`Other (${otherXCount})` : format.cell(x!, value)
    );
    const longNames = model.xValues.map((value) =>
      isOther(value) ? t`Other (${otherXCount})` : format.cell(x!, value, 'long')
    );
    // One scale for all axes: polygons compare by shape.
    const top = Math.max(
      1,
      ...visible.flatMap(({ series }) => series.values.map((value) => radarPoint(value)))
    );
    const clip = (label: string) => {
      const room = narrow ? 10 : 18;
      return label.length > room ? `${label.slice(0, room - 1)}…` : label;
    };
    return {
      tooltip: {
        ...tooltipBase(chrome),
        trigger: 'item' as const,
        formatter: (params: unknown) => {
          const item = params as { dataIndex: number; seriesIndex: number; data?: { id?: string } };
          const entry = visible.find(({ series }) => series.id === item.data?.id);
          if (!entry) return '';
          return tooltipHtml(
            seriesName(entry.series),
            entry.series.values.map((value, index) => ({
              color: colorOf(entry.position),
              name: longNames[index] ?? '',
              value: (() => {
                const shown = format.cell(entry.series.metric, value);
                return value < 0 ? t`${shown} (drawn at 0)` : shown;
              })(),
            }))
          );
        },
      },
      radar: {
        radius: narrow ? '62%' : '68%',
        center: ['50%', '52%'],
        splitNumber: 4,
        shape: 'polygon' as const,
        indicator: names.map((name) => ({ name: clip(name), max: top, min: 0 })),
        axisName: { color: chrome.inkSecondary, fontSize: narrow ? 10 : 11 },
        axisLine: { lineStyle: { color: chrome.grid } },
        splitLine: { lineStyle: { color: chrome.grid } },
        splitArea: {
          areaStyle: { color: [withAlpha(chrome.grid, 0.18), 'transparent'] },
        },
      },
      series: [
        {
          type: 'radar' as const,
          symbol: 'circle',
          symbolSize: narrow ? 4 : 6,
          emphasis: { lineStyle: { width: 3 }, areaStyle: { opacity: 0.35 } },
          data: visible.map(({ series, position }) => ({
            id: series.id,
            name: seriesName(series),
            value: series.values.map((value) => radarPoint(value)),
            lineStyle: { color: colorOf(position), width: 2 },
            itemStyle: { color: colorOf(position), borderColor: chrome.surface, borderWidth: 1 },
            areaStyle: { color: colorOf(position), opacity: visible.length > 2 ? 0.12 : 0.2 },
          })),
        },
      ],
    };
  }, [model, axisCount, palette, hidden, format, seriesName, colorOf, narrow, t]);

  if (axisCount < MIN_RADAR_AXES) {
    return (
      <div className="flex h-48 flex-col items-center justify-center gap-1 text-center text-sm text-muted-foreground">
        <p className="font-medium text-foreground">
          <Trans>A radar needs at least 3 values to compare</Trans>
        </p>
        <p>
          <Trans>
            This question has {axisCount}. Try a bar chart, or group by something with more values.
          </Trans>
        </p>
      </div>
    );
  }

  return (
    <div className={cn('flex min-h-0 flex-col gap-2', fitHeight && 'h-full', className)}>
      {model.series.length > 1 && <ChartLegend items={legend} hidden={hidden} onToggle={toggle} />}
      <div
        ref={hostRef}
        className={cn('min-h-0 w-full', fitHeight ? 'min-h-[200px] flex-1' : 'h-80 sm:h-[26rem]')}
      >
        {option && <EChart option={option} ariaLabel={t`Radar chart`} className="h-full w-full" />}
      </div>
    </div>
  );
}
