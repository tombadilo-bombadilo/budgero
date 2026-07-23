import { useMemo } from 'react';
import type { EChartsCoreOption } from 'echarts/core';
import { EChart } from '@shared/ui/echart';
import { tooltipBase, tooltipHtml, useChartPalette } from '@shared/lib/charts/echarts-chrome';

interface BalanceAreaChartProps {
  data: { date: string; balance: number }[];
  formatAmount: (value: number) => string;
  className: string;
  /** Override the default axis tick font size (e.g. 10 on mobile). */
  tickFontSize?: number;
}

/** The dashboard's cash-balance area chart, shared by the desktop and mobile pages. */
export function BalanceAreaChart({
  data,
  formatAmount,
  className,
  tickFontSize,
}: BalanceAreaChartProps) {
  const palette = useChartPalette();

  const option = useMemo<EChartsCoreOption>(() => {
    const { chrome } = palette;
    const color = palette.series[0];
    return {
      grid: { left: 8, right: 16, top: 16, bottom: 4, containLabel: true },
      xAxis: {
        type: 'category' as const,
        data: data.map((point) => point.date),
        axisLine: { lineStyle: { color: chrome.axisLine } },
        axisTick: { show: false },
        axisLabel: { color: chrome.axisText, fontSize: tickFontSize ?? 11, hideOverlap: true },
      },
      yAxis: { type: 'value' as const, show: false },
      tooltip: {
        ...tooltipBase(chrome),
        trigger: 'axis' as const,
        axisPointer: { type: 'line' as const, lineStyle: { color: chrome.axisLine } },
        formatter: (params: unknown) => {
          const items = params as { dataIndex: number }[];
          const point = data[items[0]?.dataIndex ?? 0];
          if (!point) return '';
          return tooltipHtml(point.date, [
            { color, name: 'Balance', value: formatAmount(point.balance) },
          ]);
        },
      },
      series: [
        {
          name: 'Balance',
          type: 'line' as const,
          data: data.map((point) => point.balance),
          lineStyle: { color, width: 2 },
          itemStyle: { color, borderColor: chrome.surface, borderWidth: 2 },
          symbol: 'circle',
          symbolSize: 8,
          showSymbol: data.length <= 30,
          areaStyle: { color, opacity: 0.1 },
        },
      ],
    };
  }, [data, formatAmount, palette, tickFontSize]);

  return <EChart option={option} className={className} ariaLabel="Cash balance over time" />;
}
