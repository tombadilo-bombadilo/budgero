import { memo, useMemo } from 'react';
import { format, parseISO } from 'date-fns';
import type { EChartsCoreOption } from 'echarts/core';
import { Card, CardContent } from '@shared/ui/card';
import { EChart } from '@shared/ui/echart';
import {
  useChartPalette,
  tooltipBase,
  tooltipHtml,
  type TooltipRow,
} from '@shared/lib/charts/echarts-chrome';
import type { SpendingChartProps } from './types';

export const SpendingChart = memo(function SpendingChart({
  cumulativeData,
  maxValue,
  shouldShowBudgetPace,
  globalLocalizer,
}: SpendingChartProps) {
  const palette = useChartPalette();

  const option = useMemo<EChartsCoreOption>(() => {
    const { chrome } = palette;
    const cumulativeColor = palette.series[0];
    const paceColor = palette.series[1];
    const paceState = (isOverPace: boolean) =>
      isOverPace
        ? { color: palette.flow.negative, name: 'Over pace' }
        : { color: palette.flow.positive, name: 'Under pace' };

    return {
      animation: false,
      grid: { left: 8, right: 8, top: 8, bottom: 4, containLabel: true },
      xAxis: {
        type: 'category' as const,
        data: cumulativeData.map((datum) => format(parseISO(datum.date), 'd')),
        boundaryGap: false,
        axisLine: { lineStyle: { color: chrome.axisLine } },
        axisTick: { show: false },
        axisLabel: { color: chrome.axisText, fontSize: 11, hideOverlap: true },
      },
      yAxis: {
        type: 'value' as const,
        min: 0,
        max: maxValue,
        axisLine: { show: false },
        splitLine: { lineStyle: { color: chrome.grid, width: 1 } },
        axisLabel: {
          color: chrome.axisText,
          fontSize: 11,
          formatter: (value: number) => {
            if (value >= 1000) return `${(value / 1000).toFixed(0)}K`;
            return value.toFixed(0);
          },
        },
      },
      tooltip: {
        ...tooltipBase(chrome),
        // Narrow container — render the tooltip into <body> so it isn't clipped.
        appendToBody: true,
        trigger: 'axis' as const,
        axisPointer: { type: 'line' as const, lineStyle: { color: chrome.axisLine } },
        formatter: (params: unknown) => {
          const items = params as { dataIndex: number }[];
          const datum = cumulativeData[items[0]?.dataIndex ?? 0];
          if (!datum) return '';
          const rows: TooltipRow[] = [
            {
              color: cumulativeColor,
              name: 'Cumulative',
              value: globalLocalizer.format(datum.cumulative),
            },
          ];
          if (shouldShowBudgetPace) {
            rows.push({
              color: paceColor,
              name: 'Budget Pace',
              value: globalLocalizer.format(datum.budgetPace),
            });
            const state = paceState(datum.isOverPace);
            rows.push({
              color: state.color,
              name: state.name,
              value: globalLocalizer.format(Math.abs(datum.budgetPace - datum.cumulative)),
            });
          }
          rows.push({
            color: chrome.inkPrimary,
            name: 'Daily',
            value: globalLocalizer.format(datum.value),
          });
          return tooltipHtml(format(parseISO(datum.date), 'MMM d'), rows);
        },
      },
      series: [
        {
          name: 'Cumulative Spending',
          type: 'line' as const,
          data: cumulativeData.map((datum) => datum.cumulative),
          lineStyle: { color: cumulativeColor, width: 2 },
          itemStyle: { color: cumulativeColor, borderColor: chrome.surface, borderWidth: 2 },
          symbol: 'none',
          areaStyle: { color: cumulativeColor, opacity: 0.1 },
        },
        ...(shouldShowBudgetPace
          ? [
              {
                name: 'Budget Pace',
                type: 'line' as const,
                data: cumulativeData.map((datum) => datum.budgetPace),
                lineStyle: { color: paceColor, width: 2, opacity: 0.7, type: [5, 5] },
                itemStyle: { color: paceColor, borderColor: chrome.surface, borderWidth: 2 },
                symbol: 'none',
              },
            ]
          : []),
      ],
    };
  }, [cumulativeData, maxValue, shouldShowBudgetPace, globalLocalizer, palette]);

  return (
    <Card>
      <CardContent className="p-3">
        <h3 className="text-sm font-medium text-muted-foreground mb-3">Spending Pattern</h3>
        {cumulativeData.length > 0 ? (
          <EChart option={option} ariaLabel="Spending pattern chart" className="h-32 w-full" />
        ) : (
          <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
            No spending data
          </div>
        )}
      </CardContent>
    </Card>
  );
});
