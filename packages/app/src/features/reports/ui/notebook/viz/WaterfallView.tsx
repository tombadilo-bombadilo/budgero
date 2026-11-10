import { Trans, useLingui } from '@lingui/react/macro';
import { useMemo } from 'react';
import type { EChartsCoreOption } from 'echarts/core';
import { EChart } from '@shared/ui/echart';
import { tooltipBase, tooltipHtml, useChartPalette } from '@shared/lib/charts/echarts-chrome';
import { cn } from '@shared/lib/utils';
import { buildChartModel } from '../chart-model';
import { columnLabel } from '../question-labels';
import { useQuestionFormatters } from '../useQuestionFormatters';
import { ChartLegend } from './ChartLegend';
import { goalMarkLine, goalText, metricPolarity } from './display';
import { buildWaterfall, isOther } from './transforms';
import type { VizViewProps } from './types';

interface RenderApi {
  value: (dimension: number) => number;
  coord: (point: [number, number]) => [number, number];
  size: (point: [number, number]) => [number, number];
}

/**
 * Start → one step per category / month → total. Steps that raise the total
 * are green, steps that lower it red (spending metrics flip the sign: more
 * spending reads as red). A dashed connector carries each level to the next.
 */
export function WaterfallView({
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
  const waterfall = useMemo(() => buildWaterfall(model, display?.topN), [model, display?.topN]);
  const metric = model.series[0]?.metric;
  const polarity = metric ? metricPolarity(metric) : 1;
  const up = polarity > 0 ? palette.flow.positive : palette.flow.negative;
  const down = polarity > 0 ? palette.flow.negative : palette.flow.positive;
  const totalColor = palette.series[0];

  const option = useMemo<EChartsCoreOption | null>(() => {
    const { chrome } = palette;
    if (!model.x || !metric || waterfall.steps.length === 0) return null;
    const { x } = model;
    const { otherCount } = waterfall;
    const name = (value: unknown, style: 'short' | 'long' = 'short') =>
      isOther(value) ? t`Other (${otherCount})` : format.cell(x, value, style);
    const totalLabel = t`Total`;
    const labels = [...waterfall.steps.map((step) => name(step.value)), totalLabel];
    const longLabels = [...waterfall.steps.map((step) => name(step.value, 'long')), totalLabel];
    // [index, low, high, amount, kind] where kind 0 = step, 1 = total.
    const data = [
      ...waterfall.steps.map((step, index) => [
        index,
        Math.min(step.start, step.end),
        Math.max(step.start, step.end),
        step.amount,
        0,
        step.end,
      ]),
      [
        waterfall.steps.length,
        Math.min(0, waterfall.total),
        Math.max(0, waterfall.total),
        waterfall.total,
        1,
        waterfall.total,
      ],
    ];
    const showValues = display?.showValues ?? true;

    return {
      grid: { left: 8, right: 28, top: 24, bottom: 4, containLabel: true },
      xAxis: {
        type: 'category' as const,
        data: labels,
        axisLine: { lineStyle: { color: chrome.axisLine } },
        axisTick: { show: false },
        axisLabel: {
          color: chrome.axisText,
          fontSize: 11,
          hideOverlap: true,
          rotate: labels.length > 10 ? 35 : 0,
          width: 110,
          overflow: 'truncate' as const,
        },
      },
      yAxis: {
        type: 'value' as const,
        axisLabel: {
          color: chrome.axisText,
          fontSize: 11,
          formatter: (value: number) => format.compact(metric, value),
        },
        splitLine: { lineStyle: { color: chrome.grid, width: 1 } },
      },
      tooltip: {
        ...tooltipBase(chrome),
        trigger: 'item' as const,
        formatter: (params: unknown) => {
          const { dataIndex } = params as { dataIndex: number };
          const row = data[dataIndex];
          const isTotal = row[4] === 1;
          const amount = row[3];
          const rows = isTotal
            ? [
                {
                  color: totalColor,
                  name: columnLabel(source, metric),
                  value: format.cell(metric, amount),
                },
              ]
            : [
                {
                  color: amount >= 0 ? up : down,
                  name: columnLabel(source, metric),
                  value: `${amount >= 0 ? '+' : '−'}${format.cell(metric, Math.abs(amount))}`,
                },
                {
                  color: chrome.axisLine,
                  name: t`Running total`,
                  value: format.cell(metric, row[5]),
                },
              ];
          return tooltipHtml(longLabels[dataIndex] ?? '', rows);
        },
      },
      series: [
        {
          type: 'custom' as const,
          encode: { x: 0, y: [1, 2] },
          data,
          renderItem: (_params: unknown, api: RenderApi) => {
            const index = api.value(0);
            const low = api.value(1);
            const high = api.value(2);
            const amount = api.value(3);
            const isTotal = api.value(4) === 1;
            const end = api.value(5);
            const [left, top] = api.coord([index, high]);
            const [, bottom] = api.coord([index, low]);
            const band = api.size([1, 0])[0];
            const width = Math.min(band * 0.62, 48);
            const color = isTotal ? totalColor : amount >= 0 ? up : down;
            const children: unknown[] = [
              {
                type: 'rect',
                shape: {
                  x: left - width / 2,
                  y: top,
                  width,
                  height: Math.max(1, bottom - top),
                  r: 3,
                },
                style: { fill: color },
              },
            ];
            if (!isTotal) {
              const [, levelY] = api.coord([index, end]);
              children.push({
                type: 'line',
                shape: {
                  x1: left + width / 2,
                  y1: levelY,
                  x2: left + band - width / 2,
                  y2: levelY,
                },
                style: { stroke: chrome.axisLine, lineDash: [3, 3], lineWidth: 1 },
                silent: true,
              });
            }
            if (showValues) {
              const text = isTotal
                ? format.compact(metric, amount)
                : `${amount >= 0 ? '+' : '−'}${format.compact(metric, Math.abs(amount))}`;
              children.push({
                type: 'text',
                silent: true,
                style: {
                  text,
                  x: left,
                  y: top - 4,
                  fill: chrome.inkSecondary,
                  fontSize: 10,
                  align: 'center',
                  verticalAlign: 'bottom',
                },
              });
            }
            return { type: 'group', children };
          },
          ...(display?.goal !== undefined
            ? {
                markLine: goalMarkLine(
                  display.goal,
                  chrome,
                  goalText(display.goal, (value) => format.cell(metric, value))
                ),
              }
            : {}),
        },
      ],
    };
  }, [model, metric, waterfall, palette, format, display, source, up, down, totalColor, t]);

  if (!option) {
    return (
      <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
        <Trans>Nothing to chart for these rows.</Trans>
      </div>
    );
  }
  return (
    <div className={cn('flex min-h-0 flex-col gap-2', fitHeight && 'h-full', className)}>
      <ChartLegend
        items={[
          {
            id: 'up',
            label: polarity > 0 ? t`Increase` : t`Decrease`,
            color: palette.flow.positive,
          },
          {
            id: 'down',
            label: polarity > 0 ? t`Decrease` : t`Increase`,
            color: palette.flow.negative,
          },
          { id: 'total', label: t`Total`, color: totalColor },
        ]}
      />
      <div className={cn('min-h-0 w-full', fitHeight ? 'min-h-[200px] flex-1' : 'h-72 sm:h-96')}>
        <EChart option={option} ariaLabel={t`Waterfall chart`} className="h-full w-full" />
      </div>
    </div>
  );
}
