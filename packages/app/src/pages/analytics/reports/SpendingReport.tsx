import { useMemo, useState } from 'react';
import type { EChartsCoreOption } from 'echarts/core';
import { CalendarRange, ChartPie, BarChartHorizontal, LayoutGrid } from 'lucide-react';
import { EChart } from '@shared/ui/echart';
import { AnimatedNumber } from '@shared/ui/animated-number';
import {
  buildDimensionTotals,
  buildTrendSeries,
  foldTopN,
  type SpendingDimension,
} from '../analytics-model';
import { spendingInsights } from '../insights';
import type { AnalyticsData } from '../useAnalyticsData';
import {
  BASE_GRID,
  BAR_MAX_WIDTH,
  inkOnFill,
  monthAxis,
  moneyAxis,
  shortMonthLabel,
  tooltipBase,
  tooltipHtml,
  useMoneyFormatters,
  usePalette,
} from '../components/chart-utils';
import { ModeToggle, ReportShell } from '../components/ReportShell';
import { InsightStrip, PanelSectionTitle, ProportionRow, StatTile } from '../components/panels';

type SpendingView = 'time' | 'share';
type ShareStyle = 'donut' | 'columns' | 'treemap';

const DIM_LABELS: Record<SpendingDimension, string> = {
  category: 'Categories',
  group: 'Groups',
  payee: 'Payees',
  label: 'Labels',
};

const MAX_SLICES = 8;

interface SpendingReportProps {
  data: AnalyticsData;
  months: string[];
}

/**
 * Spending: one report for "where does it go" — over time (stacked months)
 * or as a share of the period (donut/rose/columns/treemap), across any
 * dimension. The side panel always carries the full ranked list.
 */
export function SpendingReport({ data, months }: SpendingReportProps) {
  const [view, setView] = useState<SpendingView>('time');
  const [shareStyle, setShareStyle] = useState<ShareStyle>('donut');
  const [dim, setDim] = useState<SpendingDimension>('category');
  const palette = usePalette();
  const money = useMoneyFormatters();

  const totals = useMemo(
    () => buildDimensionTotals(data.txns, dim, data.onBudgetAccountIds),
    [data.txns, dim, data.onBudgetAccountIds]
  );
  const folded = useMemo(() => foldTopN(totals, MAX_SLICES), [totals]);
  const trendSeries = useMemo(
    () => buildTrendSeries(data.txns, months, dim, data.onBudgetAccountIds, MAX_SLICES),
    [data.txns, months, dim, data.onBudgetAccountIds]
  );

  const coloredTrend = useMemo(
    () =>
      trendSeries.map((entry, index) => ({
        ...entry,
        color:
          entry.key === 'other'
            ? palette.chrome.other
            : (entry.ownColor ?? palette.series[index % palette.series.length]),
      })),
    [trendSeries, palette]
  );

  const slices = useMemo(() => {
    const rows = folded.other ? [...folded.top, folded.other] : folded.top;
    const foldedCount = totals.length - folded.top.length;
    return rows.map((row, index) => ({
      ...row,
      name: row.key === 'other' ? `Other (${foldedCount} more)` : row.name,
      color:
        row.key === 'other'
          ? palette.chrome.other
          : (row.ownColor ?? palette.series[index % palette.series.length]),
    }));
  }, [folded, totals, palette]);

  const panelRows = useMemo(
    () =>
      totals.map((row, index) => ({
        ...row,
        color:
          index < MAX_SLICES
            ? (row.ownColor ?? palette.series[index % palette.series.length])
            : palette.chrome.other,
      })),
    [totals, palette]
  );

  const total = folded.grandTotal;
  const monthCount = Math.max(1, months.length);
  const isEmpty = total <= 0;
  const top = panelRows[0];

  const insights = useMemo(
    () =>
      spendingInsights(trendSeries, {
        money: (milli) => money.amount(milli),
        monthLabel: shortMonthLabel,
      }),
    [trendSeries, money]
  );

  const option = useMemo<EChartsCoreOption>(() => {
    const { chrome } = palette;
    if (view === 'time') {
      return {
        grid: BASE_GRID,
        xAxis: monthAxis(months, chrome),
        yAxis: moneyAxis(chrome, money.compact),
        tooltip: {
          ...tooltipBase(chrome),
          trigger: 'axis' as const,
          axisPointer: { type: 'line' as const, lineStyle: { color: chrome.axisLine } },
          formatter: (params: unknown) => {
            const items = params as { dataIndex: number }[];
            const index = items[0]?.dataIndex ?? 0;
            const rows = coloredTrend
              .filter((entry) => entry.values[index] > 0)
              .map((entry) => ({
                color: entry.color,
                name: entry.name,
                value: money.amount(entry.values[index]),
              }));
            const monthTotal = coloredTrend.reduce((sum, entry) => sum + entry.values[index], 0);
            return tooltipHtml(
              `${shortMonthLabel(months[index])} — ${money.amount(monthTotal)}`,
              rows
            );
          },
        },
        series: coloredTrend.map((entry) => ({
          name: entry.name,
          type: 'bar' as const,
          stack: 'spending',
          data: entry.values.map((value) => value / 1000),
          barMaxWidth: BAR_MAX_WIDTH,
          itemStyle: { color: entry.color, borderColor: chrome.surface, borderWidth: 1 },
        })),
      };
    }

    const itemTooltip = {
      ...tooltipBase(chrome),
      trigger: 'item' as const,
      formatter: (params: unknown) => {
        const item = params as { name: string; value: number; color?: string };
        const percent = total > 0 ? ((item.value * 1000) / total) * 100 : 0;
        return tooltipHtml(DIM_LABELS[dim], [
          {
            color: typeof item.color === 'string' ? item.color : chrome.other,
            name: `${item.name} · ${percent.toFixed(1)}%`,
            value: money.amount(Math.round(item.value * 1000)),
          },
        ]);
      },
    };
    if (shareStyle === 'donut') {
      return {
        tooltip: itemTooltip,
        series: [
          {
            type: 'pie',
            radius: ['48%', '74%'],
            padAngle: 1,
            data: slices.map((slice) => ({
              name: slice.name,
              value: slice.total / 1000,
              itemStyle: { color: slice.color, borderColor: chrome.surface, borderWidth: 2 },
            })),
            label: {
              color: chrome.inkPrimary,
              fontSize: 12,
              formatter: (params: { name: string; percent?: number }) =>
                (params.percent ?? 0) > 5 ? `${params.name}\n${params.percent?.toFixed(0)}%` : '',
            },
            labelLine: { lineStyle: { color: chrome.axisLine } },
            emphasis: { scaleSize: 4 },
          },
        ],
      };
    }
    if (shareStyle === 'columns') {
      const reversed = [...slices].reverse();
      return {
        grid: { left: 8, right: 48, top: 8, bottom: 4, containLabel: true },
        tooltip: itemTooltip,
        xAxis: moneyAxis(chrome, money.compact),
        yAxis: {
          type: 'category' as const,
          data: reversed.map((slice) => slice.name),
          axisLine: { lineStyle: { color: chrome.axisLine } },
          axisTick: { show: false },
          axisLabel: { color: chrome.inkSecondary, fontSize: 12, width: 110, overflow: 'truncate' },
        },
        series: [
          {
            type: 'bar',
            data: reversed.map((slice) => ({
              value: slice.total / 1000,
              itemStyle: { color: slice.color, borderRadius: [0, 4, 4, 0] },
            })),
            barMaxWidth: 24,
            label: {
              show: true,
              position: 'right' as const,
              color: chrome.inkSecondary,
              fontSize: 11,
              formatter: (params: { value?: number | string }) =>
                money.compact(Math.round(Number(params.value ?? 0) * 1000)),
            },
          },
        ],
      };
    }
    return {
      tooltip: itemTooltip,
      series: [
        {
          type: 'treemap',
          roam: false,
          nodeClick: false,
          breadcrumb: { show: false },
          itemStyle: { borderColor: chrome.surface, borderWidth: 2, gapWidth: 2 },
          label: { fontSize: 12, formatter: (params: { name: string }) => params.name },
          data: slices.map((slice) => ({
            name: slice.name,
            value: slice.total / 1000,
            itemStyle: { color: slice.color },
            label: { color: inkOnFill(slice.color) },
          })),
        },
      ],
    };
  }, [view, shareStyle, dim, months, coloredTrend, slices, total, palette, money]);

  return (
    <ReportShell
      title="Spending"
      hero={
        <AnimatedNumber
          value={total}
          formatter={(value) => money.amount(value)}
          rounding="integer"
        />
      }
      subtitle="Where the money goes"
      controls={
        <>
          <ModeToggle
            value={dim}
            onChange={setDim}
            ariaLabel="Spending dimension"
            options={[
              { value: 'category', label: 'Categories' },
              { value: 'group', label: 'Groups' },
              { value: 'payee', label: 'Payees' },
              { value: 'label', label: 'Labels' },
            ]}
          />
          <ModeToggle
            value={view}
            onChange={setView}
            ariaLabel="Spending view"
            options={[
              { value: 'time', label: 'Over time', icon: CalendarRange },
              { value: 'share', label: 'Share', icon: ChartPie },
            ]}
          />
          {view === 'share' ? (
            <ModeToggle
              value={shareStyle}
              onChange={setShareStyle}
              ariaLabel="Share chart style"
              options={[
                { value: 'donut', label: 'Donut', icon: ChartPie },
                { value: 'columns', label: 'Columns', icon: BarChartHorizontal },
                { value: 'treemap', label: 'Treemap', icon: LayoutGrid },
              ]}
            />
          ) : null}
        </>
      }
      insights={<InsightStrip insights={insights} />}
      chart={
        <EChart
          option={option}
          ariaLabel={`Spending by ${DIM_LABELS[dim]}`}
          className="h-[420px]"
        />
      }
      isLoading={data.isLoading}
      isEmpty={isEmpty}
      emptyText={
        dim === 'label' ? 'No labeled spending in this period.' : 'No spending in this period.'
      }
      panel={
        <>
          <div className="grid grid-cols-2 gap-2">
            <StatTile label="Total" value={money.tile(total)} />
            <StatTile label="Avg / month" value={money.tile(Math.round(total / monthCount))} />
            <StatTile
              label={`Top ${DIM_LABELS[dim].replace(/s$/, '').toLowerCase()}`}
              value={top?.name ?? '—'}
              detail={
                top && total > 0
                  ? `${((top.total / total) * 100).toFixed(0)}% of spending`
                  : undefined
              }
            />
            <StatTile
              label={DIM_LABELS[dim]}
              value={String(totals.length)}
              detail={folded.other ? `top ${MAX_SLICES} charted` : undefined}
            />
          </div>
          {dim === 'label' ? (
            <p className="mt-3 text-xs text-muted-foreground">
              A transaction with several labels counts in full under each, so labels can overlap.
            </p>
          ) : null}
          <PanelSectionTitle>{DIM_LABELS[dim]}</PanelSectionTitle>
          <div className="max-h-[420px] overflow-y-auto pr-1">
            {panelRows.map((row) => (
              <ProportionRow
                key={row.key}
                color={row.color}
                name={row.name}
                value={money.amount(row.total)}
                fraction={top && top.total > 0 ? row.total / top.total : 0}
              />
            ))}
          </div>
        </>
      }
    />
  );
}
