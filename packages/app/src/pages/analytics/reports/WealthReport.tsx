import { useMemo, useState } from 'react';
import type { EChartsCoreOption } from 'echarts/core';
import { Layers, ArrowUpDown, Route } from 'lucide-react';
import { EChart } from '@shared/ui/echart';
import { AnimatedNumber } from '@shared/ui/animated-number';
import { trendTextClass } from '@shared/lib/amount-color';
import {
  buildMonthlyFlow,
  buildNetWorthSeries,
  buildRunway,
  shiftMonthKey,
} from '../analytics-model';
import { linearForecast } from '../forecast';
import { wealthInsights } from '../insights';
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

type WealthMode = 'assets-debt' | 'change' | 'forecast';

const FORECAST_HORIZON = 6;
const MAX_RUNWAY_PROJECTION = 36;

function formatRunway(months: number | null): string {
  if (months === null) return '∞';
  if (months >= 120) return '10+ years';
  return months >= 10 ? `${Math.round(months)} mo` : `${months.toFixed(1)} mo`;
}

interface WealthReportProps {
  data: AnalyticsData;
  months: string[];
  accountIds: number[];
}

/**
 * Wealth: the account-scoped story in one place — what you own vs owe, how
 * it changes, an honest OLS forecast with 95% prediction intervals, and the
 * runway your spendable funds buy at the current burn.
 */
export function WealthReport({ data, months, accountIds }: WealthReportProps) {
  const [mode, setMode] = useState<WealthMode>('assets-debt');
  const palette = usePalette();
  const money = useMoneyFormatters();

  const { points, runway } = useMemo(() => {
    const accountSet = accountIds.length ? new Set(accountIds) : null;
    const accounts = accountSet
      ? data.accounts.filter((account) => accountSet.has(account.id))
      : data.accounts;
    const txns = accountSet
      ? data.allTxns.filter((txn) => accountSet.has(txn.accountId))
      : data.allTxns;
    const series = buildNetWorthSeries(accounts, txns, months);

    const spendable = accountSet ? accounts : data.accounts.filter((account) => account.onBudget);
    const spendableIds = new Set(spendable.map((account) => account.id));
    const balances = buildNetWorthSeries(
      spendable,
      data.allTxns.filter((txn) => spendableIds.has(txn.accountId)),
      months
    );
    const flows = buildMonthlyFlow(data.txns, months, spendableIds);
    return { points: series, runway: buildRunway(balances, flows, MAX_RUNWAY_PROJECTION) };
  }, [data.accounts, data.allTxns, data.txns, months, accountIds]);

  const forecast = useMemo(
    () =>
      linearForecast(
        points.map((point) => point.netWorth),
        FORECAST_HORIZON
      ),
    [points]
  );

  const current = points.at(-1);
  const first = points[0];
  const change = current && first ? current.netWorth - first.netWorth : 0;
  const isEmpty = points.every((point) => point.assets === 0 && point.debt === 0);

  const assetColor = palette.series[0];
  const debtColor = palette.flow.negative;
  const lineColor = palette.chrome.inkPrimary;

  const insights = useMemo(
    () =>
      wealthInsights(points, forecast, {
        money: (milli) => money.amount(milli),
        monthLabel: shortMonthLabel,
      }),
    [points, forecast, money]
  );

  const option = useMemo<EChartsCoreOption>(() => {
    const { chrome } = palette;
    if (mode === 'forecast') {
      const futureKeys = Array.from({ length: FORECAST_HORIZON }, (_, index) =>
        months.length ? shiftMonthKey(months[months.length - 1], index + 1) : ''
      );
      const axisKeys = [...months, ...futureKeys];
      const lastIndex = months.length - 1;
      const predicted = (index: number) =>
        forecast?.points[index - months.length]?.predicted ?? null;
      return {
        grid: BASE_GRID,
        xAxis: monthAxis(axisKeys, chrome),
        yAxis: moneyAxis(chrome, money.compact),
        tooltip: {
          ...tooltipBase(chrome),
          trigger: 'axis',
          axisPointer: { type: 'line', lineStyle: { color: chrome.axisLine } },
          formatter: (params: unknown) => {
            const items = params as { dataIndex: number }[];
            const index = items[0]?.dataIndex ?? 0;
            if (index <= lastIndex) {
              const point = points[index];
              return point
                ? tooltipHtml(shortMonthLabel(point.monthKey), [
                    { color: lineColor, name: 'Net worth', value: money.amount(point.netWorth) },
                  ])
                : '';
            }
            const fp = forecast?.points[index - months.length];
            if (!fp) return '';
            return tooltipHtml(`${shortMonthLabel(axisKeys[index])} (forecast)`, [
              {
                color: assetColor,
                name: 'Predicted',
                value: money.amount(Math.round(fp.predicted)),
              },
              {
                color: chrome.other,
                name: '95% interval',
                value: `${money.amount(Math.round(fp.lower95))} – ${money.amount(Math.round(fp.upper95))}`,
              },
            ]);
          },
        },
        series: [
          {
            name: 'Net worth',
            type: 'line',
            data: axisKeys.map((_, index) =>
              index <= lastIndex ? points[index].netWorth / 1000 : null
            ),
            lineStyle: { color: lineColor, width: 2 },
            itemStyle: { color: lineColor, borderColor: chrome.surface, borderWidth: 2 },
            symbol: 'circle',
            symbolSize: 8,
            showSymbol: months.length <= 30,
            z: 3,
          },
          // 95% prediction band: transparent base stacked with the visible span.
          {
            name: 'band-base',
            type: 'line',
            stack: 'band',
            silent: true,
            data: axisKeys.map((_, index) =>
              index >= lastIndex
                ? (index === lastIndex
                    ? points[lastIndex].netWorth
                    : (forecast?.points[index - months.length]?.lower95 ?? 0)) / 1000
                : null
            ),
            lineStyle: { opacity: 0 },
            symbol: 'none',
          },
          {
            name: 'band-span',
            type: 'line',
            stack: 'band',
            silent: true,
            data: axisKeys.map((_, index) => {
              if (index < lastIndex) return null;
              if (index === lastIndex) return 0;
              const fp = forecast?.points[index - months.length];
              return fp ? (fp.upper95 - fp.lower95) / 1000 : null;
            }),
            lineStyle: { opacity: 0 },
            symbol: 'none',
            areaStyle: { color: assetColor, opacity: 0.12 },
          },
          {
            name: 'Forecast',
            type: 'line',
            data: axisKeys.map((_, index) =>
              index >= lastIndex
                ? (index === lastIndex ? points[lastIndex].netWorth : (predicted(index) ?? 0)) /
                  1000
                : null
            ),
            lineStyle: { color: assetColor, width: 2, type: 'dashed' },
            itemStyle: { color: assetColor, borderColor: chrome.surface, borderWidth: 2 },
            symbol: 'circle',
            symbolSize: 6,
            showSymbol: false,
          },
        ],
      };
    }

    const shared = {
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
            { color: lineColor, name: 'Net worth', value: money.amount(point.netWorth) },
            { color: assetColor, name: 'Assets', value: money.amount(point.assets) },
            { color: debtColor, name: 'Debt', value: money.amount(-point.debt) },
          ]);
        },
      },
    };
    if (mode === 'assets-debt') {
      return {
        ...shared,
        series: [
          {
            name: 'Assets',
            type: 'bar',
            stack: 'worth',
            data: points.map((point) => point.assets / 1000),
            barMaxWidth: BAR_MAX_WIDTH,
            itemStyle: { color: assetColor, borderRadius: BAR_RADIUS_TOP },
          },
          {
            name: 'Debt',
            type: 'bar',
            stack: 'worth',
            data: points.map((point) => -point.debt / 1000),
            barMaxWidth: BAR_MAX_WIDTH,
            itemStyle: { color: debtColor, borderRadius: BAR_RADIUS_BOTTOM },
          },
          {
            name: 'Net worth',
            type: 'line',
            data: points.map((point) => point.netWorth / 1000),
            lineStyle: { color: lineColor, width: 2 },
            itemStyle: { color: lineColor, borderColor: chrome.surface, borderWidth: 2 },
            symbol: 'circle',
            symbolSize: 8,
            z: 3,
          },
        ],
      };
    }
    const deltas = points.map((point, index) =>
      index === 0 ? 0 : point.netWorth - points[index - 1].netWorth
    );
    return {
      ...shared,
      tooltip: {
        ...tooltipBase(chrome),
        trigger: 'axis',
        axisPointer: { type: 'line', lineStyle: { color: chrome.axisLine } },
        formatter: (params: unknown) => {
          const items = params as { dataIndex: number }[];
          const index = items[0]?.dataIndex ?? 0;
          const delta = deltas[index];
          return tooltipHtml(shortMonthLabel(months[index]), [
            {
              color: delta >= 0 ? palette.flow.positive : palette.flow.negative,
              name: 'Change vs previous month',
              value: money.amount(delta),
            },
          ]);
        },
      },
      series: [
        {
          name: 'Change',
          type: 'bar',
          data: deltas.map((delta) => ({
            value: delta / 1000,
            itemStyle: {
              color: delta >= 0 ? palette.flow.positive : palette.flow.negative,
              borderRadius: delta >= 0 ? BAR_RADIUS_TOP : BAR_RADIUS_BOTTOM,
            },
          })),
          barMaxWidth: BAR_MAX_WIDTH,
        },
      ],
    };
  }, [mode, months, points, forecast, palette, money, assetColor, debtColor, lineColor]);

  const monthlyRows = useMemo(
    () =>
      [...points]
        .reverse()
        .slice(0, 12)
        .map((point, index, list) => {
          const previous = list[index + 1];
          return { point, delta: previous ? point.netWorth - previous.netWorth : null };
        }),
    [points]
  );

  const runsOut =
    runway.runwayMonths !== null && runway.projection.length > 1
      ? shortMonthLabel(runway.projection[runway.projection.length - 1].monthKey)
      : null;

  return (
    <ReportShell
      title="Wealth"
      hero={
        current ? (
          <AnimatedNumber
            value={current.netWorth}
            formatter={(value) => money.amount(value)}
            rounding="integer"
          />
        ) : (
          '—'
        )
      }
      subtitle="What you own, what you owe, and where it's heading"
      controls={
        <ModeToggle
          value={mode}
          onChange={setMode}
          ariaLabel="Wealth chart mode"
          options={[
            { value: 'assets-debt', label: 'Assets vs Debt', icon: Layers },
            { value: 'change', label: 'Change', icon: ArrowUpDown },
            { value: 'forecast', label: 'Forecast', icon: Route },
          ]}
        />
      }
      insights={<InsightStrip insights={insights} />}
      legend={
        mode === 'assets-debt' ? (
          <LegendChips
            items={[
              { color: assetColor, label: 'Assets' },
              { color: debtColor, label: 'Debt' },
              { color: lineColor, label: 'Net worth' },
            ]}
          />
        ) : mode === 'forecast' ? (
          <LegendChips
            items={[
              { color: lineColor, label: 'Net worth' },
              { color: assetColor, label: 'Forecast (95% interval shaded)' },
            ]}
          />
        ) : null
      }
      chart={
        <>
          <EChart option={option} ariaLabel="Wealth over time" />
          <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-1 border-t border-dashed border-border/60 pt-3 text-sm">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Runway
            </span>
            <span className="font-semibold">{formatRunway(runway.runwayMonths)}</span>
            {runsOut ? (
              <span className="text-muted-foreground">
                funds last until <span className="font-medium text-foreground">{runsOut}</span> if
                income stopped
              </span>
            ) : null}
            <span className="text-muted-foreground">
              burn{' '}
              <span className="font-medium text-foreground">
                {money.amount(runway.avgMonthlySpend)}
              </span>
              /month
            </span>
          </div>
        </>
      }
      isLoading={data.isLoading}
      isEmpty={isEmpty}
      emptyText="No account activity in this period."
      panel={
        <>
          <div className="grid grid-cols-2 gap-2">
            <StatTile label="Net worth" value={current ? money.tile(current.netWorth) : '—'} />
            <StatTile
              label="Change"
              value={money.tile(change)}
              valueClassName={trendTextClass(change)}
              detail={first ? `vs ${shortMonthLabel(first.monthKey)}` : undefined}
            />
            <StatTile label="Assets" value={current ? money.tile(current.assets) : '—'} />
            <StatTile
              label="Debt"
              value={current ? money.tile(current.debt) : '—'}
              valueClassName={
                current && current.debt > 0 ? 'text-red-600 dark:text-red-300' : undefined
              }
            />
          </div>
          {forecast ? (
            <p className="mt-3 text-xs text-muted-foreground">
              Forecast: OLS over {points.length} months, slope{' '}
              {money.amount(Math.round(forecast.slope))}/mo ±{' '}
              {money.amount(Math.round(forecast.slopeSE))}, p{' '}
              {forecast.pValue < 0.001 ? '< 0.001' : `= ${forecast.pValue.toFixed(3)}`}, R²{' '}
              {forecast.rSquared.toFixed(2)}. Shaded band is the 95% prediction interval.
            </p>
          ) : null}
          <PanelSectionTitle>Monthly</PanelSectionTitle>
          <div className="divide-y divide-border/50">
            {monthlyRows.map(({ point, delta }) => (
              <MonthRow
                key={point.monthKey}
                label={shortMonthLabel(point.monthKey)}
                primary={money.amount(point.netWorth)}
                secondary={
                  delta === null
                    ? undefined
                    : `${delta >= 0 ? '+' : ''}${money.amount(delta)} vs prev`
                }
              />
            ))}
          </div>
        </>
      }
    />
  );
}
