import { useMemo } from 'react';
import type { EChartsCoreOption } from 'echarts/core';
import { EChart } from '@shared/ui/echart';
import {
  useChartPalette,
  tooltipBase,
  tooltipHtml,
  BAR_MAX_WIDTH,
  type TooltipRow,
} from '@shared/lib/charts/echarts-chrome';
import type { MonthlyAssetPoint } from '@entities/account/api/useMonthlyAssetHistory';
import { asMilli, fromDecimal, toDecimal } from '@shared/lib/currency/milli';

interface AssetLiabilityHistoryChartProps {
  /** Amounts in integer milliunits (converted to decimal at the chart mapping below). */
  monthlyAssetHistory: MonthlyAssetPoint[];
  /** Integer milliunits. */
  netWorth: number;
  /** Milli-in currency formatter. */
  formatCurrency: (milli: number) => string;
}

const SERIES_LABELS = {
  cash: 'Cash',
  investments: 'Investments',
  retirement: 'Retirement',
  realEstate: 'Real Estate',
  otherAssets: 'Other Assets',
  loans: 'Loans',
  credit: 'Credit',
} as const;

type SeriesKey = keyof typeof SERIES_LABELS;

/** Assets stacked above zero, then liabilities stacked below (negative values). */
const SERIES_ORDER: SeriesKey[] = [
  'cash',
  'investments',
  'retirement',
  'realEstate',
  'otherAssets',
  'loans',
  'credit',
];

/** Stacked assets-vs-liabilities bar chart for the Accounts page sidebar "history" tab. */
export function AssetLiabilityHistoryChart({
  monthlyAssetHistory,
  netWorth,
  formatCurrency,
}: AssetLiabilityHistoryChartProps) {
  const palette = useChartPalette();

  // Asset categories take the validated series slots in fixed order; liability
  // reds/oranges keep the original destructive/warning semantics.
  const seriesColors: Record<SeriesKey, string> = useMemo(
    () => ({
      cash: palette.series[0],
      investments: palette.series[1],
      retirement: palette.series[2],
      realEstate: palette.series[3],
      otherAssets: palette.series[4],
      loans: palette.series[5],
      credit: palette.flow.negative,
    }),
    [palette]
  );

  const option = useMemo<EChartsCoreOption>(() => {
    const { chrome } = palette;
    // Transform data: decimal currency units for axes/tooltips, and liabilities
    // become negative for display below the X axis.
    const chartData = monthlyAssetHistory.map((point) => ({
      label: point.label,
      cash: toDecimal(asMilli(point.cash)),
      investments: toDecimal(asMilli(point.investments)),
      retirement: toDecimal(asMilli(point.retirement)),
      realEstate: toDecimal(asMilli(point.realEstate)),
      otherAssets: toDecimal(asMilli(point.otherAssets)),
      loans: -toDecimal(asMilli(point.loans)), // Negative for below-axis display
      credit: -toDecimal(asMilli(point.credit)), // Negative for below-axis display
    }));
    return {
      grid: { left: 8, right: 16, top: 16, bottom: 4, containLabel: true },
      xAxis: {
        type: 'category' as const,
        data: chartData.map((point) => point.label),
        axisLine: { lineStyle: { color: chrome.axisLine } },
        axisTick: { show: false },
        axisLabel: { color: chrome.axisText, fontSize: 11, hideOverlap: true },
      },
      yAxis: {
        type: 'value' as const,
        axisLine: { show: false },
        splitLine: { lineStyle: { color: chrome.grid, width: 1 } },
        axisLabel: {
          color: chrome.axisText,
          fontSize: 11,
          formatter: (value: number) => {
            const absValue = Math.abs(value);
            if (absValue >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
            if (absValue >= 1000) return `${(value / 1000).toFixed(0)}K`;
            return value.toString();
          },
        },
      },
      tooltip: {
        ...tooltipBase(chrome),
        trigger: 'axis' as const,
        axisPointer: { type: 'line' as const, lineStyle: { color: chrome.axisLine } },
        formatter: (params: unknown) => {
          const items = params as { dataIndex: number }[];
          const point = chartData[items[0]?.dataIndex ?? 0];
          if (!point) return '';
          // Plotted values are decimal; formatCurrency is milli-in.
          const rows: TooltipRow[] = SERIES_ORDER.map((key) => ({
            color: seriesColors[key],
            name: SERIES_LABELS[key],
            value: formatCurrency(fromDecimal(Math.abs(point[key]))),
          }));
          return tooltipHtml(point.label, rows);
        },
      },
      series: SERIES_ORDER.map((key, index) => ({
        name: SERIES_LABELS[key],
        type: 'bar' as const,
        stack: 'history',
        data: chartData.map((point) => point[key]),
        barMaxWidth: BAR_MAX_WIDTH,
        itemStyle: { color: seriesColors[key], borderColor: chrome.surface, borderWidth: 1 },
        ...(index === 0
          ? {
              markLine: {
                silent: true,
                symbol: 'none',
                label: { show: false },
                lineStyle: { color: chrome.axisLine, type: 'solid' as const, width: 1 },
                data: [{ yAxis: 0 }],
              },
            }
          : {}),
      })),
    };
  }, [monthlyAssetHistory, palette, seriesColors, formatCurrency]);

  return (
    <div className="space-y-4">
      <div className="text-sm font-medium text-muted-foreground">
        Asset & Liability History (24 months)
      </div>

      {monthlyAssetHistory.length === 0 ? (
        <div className="text-sm text-muted-foreground text-center py-8">
          No historical data available
        </div>
      ) : (
        <>
          <EChart
            option={option}
            className="h-[320px] w-full"
            ariaLabel="Asset and liability history"
          />
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
            {SERIES_ORDER.map((key) => (
              <span key={key} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: seriesColors[key] }}
                  aria-hidden
                />
                {SERIES_LABELS[key]}
              </span>
            ))}
          </div>
        </>
      )}

      {/* Net Worth trend line */}
      {monthlyAssetHistory.length > 0 && (
        <div className="pt-2 border-t">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Current Net Worth</span>
            <span className="font-bold">{formatCurrency(netWorth)}</span>
          </div>
          {monthlyAssetHistory.length >= 2 && (
            <div className="flex items-center justify-between text-xs mt-1">
              <span className="text-muted-foreground">vs {monthlyAssetHistory[0].label}</span>
              <span
                className={
                  netWorth - monthlyAssetHistory[0].netWorth >= 0
                    ? 'text-green-600'
                    : 'text-red-600'
                }
              >
                {netWorth - monthlyAssetHistory[0].netWorth >= 0 ? '+' : ''}
                {formatCurrency(netWorth - monthlyAssetHistory[0].netWorth)}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
