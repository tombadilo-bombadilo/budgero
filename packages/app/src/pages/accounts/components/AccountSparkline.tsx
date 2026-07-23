/**
 * Account Sparkline Component
 *
 * Displays a mini line chart showing account balance history.
 */

import { useMemo } from 'react';
import type { EChartsCoreOption } from 'echarts/core';
import { parseISO } from 'date-fns';
import { useAccountBalanceHistory } from '@entities/account/api/useAccountBalanceHistory';
import { useUiStore } from '@shared/store/useUiStore';
import { EChart } from '@shared/ui/echart';
import {
  escapeHtml,
  resolveCssColor,
  tooltipBase,
  useChartPalette,
} from '@shared/lib/charts/echarts-chrome';
import { asMilli, toDecimal } from '@shared/lib/currency/milli';

interface AccountSparklineProps {
  accountId: number;
  strokeColor: string;
  accountName: string;
  periodMonths?: number;
}

export function AccountSparkline({
  accountId,
  strokeColor,
  accountName,
  periodMonths = 1,
}: AccountSparklineProps) {
  const { data: sparklineData } = useAccountBalanceHistory(accountId, periodMonths);
  const globalLocalizer = useUiStore((s) => s.globalLocalizer);
  const palette = useChartPalette();

  const option = useMemo<EChartsCoreOption | null>(() => {
    if (!sparklineData || sparklineData.length === 0) return null;
    const { chrome } = palette;
    // strokeColor arrives as a CSS var (account-type token); canvas needs
    // the concrete value. palette in the deps re-resolves it on theme change.
    const stroke = resolveCssColor(strokeColor);

    // Chart values are decimal currency units.
    const points = sparklineData.map((point) => ({
      value: toDecimal(asMilli(point.balance)),
      date: parseISO(point.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    }));

    // Trend is exact in integer milliunits, converted for display below.
    const firstValue = sparklineData[0]?.balance || 0;
    const lastValue = sparklineData[sparklineData.length - 1]?.balance || 0;
    const change = lastValue - firstValue;
    const changePercent = firstValue !== 0 ? (change / Math.abs(firstValue)) * 100 : 0;

    return {
      grid: { left: 0, right: 0, top: 2, bottom: 2 },
      xAxis: { type: 'category' as const, show: false, data: points.map((p) => p.date) },
      yAxis: { type: 'value' as const, show: false, min: 'dataMin', max: 'dataMax' },
      tooltip: {
        ...tooltipBase(chrome),
        trigger: 'axis' as const,
        axisPointer: {
          type: 'line' as const,
          lineStyle: { color: stroke, opacity: 0.3, type: 'dashed' as const },
        },
        // The sparkline container is tiny — render the tooltip into <body>
        // so it isn't clipped (replaces the old giant z-index hack).
        appendToBody: true,
        formatter: (params: unknown) => {
          const items = params as { dataIndex: number }[];
          const point = points[items[0]?.dataIndex ?? 0];
          if (!point) return '';
          const changeLabel = `${change >= 0 ? '+' : ''}${globalLocalizer.format(toDecimal(asMilli(change)))}`;
          const percentLabel = `(${changePercent >= 0 ? '+' : ''}${changePercent.toFixed(1)}%)`;
          const percentColor = change >= 0 ? palette.flow.positive : palette.flow.negative;
          return (
            `<div style="min-width:180px;font-size:12px;">` +
            `<div style="font-weight:600;">${escapeHtml(accountName)}</div>` +
            `<div style="opacity:0.72;font-size:11px;margin-bottom:6px;">${escapeHtml(point.date)}</div>` +
            `<div style="font-weight:600;">${escapeHtml(globalLocalizer.format(point.value))}</div>` +
            `<div style="opacity:0.72;font-size:11px;margin-top:4px;">Period trend: ${escapeHtml(changeLabel)} ` +
            `<span style="color:${percentColor};">${escapeHtml(percentLabel)}</span></div>` +
            `</div>`
          );
        },
      },
      series: [
        {
          type: 'line' as const,
          data: points.map((p) => p.value),
          lineStyle: { color: stroke, width: 1.5 },
          itemStyle: { color: stroke },
          symbol: 'none',
          animation: false,
        },
      ],
    };
  }, [sparklineData, palette, strokeColor, accountName, globalLocalizer]);

  if (!option) {
    return (
      <div className="hidden sm:block w-12 sm:w-16 h-6 sm:h-8">
        <div className="w-full h-full flex items-center justify-center">
          <div className="text-xs text-muted-foreground">—</div>
        </div>
      </div>
    );
  }

  return (
    <div className="hidden sm:block w-12 sm:w-16 h-6 sm:h-8">
      <EChart
        option={option}
        ariaLabel={`${accountName} balance sparkline`}
        className="h-full w-full"
      />
    </div>
  );
}
