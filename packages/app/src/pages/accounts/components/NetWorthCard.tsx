/**
 * Net Worth Card Component
 *
 * Displays net worth summary with area chart.
 */

import { useMemo } from 'react';
import type { EChartsCoreOption } from 'echarts/core';
import { Card, CardContent } from '@shared/ui/card';
import { EChart } from '@shared/ui/echart';
import { tooltipBase, tooltipHtml, useChartPalette } from '@shared/lib/charts/echarts-chrome';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { cn } from '@shared/lib/utils';
import { parseISO } from 'date-fns';
import { trendTextClass } from '@shared/lib/amount-color';
import { asMilli, fromDecimal, toDecimal } from '@shared/lib/currency/milli';

interface NetWorthDataPoint {
  date: string;
  netWorth: number;
  totalAssets: number;
  totalLiabilities: number;
}

interface NetWorthCardProps {
  /** Integer milliunits. */
  netWorth: number;
  /** Integer milliunits. */
  netWorthChange: number;
  periodLabel: string;
  /** Amounts in integer milliunits (converted to decimal at the chart mapping below). */
  chartData: NetWorthDataPoint[];
  /** Milli-in currency formatter. */
  formatCurrency: (milli: number) => string;
}

export function NetWorthCard({
  netWorth,
  netWorthChange,
  periodLabel,
  chartData,
  formatCurrency,
}: NetWorthCardProps) {
  const changePercent =
    netWorth - netWorthChange !== 0 ? (netWorthChange / (netWorth - netWorthChange)) * 100 : 0;

  const palette = useChartPalette();

  const option = useMemo<EChartsCoreOption>(() => {
    const { chrome } = palette;
    const color = palette.series[0];
    // Chart values are decimal currency units; stored points are milliunits.
    const points = chartData.map((point) => ({
      date: point.date,
      value: toDecimal(asMilli(point.netWorth)),
    }));
    return {
      grid: { left: 8, right: 16, top: 16, bottom: 4, containLabel: true },
      xAxis: {
        type: 'category' as const,
        data: points.map((point) => {
          const date = parseISO(point.date);
          return `${date.getMonth() + 1}/${date.getDate()}`;
        }),
        axisLine: { lineStyle: { color: chrome.axisLine } },
        axisTick: { show: false },
        axisLabel: { color: chrome.axisText, fontSize: 11, hideOverlap: true },
      },
      yAxis: { type: 'value' as const, show: false },
      tooltip: {
        ...tooltipBase(chrome),
        trigger: 'axis' as const,
        axisPointer: { type: 'line' as const, lineStyle: { color: chrome.axisLine } },
        formatter: (params: unknown) => {
          const items = params as { dataIndex: number }[];
          const point = points[items[0]?.dataIndex ?? 0];
          if (!point) return '';
          const title = parseISO(point.date).toLocaleDateString('en-US', {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
          });
          // Plotted values are decimal; formatCurrency is milli-in.
          return tooltipHtml(title, [
            { color, name: 'Net Worth', value: formatCurrency(fromDecimal(point.value)) },
          ]);
        },
      },
      series: [
        {
          name: 'Net Worth',
          type: 'line' as const,
          data: points.map((point) => point.value),
          lineStyle: { color, width: 2 },
          itemStyle: { color, borderColor: chrome.surface, borderWidth: 2 },
          symbol: 'circle',
          symbolSize: 8,
          showSymbol: points.length <= 30,
          areaStyle: { color, opacity: 0.1 },
        },
      ],
    };
  }, [chartData, formatCurrency, palette]);

  return (
    <Card>
      <CardContent className="p-4 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-4 gap-4 sm:gap-0">
          <div>
            <div className="text-sm text-muted-foreground mb-1">NET WORTH</div>
            <div className="text-2xl sm:text-3xl font-bold">{formatCurrency(netWorth)}</div>
            <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2 mt-2">
              <div
                className={cn(
                  'flex items-center gap-1 text-sm font-medium',
                  trendTextClass(netWorthChange)
                )}
              >
                {netWorthChange >= 0 ? (
                  <TrendingUp className="h-4 w-4" />
                ) : (
                  <TrendingDown className="h-4 w-4" />
                )}
                {formatCurrency(Math.abs(netWorthChange))} ({changePercent.toFixed(1)}%)
              </div>
              <span className="text-sm text-muted-foreground">{periodLabel} change</span>
            </div>
          </div>
          <div className="text-left sm:text-right">
            <div className="text-sm text-muted-foreground">Net worth performance</div>
            <div className="text-xs text-muted-foreground mt-1">{periodLabel}</div>
          </div>
        </div>

        {/* Net Worth Chart */}
        <div className="h-32 sm:h-48 w-full">
          <EChart option={option} className="h-full w-full" ariaLabel="Net worth performance" />
        </div>
      </CardContent>
    </Card>
  );
}
