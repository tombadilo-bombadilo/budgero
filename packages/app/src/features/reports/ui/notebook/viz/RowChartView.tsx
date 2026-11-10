import { Trans, useLingui } from '@lingui/react/macro';
import { useCallback, useMemo, useRef } from 'react';
import type { EChartsCoreOption } from 'echarts/core';
import { EChart, type EChartClickParams } from '@shared/ui/echart';
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
import type { DrillRequest } from '../DrillMenu';
import { applyCartesianDisplay, goalText } from './display';
import { barSeries, layoutSeries, markDrillValues, seriesColor, useHiddenSeries } from './series';
import { applyCategoryDisplay, isOther } from './transforms';
import type { VizViewProps } from './types';
import { labelWidthFor, useElementWidth } from './useElementWidth';

interface RowChartViewProps extends VizViewProps {
  /** Click on a bar (drill-through). */
  onDrill?: (request: DrillRequest) => void;
}

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
  onDrill,
}: RowChartViewProps) {
  const { t } = useLingui();
  const palette = useChartPalette();
  const format = useQuestionFormatters(source, result);
  const model = useMemo(
    () =>
      applyCategoryDisplay(buildChartModel(result, columns), {
        sort: display?.sort,
        topN: display?.topN,
      }),
    [result, columns, display?.sort, display?.topN]
  );
  const { hidden, toggle } = useHiddenSeries(model.series.map((series) => series.id));
  const colorOf = useCallback(
    (position: number) => seriesColor(palette.series, position),
    [palette]
  );
  // Narrow containers (phones, small dashboard widgets) give labels less room.
  const containerRef = useRef<HTMLDivElement | null>(null);
  const labelWidth = labelWidthFor(useElementWidth(containerRef, 500));
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
    const { visible, stack, percent, plotted, share } = layoutSeries(model, hidden, stacking);
    if (visible.length === 0) return null;
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
          width: labelWidth,
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
          formatter: (value: number) =>
            percent ? format.percent(value / 100) : format.compact(metric, value),
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
              value: stack
                ? `${format.cell(series.metric, series.values[dataIndex])} · ${format.percent(share(series.values[dataIndex] ?? 0, dataIndex))}`
                : format.cell(series.metric, series.values[dataIndex]),
            }))
          );
        },
      },
      series: visible.map((entry) =>
        barSeries(
          entry,
          { stack, plotted },
          {
            color: colorOf(entry.position),
            surface: chrome.surface,
            maxWidth: BAR_MAX_WIDTH,
            radius: BAR_RADIUS_END,
          }
        )
      ),
    };
    return applyCartesianDisplay(base, display, {
      chrome,
      formatValue: (value) => format.compact(metric, value),
      goalLabel: goalText(display?.goal, (value) => format.cell(metric, value)),
      horizontal: true,
      percent,
      formatShare: (ratio) => format.percent(ratio),
    });
  }, [model, hidden, palette, format, stacking, display, t, seriesName, colorOf, labelWidth]);

  const handleMarkClick = useCallback(
    (params: EChartClickParams) => {
      if (!onDrill) return;
      const values = markDrillValues(model, params.dataIndex, params.seriesName);
      if (!values) return;
      const box = containerRef.current?.getBoundingClientRect();
      onDrill({
        values,
        anchor: {
          x: params.clientX ?? (box ? box.left + box.width / 2 : 0),
          y: params.clientY ?? (box ? box.top + box.height / 2 : 0),
        },
      });
    },
    [onDrill, model]
  );

  const height = Math.max(240, model.xValues.length * ROW_HEIGHT + 48);
  return (
    <div className={cn('flex min-h-0 flex-col gap-2', fitHeight && 'h-full', className)}>
      {model.series.length > 1 && <ChartLegend items={legend} hidden={hidden} onToggle={toggle} />}
      <div
        ref={containerRef}
        className={cn('min-h-0 w-full', fitHeight && 'min-h-[200px] flex-1 overflow-y-auto')}
      >
        {option ? (
          <div
            style={{ height: Math.min(height, 2400), minHeight: fitHeight ? '100%' : undefined }}
          >
            <EChart
              option={option}
              ariaLabel={t`Row chart`}
              className="h-full w-full"
              onMarkClick={onDrill ? handleMarkClick : undefined}
            />
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
