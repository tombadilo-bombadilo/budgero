import { useMemo, useState } from 'react';
import type { EChartsCoreOption } from 'echarts/core';
import { Layers, Percent } from 'lucide-react';
import { EChart } from '@shared/ui/echart';
import { AnimatedNumber } from '@shared/ui/animated-number';
import { Input } from '@shared/ui/input';
import { trendTextClass } from '@shared/lib/amount-color';
import { buildMonthlyFlow } from '../analytics-model';
import { inOutInsights } from '../insights';
import type { AnalyticsData } from '../useAnalyticsData';
import {
  BASE_GRID,
  BAR_MAX_WIDTH,
  BAR_RADIUS_BOTTOM,
  BAR_RADIUS_TOP,
  monthAxis,
  moneyAxis,
  shortMonthLabel,
  tooltipBase,
  tooltipHtml,
  useMoneyFormatters,
  usePalette,
} from '../components/chart-utils';
import { ModeToggle, ReportShell } from '../components/ReportShell';
import {
  InsightStrip,
  LegendChips,
  MonthRow,
  PanelSectionTitle,
  StatTile,
} from '../components/panels';

type InOutMode = 'flow' | 'rate';

const targetKey = (budgetId: number) => `budgero.analytics.savingsTarget.${budgetId}`;

function loadTarget(budgetId: number): number | null {
  try {
    const raw = localStorage.getItem(targetKey(budgetId));
    const parsed = raw === null ? NaN : Number(raw);
    return Number.isFinite(parsed) && parsed > 0 && parsed <= 100 ? parsed : null;
  } catch {
    return null;
  }
}

interface InOutReportProps {
  data: AnalyticsData;
  months: string[];
}

/**
 * In vs Out: do we live within our means — inflow/outflow mirrored around
 * zero with the net line, plus the savings-rate thread with a personal
 * target line.
 */
export function InOutReport({ data, months }: InOutReportProps) {
  const [mode, setMode] = useState<InOutMode>('flow');
  const [target, setTarget] = useState<number | null>(() => loadTarget(data.budgetId));
  const palette = usePalette();
  const money = useMoneyFormatters();

  const points = useMemo(
    () => buildMonthlyFlow(data.txns, months, data.onBudgetAccountIds),
    [data.txns, months, data.onBudgetAccountIds]
  );

  const totalIncome = points.reduce((sum, point) => sum + point.income, 0);
  const totalSpending = points.reduce((sum, point) => sum + point.spending, 0);
  const totalNet = totalIncome - totalSpending;
  const savingsRate = totalIncome > 0 ? (totalNet / totalIncome) * 100 : null;
  const monthCount = Math.max(1, points.length);
  const isEmpty = totalIncome === 0 && totalSpending === 0;

  const inColor = palette.flow.positive;
  const outColor = palette.flow.negative;
  const netColor = palette.chrome.inkPrimary;

  const monthlyRates = useMemo(
    () => points.map((point) => (point.income > 0 ? (point.net / point.income) * 100 : null)),
    [points]
  );

  const insights = useMemo(
    () =>
      inOutInsights(points, target, {
        money: (milli) => money.amount(milli),
        monthLabel: shortMonthLabel,
      }),
    [points, target, money]
  );

  const updateTarget = (raw: string) => {
    const parsed = Number(raw);
    const next = Number.isFinite(parsed) && parsed > 0 && parsed <= 100 ? parsed : null;
    setTarget(next);
    try {
      if (next === null) {
        localStorage.removeItem(targetKey(data.budgetId));
      } else {
        localStorage.setItem(targetKey(data.budgetId), String(next));
      }
    } catch {
      /* no-op */
    }
  };

  const option = useMemo<EChartsCoreOption>(() => {
    const { chrome } = palette;
    if (mode === 'flow') {
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
            const point = points[items[0]?.dataIndex ?? 0];
            if (!point) return '';
            return tooltipHtml(shortMonthLabel(point.monthKey), [
              { color: netColor, name: 'Net', value: money.amount(point.net) },
              { color: inColor, name: 'Money in', value: money.amount(point.income) },
              { color: outColor, name: 'Money out', value: money.amount(-point.spending) },
            ]);
          },
        },
        series: [
          {
            name: 'Money in',
            type: 'bar',
            stack: 'flow',
            data: points.map((point) => point.income / 1000),
            barMaxWidth: BAR_MAX_WIDTH,
            itemStyle: { color: inColor, borderRadius: BAR_RADIUS_TOP },
          },
          {
            name: 'Money out',
            type: 'bar',
            stack: 'flow',
            data: points.map((point) => -point.spending / 1000),
            barMaxWidth: BAR_MAX_WIDTH,
            itemStyle: { color: outColor, borderRadius: BAR_RADIUS_BOTTOM },
          },
          {
            name: 'Net',
            type: 'line',
            data: points.map((point) => point.net / 1000),
            lineStyle: { color: netColor, width: 2 },
            itemStyle: { color: netColor, borderColor: chrome.surface, borderWidth: 2 },
            symbol: 'circle',
            symbolSize: 8,
            z: 3,
          },
        ],
      };
    }
    return {
      grid: BASE_GRID,
      xAxis: monthAxis(months, chrome),
      yAxis: {
        type: 'value' as const,
        axisLabel: {
          color: chrome.axisText,
          fontSize: 11,
          formatter: (value: number) => `${value}%`,
        },
        splitLine: { lineStyle: { color: chrome.grid, width: 1 } },
        axisLine: { show: false },
      },
      tooltip: {
        ...tooltipBase(chrome),
        trigger: 'axis',
        axisPointer: { type: 'line', lineStyle: { color: chrome.axisLine } },
        formatter: (params: unknown) => {
          const items = params as { dataIndex: number }[];
          const index = items[0]?.dataIndex ?? 0;
          const rate = monthlyRates[index];
          return tooltipHtml(shortMonthLabel(months[index]), [
            {
              color: rate !== null && rate >= 0 ? palette.flow.positive : palette.flow.negative,
              name: 'Savings rate',
              value: rate === null ? 'no income' : `${rate.toFixed(1)}%`,
            },
          ]);
        },
      },
      series: [
        {
          name: 'Savings rate',
          type: 'line',
          data: monthlyRates,
          lineStyle: { color: palette.series[0], width: 2 },
          itemStyle: { color: palette.series[0], borderColor: chrome.surface, borderWidth: 2 },
          symbol: 'circle',
          symbolSize: 8,
          connectNulls: true,
          markLine: {
            silent: true,
            symbol: 'none',
            lineStyle: { color: chrome.axisLine, type: 'solid', width: 1 },
            label: { show: false },
            data: [
              { yAxis: 0 },
              ...(target !== null
                ? [
                    {
                      yAxis: target,
                      lineStyle: {
                        color: palette.flow.positive,
                        type: 'dashed' as const,
                        width: 1.5,
                      },
                      label: {
                        show: true,
                        position: 'insideEndTop' as const,
                        formatter: `target ${target}%`,
                        color: chrome.inkSecondary,
                        fontSize: 11,
                      },
                    },
                  ]
                : []),
            ],
          },
        },
      ],
    };
  }, [mode, months, points, monthlyRates, target, palette, money, inColor, outColor, netColor]);

  const monthlyRows = useMemo(() => [...points].reverse().slice(0, 12), [points]);

  return (
    <ReportShell
      title="In vs Out"
      hero={
        <AnimatedNumber
          value={totalNet}
          formatter={(value) => `${value >= 0 ? '+' : ''}${money.amount(value)}`}
          rounding="integer"
        />
      }
      heroClassName={trendTextClass(totalNet)}
      subtitle={
        savingsRate === null
          ? 'Do we live within our means?'
          : savingsRate >= 0
            ? `Keeping ${savingsRate.toFixed(0)}% of income${target !== null ? ` (target ${target}%)` : ''}`
            : `Spending ${Math.abs(savingsRate).toFixed(0)}% more than income`
      }
      controls={
        <>
          {mode === 'rate' ? (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              Target
              <Input
                type="number"
                min={1}
                max={100}
                value={target ?? ''}
                placeholder="—"
                onChange={(event) => updateTarget(event.target.value)}
                className="h-8 w-16 text-right"
              />
              %
            </div>
          ) : null}
          <ModeToggle
            value={mode}
            onChange={setMode}
            ariaLabel="In vs Out chart mode"
            options={[
              { value: 'flow', label: 'Inflow vs Outflow', icon: Layers },
              { value: 'rate', label: 'Savings rate', icon: Percent },
            ]}
          />
        </>
      }
      insights={<InsightStrip insights={insights} />}
      legend={
        mode === 'flow' ? (
          <LegendChips
            items={[
              { color: inColor, label: 'Money in' },
              { color: outColor, label: 'Money out' },
              { color: netColor, label: 'Net' },
            ]}
          />
        ) : null
      }
      chart={<EChart option={option} ariaLabel="Monthly money in versus money out" />}
      isLoading={data.isLoading}
      isEmpty={isEmpty}
      emptyText="No income or spending in this period."
      panel={
        <>
          <div className="grid grid-cols-2 gap-2">
            <StatTile
              label="Net"
              value={`${totalNet >= 0 ? '+' : ''}${money.tile(totalNet)}`}
              valueClassName={trendTextClass(totalNet)}
            />
            <StatTile
              label="Savings rate"
              value={savingsRate === null ? '—' : `${savingsRate.toFixed(0)}%`}
              valueClassName={savingsRate !== null ? trendTextClass(savingsRate) : undefined}
              detail={target !== null ? `target ${target}%` : undefined}
            />
            <StatTile label="Money in" value={money.tile(totalIncome)} />
            <StatTile
              label="Money out"
              value={money.tile(totalSpending)}
              valueClassName={totalSpending > 0 ? 'text-red-600 dark:text-red-300' : undefined}
              detail={`avg ${money.tile(Math.round(totalSpending / monthCount))}/mo`}
            />
          </div>
          <PanelSectionTitle>Monthly</PanelSectionTitle>
          <div className="divide-y divide-border/50">
            {monthlyRows.map((point) => (
              <MonthRow
                key={point.monthKey}
                label={shortMonthLabel(point.monthKey)}
                primary={`${point.net >= 0 ? '+' : ''}${money.amount(point.net)}`}
                primaryClassName={trendTextClass(point.net)}
                secondary={`In ${money.amount(point.income)} / Out ${money.amount(point.spending)}`}
              />
            ))}
          </div>
        </>
      }
    />
  );
}
