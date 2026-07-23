import type { EChartsCoreOption } from 'echarts/core';
import { EChart } from '@shared/ui/echart';
import {
  useChartPalette,
  tooltipBase,
  tooltipHtml,
  type TooltipRow,
} from '@shared/lib/charts/echarts-chrome';
import { ChartEmptyState } from '@shared/ui/ChartEmptyState';
import { useSpendingByDates } from '@features/analytics/api/useAnalyticsQueries';
import { useUiStore } from '@shared/store/useUiStore';
import { useMemo } from 'react';
import { format, eachDayOfInterval, differenceInDays, subDays } from 'date-fns';
import { asMilli, toDecimal } from '@shared/lib/currency/milli';

export function SpendingOverviewContent() {
  const selectedBudget = useUiStore((state) => state.selectedBudget);
  const globalLocalizer = useUiStore((state) => state.globalLocalizer);
  const dateRange = useUiStore((state) => state.dateRange);
  const palette = useChartPalette();

  const budgetId = selectedBudget?.ID || 0;

  const { data: spendingData, isLoading: isLoadingSpending } = useSpendingByDates(
    dateRange?.from ? format(dateRange.from, 'yyyy-MM-dd') : '',
    dateRange?.to ? format(dateRange.to, 'yyyy-MM-dd') : '',
    budgetId
  );

  const previousPeriodRange = useMemo(() => {
    if (!dateRange?.from || !dateRange?.to) return null;

    const daysDiff = differenceInDays(dateRange.to, dateRange.from) + 1;
    const previousFrom = subDays(dateRange.from, daysDiff);
    const previousTo = subDays(dateRange.from, 1);

    return {
      from: previousFrom,
      to: previousTo,
    };
  }, [dateRange]);

  const { data: previousSpendingData } = useSpendingByDates(
    previousPeriodRange?.from ? format(previousPeriodRange.from, 'yyyy-MM-dd') : '',
    previousPeriodRange?.to ? format(previousPeriodRange.to, 'yyyy-MM-dd') : '',
    budgetId
  );

  const formattedData = useMemo(() => {
    if (!spendingData || spendingData.length === 0 || !dateRange?.from || !dateRange?.to) return [];

    const spendingMap = new Map();
    spendingData.forEach((item) => {
      spendingMap.set(item.Date, item.Spending);
    });

    // Create a map of previous period spending data by date index
    const previousSpendingMap = new Map();
    if (previousSpendingData && previousPeriodRange) {
      const previousDates = eachDayOfInterval({
        start: previousPeriodRange.from,
        end: previousPeriodRange.to,
      });

      let previousCumulative = 0;
      previousDates.forEach((date, index) => {
        const dateStr = format(date, 'yyyy-MM-dd');
        const previousItem = previousSpendingData.find((item) => item.Date === dateStr);
        previousCumulative += previousItem?.Spending || 0;
        previousSpendingMap.set(index, previousCumulative);
      });
    }

    const allDates = eachDayOfInterval({
      start: dateRange.from,
      end: dateRange.to,
    });

    // Sums run in exact integer milliunits; chart data is decimal currency
    // units, converted at this mapping (axes/tooltips see currency values).
    let cumulativeAmount = 0;

    return allDates.map((date, index) => {
      const dateStr = format(date, 'yyyy-MM-dd');
      const dailySpending = spendingMap.get(dateStr) || 0;
      cumulativeAmount += dailySpending;

      // Get previous period cumulative amount for the same day index
      const previousAmount = previousSpendingMap.get(index) || 0;

      return {
        date: format(date, 'MMM d'),
        amount: toDecimal(asMilli(cumulativeAmount)),
        previousAmount: toDecimal(asMilli(previousAmount)),
        dailySpending: toDecimal(asMilli(dailySpending)),
      };
    });
  }, [spendingData, previousSpendingData, dateRange, previousPeriodRange]);

  const option = useMemo<EChartsCoreOption>(() => {
    const { chrome } = palette;
    const currentColor = palette.series[0];
    const previousColor = palette.series[1];
    const lastIndex = formattedData.length - 1;

    return {
      grid: { left: 8, right: 16, top: 16, bottom: 4, containLabel: true },
      xAxis: {
        type: 'category' as const,
        data: formattedData.map((datum) => datum.date),
        boundaryGap: false,
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
          const datum = formattedData[items[0]?.dataIndex ?? 0];
          if (!datum) return '';
          const rows: TooltipRow[] = [
            { color: currentColor, name: 'Current', value: globalLocalizer.format(datum.amount) },
          ];
          if (datum.previousAmount > 0) {
            rows.push({
              color: previousColor,
              name: 'Previous',
              value: globalLocalizer.format(datum.previousAmount),
            });
          }
          rows.push({
            color: chrome.inkPrimary,
            name: 'Daily',
            value: globalLocalizer.format(datum.dailySpending),
          });
          return tooltipHtml(datum.date, rows);
        },
      },
      series: [
        // Previous period line - rendered first so it appears behind
        {
          name: 'Previous Period',
          type: 'line' as const,
          data: formattedData.map((datum) => datum.previousAmount),
          lineStyle: { color: previousColor, width: 2, opacity: 0.5 },
          itemStyle: { color: previousColor, borderColor: chrome.surface, borderWidth: 2 },
          symbol: 'none',
          areaStyle: { color: previousColor, opacity: 0.05 },
        },
        {
          name: 'Current Period',
          type: 'line' as const,
          data: formattedData.map((datum) => datum.amount),
          lineStyle: { color: currentColor, width: 2 },
          itemStyle: { color: currentColor, borderColor: chrome.surface, borderWidth: 2 },
          // Only show a dot on the last point
          symbol: 'circle',
          symbolSize: (_value: unknown, params: { dataIndex: number }) =>
            params.dataIndex === lastIndex ? 8 : 0,
          areaStyle: { color: currentColor, opacity: 0.1 },
          z: 3,
        },
      ],
    };
  }, [formattedData, palette, globalLocalizer]);

  if (isLoadingSpending) {
    return (
      <div className="flex items-center justify-center h-[300px]">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (formattedData.length === 0) {
    return <ChartEmptyState hint="No transactions found for the selected period" />;
  }

  return (
    <div className="h-[300px]">
      <EChart option={option} ariaLabel="Cumulative spending overview" className="h-[300px]" />
    </div>
  );
}
