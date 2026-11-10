import { Trans, useLingui } from '@lingui/react/macro';
import { useMemo, useState } from 'react';
import type { EChartsCoreOption } from 'echarts/core';
import { CalendarRange, ChartPie, BarChartHorizontal, LayoutGrid } from 'lucide-react';
import { EChart } from '@shared/ui/echart';
import {
  buildDimensionTotals,
  buildTrendSeries,
  foldTopN,
  type SpendingDimension,
} from '../analytics-model';
import { spendingInsights } from '../insights';
import type { AnalyticsData } from '../useAnalyticsData';
import {
  BAR_MAX_WIDTH,
  BASE_GRID,
  inkOnFill,
  longMonthLabel,
  moneyAxis,
  monthAxis,
  shortMonthLabel,
  tooltipBase,
  tooltipHtml,
  useMoneyFormatters,
  usePalette,
} from '../components/chart-utils';
import { KeyFigures, ReportLayout, ViewSwitch } from '../components/ReportLayout';
import { BreakdownTable } from '../components/LedgerTable';
import { InsightStrip } from '../components/panels';
import { reportMeta } from '../report-questions';
import { spendingAnswer } from '../report-answers';
import { formatPercent } from '../format-percent';

type SpendingView = 'time' | 'share';
type ShareStyle = 'donut' | 'columns' | 'treemap';

const MAX_SLICES = 8;

interface SpendingReportProps {
  data: AnalyticsData;
  months: string[];
}

/**
 * Spending: one report for "where does it go" — over time (stacked months)
 * or as a share of the period (donut/rose/columns/treemap), across any
 * dimension. The chart and side panel fold long tails into Other, then expand
 * the hidden entries together when that bucket is selected.
 */
export function SpendingReport({ data, months }: SpendingReportProps) {
  const { t } = useLingui();

  const DIM_LABELS: Record<SpendingDimension, string> = useMemo(
    () => ({
      category: t`Categories`,
      group: t`Groups`,
      payee: t`Payees`,
      label: t`Labels`,
    }),
    [t]
  );

  const topLabels = {
    category: t`Top category`,
    group: t`Top group`,
    payee: t`Top payee`,
    label: t`Top label`,
  };
  const [view, setView] = useState<SpendingView>('time');
  const [shareStyle, setShareStyle] = useState<ShareStyle>('donut');
  const [dim, setDim] = useState<SpendingDimension>('category');
  const [otherOpen, setOtherOpen] = useState(false);
  const palette = usePalette();
  const money = useMoneyFormatters();

  const totals = useMemo(
    () => buildDimensionTotals(data.txns, dim, data.onBudgetAccountIds),
    [data.txns, dim, data.onBudgetAccountIds]
  );
  const folded = useMemo(() => foldTopN(totals, MAX_SLICES), [totals]);
  const showingOther = otherOpen && Boolean(folded.other);
  const trendSeries = useMemo(
    () =>
      buildTrendSeries(
        data.txns,
        months,
        dim,
        data.onBudgetAccountIds,
        showingOther ? Math.max(totals.length, MAX_SLICES) : MAX_SLICES
      ),
    [data.txns, months, dim, data.onBudgetAccountIds, showingOther, totals.length]
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
    const rows = showingOther ? totals : folded.other ? [...folded.top, folded.other] : folded.top;
    const foldedCount = totals.length - folded.top.length;
    return rows.map((row, index) => ({
      ...row,
      name: row.key === 'other' ? t`Other (${foldedCount} more)` : row.name,
      color:
        row.key === 'other'
          ? palette.chrome.other
          : (row.ownColor ?? palette.series[index % palette.series.length]),
    }));
  }, [folded, totals, palette, showingOther, t]);

  // Per-entry monthly values for the table's trend column; Other sums the
  // folded tail so its sparkline matches its amount.
  const trendByKey = useMemo(() => {
    const all = buildTrendSeries(
      data.txns,
      months,
      dim,
      data.onBudgetAccountIds,
      Math.max(totals.length, 1)
    );
    const map = new Map(all.map((series) => [series.key, series.values]));
    const topKeys = new Set(folded.top.map((row) => row.key));
    const otherValues = months.map((_, index) =>
      all.reduce((sum, series) => (topKeys.has(series.key) ? sum : sum + series.values[index]), 0)
    );
    map.set('other', otherValues);
    return map;
  }, [data.txns, months, dim, data.onBudgetAccountIds, totals.length, folded.top]);

  const tableRows = useMemo(() => {
    const rows = showingOther ? totals : folded.other ? [...folded.top, folded.other] : folded.top;
    const foldedCount = totals.length - folded.top.length;
    return rows.map((row, index) => {
      const isOther = row.key === 'other';
      return {
        key: row.key,
        name: isOther ? t`Other (${foldedCount} more)` : row.name,
        amount: row.total,
        color: isOther
          ? palette.chrome.other
          : (row.ownColor ?? palette.series[index % palette.series.length]),
        trend: trendByKey.get(row.key),
        onSelect: isOther ? () => setOtherOpen(true) : undefined,
      };
    });
  }, [folded, totals, showingOther, palette, trendByKey, t]);

  const total = folded.grandTotal;
  const monthCount = Math.max(1, months.length);
  const isEmpty = total <= 0;
  const top = totals[0];

  const insights = useMemo(
    () =>
      spendingInsights(trendSeries, {
        money: (milli) => money.amount(milli),
        monthLabel: longMonthLabel,
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
          cursor: entry.key === 'other' ? 'pointer' : 'default',
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
            name: `${item.name} · ${formatPercent(percent, 1)}`,
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
              cursor: slice.key === 'other' ? 'pointer' : 'default',
              itemStyle: { color: slice.color, borderColor: chrome.surface, borderWidth: 2 },
            })),
            label: {
              color: chrome.inkPrimary,
              fontSize: 12,
              formatter: (params: { name: string; percent?: number }) =>
                (params.percent ?? 0) > 5
                  ? `${params.name}\n${formatPercent(params.percent ?? 0)}`
                  : '',
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
              cursor: slice.key === 'other' ? 'pointer' : 'default',
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
            cursor: slice.key === 'other' ? 'pointer' : 'default',
            itemStyle: { color: slice.color },
            label: { color: inkOnFill(slice.color) },
          })),
        },
      ],
    };
  }, [view, shareStyle, dim, months, coloredTrend, slices, total, palette, money, DIM_LABELS]);

  const answer = spendingAnswer(
    {
      total,
      firstMonth: months[0] ?? null,
      top: top && total > 0 ? { name: top.name, share: top.total / total } : null,
    },
    { money: (milli) => money.amount(milli), monthLabel: longMonthLabel }
  );

  return (
    <ReportLayout
      question={reportMeta('spending').question}
      answer={answer}
      toolbar={
        <>
          <ViewSwitch
            label={t`Show`}
            value={view}
            onChange={setView}
            options={[
              { value: 'time', label: t`Over time`, icon: CalendarRange },
              { value: 'share', label: t`Spending share`, icon: ChartPie },
            ]}
          />
          <ViewSwitch
            label={t`By`}
            value={dim}
            onChange={(nextDim) => {
              setDim(nextDim);
              setOtherOpen(false);
            }}
            options={[
              { value: 'category', label: t`Categories` },
              { value: 'group', label: t`Groups` },
              { value: 'payee', label: t`Payees` },
              { value: 'label', label: t`Labels` },
            ]}
          />
          {view === 'share' ? (
            <ViewSwitch
              label={t`Chart`}
              value={shareStyle}
              onChange={setShareStyle}
              options={[
                { value: 'donut', label: t`Donut`, icon: ChartPie },
                { value: 'columns', label: t`Columns`, icon: BarChartHorizontal },
                { value: 'treemap', label: t`Treemap`, icon: LayoutGrid },
              ]}
            />
          ) : null}
        </>
      }
      insights={<InsightStrip insights={insights} />}
      chart={
        <EChart
          option={option}
          ariaLabel={t`Spending by ${DIM_LABELS[dim]}`}
          className="h-[420px]"
          onMarkClick={(mark) => {
            const isOther =
              view === 'time'
                ? coloredTrend.some(
                    (series) => series.key === 'other' && series.name === mark.seriesName
                  )
                : slices[mark.dataIndex]?.key === 'other';
            if (isOther) {
              setOtherOpen(true);
            }
          }}
        />
      }
      isLoading={data.isLoading}
      isEmpty={isEmpty}
      emptyText={
        dim === 'label' ? t`No labeled spending in this period.` : t`No spending in this period.`
      }
      figures={
        <KeyFigures
          items={[
            { label: t`Total`, value: money.tile(total) },
            { label: t`Avg / month`, value: money.tile(Math.round(total / monthCount)) },
            {
              label: topLabels[dim],
              value: top?.name ?? '—',
              detail:
                top && total > 0
                  ? t`${formatPercent((top.total / total) * 100)} of spending`
                  : undefined,
            },
            { label: DIM_LABELS[dim], value: String(totals.length) },
          ]}
        />
      }
    >
      {isEmpty ? null : (
        <BreakdownTable
          title={showingOther ? t`${DIM_LABELS[dim]} · Other expanded` : DIM_LABELS[dim]}
          nameHeader={t`Name`}
          rows={tableRows}
          total={total}
          money={money.amount}
          maxHeightClassName="max-h-[520px]"
          actions={
            showingOther ? (
              <button
                type="button"
                onClick={() => setOtherOpen(false)}
                className="text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <Trans>← Collapse Other</Trans>
              </button>
            ) : null
          }
          footnote={
            dim === 'label' ? (
              <Trans>
                A transaction with several labels counts in full under each, so labels can overlap.
              </Trans>
            ) : undefined
          }
        />
      )}
    </ReportLayout>
  );
}
