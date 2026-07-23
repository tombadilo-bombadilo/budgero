import { useMemo } from 'react';
import { format, parseISO, differenceInCalendarDays, subDays } from 'date-fns';
import { TrendingUp, TrendingDown, ArrowUpRight } from 'lucide-react';
import type { EChartsCoreOption } from 'echarts/core';

import { Card, CardHeader, CardTitle, CardContent } from '@shared/ui/card';
import { EChart } from '@shared/ui/echart';
import {
  useChartPalette,
  tooltipBase,
  tooltipHtml,
  BAR_MAX_WIDTH,
  BAR_RADIUS_TOP,
  BAR_RADIUS_BOTTOM,
  type TooltipRow,
} from '@shared/lib/charts/echarts-chrome';
import { useIncomeExpenseByPeriod } from '@features/analytics/api/useAnalyticsQueries';
import { useFormatMaskedAmount } from '@shared/lib/privacy/useMaskedLocalizer';
import { useCompactNumberFormat } from '@shared/lib/useCompactNumberFormat';
import { asMilli, toDecimal } from '@shared/lib/currency/milli';

type CashflowTrendCardProps = {
  budgetId: number;
  globalLocalizer: Intl.NumberFormat;
  startDate?: string;
  endDate?: string;
};

const DEFAULT_WINDOW_DAYS = 84; // roughly 12 weeks
const MONTH_THRESHOLD_DAYS = 210;

export function CashflowTrendCard({
  budgetId,
  globalLocalizer,
  startDate,
  endDate,
}: CashflowTrendCardProps) {
  const compactFormatter = useCompactNumberFormat(globalLocalizer.resolvedOptions().locale);
  const today = new Date();
  const effectiveEndDate = endDate && endDate.length > 0 ? endDate : format(today, 'yyyy-MM-dd');
  const effectiveStartDate =
    startDate && startDate.length > 0
      ? startDate
      : format(subDays(parseISO(effectiveEndDate), DEFAULT_WINDOW_DAYS - 1), 'yyyy-MM-dd');

  const rangeDays = Math.max(
    1,
    differenceInCalendarDays(parseISO(effectiveEndDate), parseISO(effectiveStartDate))
  );
  const grouping: 'week' | 'month' = rangeDays > MONTH_THRESHOLD_DAYS ? 'month' : 'week';

  const { data: incomeExpense = [], isLoading } = useIncomeExpenseByPeriod(
    effectiveStartDate,
    effectiveEndDate,
    budgetId,
    grouping
  );

  const chartData = useMemo(() => {
    return incomeExpense.map((row) => {
      const parsedStart = parseISO(row.PeriodStart);
      const parsedEnd = parseISO(row.PeriodEnd);
      const label =
        grouping === 'week'
          ? `${format(parsedStart, 'MMM d')} - ${format(parsedEnd, 'MMM d')}`
          : format(parsedStart, 'MMM yyyy');
      // Chart data is decimal currency units; convert from stored milliunits here.
      const net = toDecimal(asMilli(row.TotalIncome - row.TotalExpense));
      return {
        label,
        income: toDecimal(row.TotalIncome),
        expense: toDecimal(row.TotalExpense),
        net,
      };
    });
  }, [incomeExpense, grouping]);

  const totals = useMemo(() => {
    return chartData.reduce(
      (acc, item) => {
        acc.income += item.income;
        acc.expense += item.expense;
        acc.net += item.net;
        return acc;
      },
      { income: 0, expense: 0, net: 0 }
    );
  }, [chartData]);

  const netPositive = totals.net >= 0;
  const DeltaIcon = netPositive ? TrendingUp : TrendingDown;
  const netClass = netPositive ? 'text-green-600' : 'text-red-600 dark:text-red-300';

  const palette = useChartPalette();
  const formatAmount = useFormatMaskedAmount(globalLocalizer);

  const option = useMemo<EChartsCoreOption>(() => {
    const { chrome, flow } = palette;
    return {
      grid: { left: 8, right: 16, top: 16, bottom: 4, containLabel: true },
      xAxis: {
        type: 'category' as const,
        data: chartData.map((item) => item.label),
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
          formatter: (value: number) => compactFormatter.format(value),
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
          const rows: TooltipRow[] = [
            { color: chrome.inkPrimary, name: 'Net', value: formatAmount(point.net) },
            { color: flow.positive, name: 'Money in', value: formatAmount(point.income) },
            { color: flow.negative, name: 'Money out', value: formatAmount(-point.expense) },
          ];
          return tooltipHtml(point.label, rows);
        },
      },
      // One encoding, mirrored around zero: income grows up, spending grows
      // down, and the net line rides on top — the same form as the Cash Flow
      // report, so the dashboard and analytics read identically.
      series: [
        {
          name: 'Money in',
          type: 'bar' as const,
          stack: 'flow',
          data: chartData.map((item) => item.income),
          barMaxWidth: BAR_MAX_WIDTH,
          itemStyle: { color: flow.positive, borderRadius: BAR_RADIUS_TOP },
        },
        {
          name: 'Money out',
          type: 'bar' as const,
          stack: 'flow',
          data: chartData.map((item) => -item.expense),
          barMaxWidth: BAR_MAX_WIDTH,
          itemStyle: { color: flow.negative, borderRadius: BAR_RADIUS_BOTTOM },
        },
        {
          name: 'Net',
          type: 'line' as const,
          data: chartData.map((item) => item.net),
          lineStyle: { color: chrome.inkPrimary, width: 2 },
          itemStyle: { color: chrome.inkPrimary, borderColor: chrome.surface, borderWidth: 2 },
          symbol: 'circle',
          symbolSize: 8,
          z: 3,
        },
      ],
    };
  }, [chartData, palette, compactFormatter, formatAmount]);

  return (
    <Card className="h-full">
      <CardHeader className="pb-1">
        <CardTitle className="flex items-center gap-2 text-base font-semibold">
          <ArrowUpRight className="h-5 w-5 text-muted-foreground" />
          Cashflow trends
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-lg bg-muted/30 px-3 py-2.5 text-sm space-y-1.5">
          <div className="flex items-center justify-between gap-4">
            <span className="text-xs text-muted-foreground">Income</span>
            <span className="font-semibold tabular-nums text-foreground">
              {formatAmount(totals.income)}
            </span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-xs text-muted-foreground">Spending</span>
            <span className="font-semibold tabular-nums text-foreground">
              {formatAmount(totals.expense)}
            </span>
          </div>
          <div className="border-t border-border/40 pt-1.5 flex items-center justify-between gap-4">
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              Net cashflow
              <DeltaIcon className={`h-3.5 w-3.5 ${netClass}`} />
            </span>
            <span className={`font-semibold tabular-nums ${netClass}`}>
              {netPositive ? '+' : '−'}
              {formatAmount(Math.abs(totals.net))}
            </span>
          </div>
        </div>

        <EChart option={option} className="h-[260px] w-full" ariaLabel="Cashflow trends chart" />

        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
          {[
            { color: palette.flow.positive, label: 'Money in' },
            { color: palette.flow.negative, label: 'Money out' },
            { color: palette.chrome.inkPrimary, label: 'Net' },
          ].map((item) => (
            <span
              key={item.label}
              className="flex items-center gap-1.5 text-xs text-muted-foreground"
            >
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: item.color }}
                aria-hidden
              />
              {item.label}
            </span>
          ))}
        </div>

        {isLoading && (
          <div className="text-xs text-muted-foreground text-center">Loading cashflow data…</div>
        )}
      </CardContent>
    </Card>
  );
}
