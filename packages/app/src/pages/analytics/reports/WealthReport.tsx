import { t } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import { useMemo, useState } from 'react';
import type { EChartsCoreOption } from 'echarts/core';
import { EChart } from '@shared/ui/echart';
import { AnimatedNumber } from '@shared/ui/animated-number';
import { trendTextClass } from '@shared/lib/amount-color';
import { AssetLiabilityHistoryChart } from '@pages/accounts/components/AssetLiabilityHistoryChart';
import { useMonthlyAssetHistory } from '@entities/account/api/useMonthlyAssetHistory';
import { useUiStore } from '@shared/store/useUiStore';
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

type WealthMode = 'assets-debt' | 'change' | 'forecast' | 'by-type';

const FORECAST_HORIZON = 6;
const MAX_RUNWAY_PROJECTION = 36;

function formatRunway(months: number | null): string {
  if (months === null) return '∞';
  if (months >= 120) return t`10+ years`;
  const duration = months >= 10 ? String(Math.round(months)) : months.toFixed(1);
  return t`${duration} mo`;
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
  const { t } = useLingui();

  const [mode, setMode] = useState<WealthMode>('assets-debt');
  const selectedBudget = useUiStore((s) => s.selectedBudget);
  const { data: assetHistory = [] } = useMonthlyAssetHistory(
    selectedBudget?.ID || 0,
    Math.max(months.length, 6)
  );
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

  // Resolve copy on every locale render; the three summaries are inexpensive.
  const insights = wealthInsights(points, forecast, {
    money: (milli) => money.amount(milli),
    monthLabel: shortMonthLabel,
  });

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
                    { color: lineColor, name: t`Net worth`, value: money.amount(point.netWorth) },
                  ])
                : '';
            }
            const fp = forecast?.points[index - months.length];
            if (!fp) return '';
            return tooltipHtml(`${shortMonthLabel(axisKeys[index])} (forecast)`, [
              {
                color: assetColor,
                name: t`Predicted`,
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
            name: t`Net worth`,
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
            name: t`Forecast`,
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
            { color: lineColor, name: t`Net worth`, value: money.amount(point.netWorth) },
            { color: assetColor, name: t`Assets`, value: money.amount(point.assets) },
            { color: debtColor, name: t`Debt`, value: money.amount(-point.debt) },
          ]);
        },
      },
    };
    if (mode === 'assets-debt') {
      return {
        ...shared,
        series: [
          {
            name: t`Assets`,
            type: 'bar',
            stack: 'worth',
            data: points.map((point) => point.assets / 1000),
            barMaxWidth: BAR_MAX_WIDTH,
            itemStyle: { color: assetColor, borderRadius: BAR_RADIUS_TOP },
          },
          {
            name: t`Debt`,
            type: 'bar',
            stack: 'worth',
            data: points.map((point) => -point.debt / 1000),
            barMaxWidth: BAR_MAX_WIDTH,
            itemStyle: { color: debtColor, borderRadius: BAR_RADIUS_BOTTOM },
          },
          {
            name: t`Net worth`,
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
              name: t`Change vs previous month`,
              value: money.amount(delta),
            },
          ]);
        },
      },
      series: [
        {
          name: t`Net change`,
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
  }, [mode, months, points, forecast, palette, money, assetColor, debtColor, lineColor, t]);

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
      title={t`Wealth`}
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
      subtitle={t`What you own, what you owe, and where it's heading`}
      controls={
        <ModeToggle
          value={mode}
          onChange={setMode}
          ariaLabel={t`Wealth chart mode`}
          options={[
            { value: 'assets-debt', label: t`Assets vs Debt` },
            { value: 'by-type', label: t`By Type` },
            { value: 'change', label: t`Net change` },
            { value: 'forecast', label: t`Forecast` },
          ]}
        />
      }
      insights={<InsightStrip insights={insights} />}
      legend={
        mode === 'assets-debt' ? (
          <LegendChips
            items={[
              { color: assetColor, label: t`Assets` },
              { color: debtColor, label: t`Debt` },
              { color: lineColor, label: t`Net worth` },
            ]}
          />
        ) : mode === 'forecast' ? (
          <LegendChips
            items={[
              { color: lineColor, label: t`Net worth` },
              { color: assetColor, label: t`Forecast (95% interval shaded)` },
            ]}
          />
        ) : null
      }
      chart={
        mode === 'by-type' ? (
          <>
            <AssetLiabilityHistoryChart
              monthlyAssetHistory={assetHistory}
              netWorth={assetHistory[assetHistory.length - 1]?.netWorth ?? 0}
              formatCurrency={(milli) => money.amount(milli)}
            />
            {accountIds.length > 0 && (
              <p className="mt-2 text-[11px] text-muted-foreground">
                <Trans>
                  The by-type view always covers all accounts — the account filter doesn't apply
                  here.
                </Trans>
              </p>
            )}
          </>
        ) : (
          <>
            <EChart option={option} ariaLabel={t`Wealth over time`} />
            <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-1 border-t border-dashed border-border/60 pt-3 text-sm">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <Trans>Runway</Trans>
              </span>
              <span className="font-semibold">{formatRunway(runway.runwayMonths)}</span>
              {runsOut ? (
                <span className="text-muted-foreground">
                  <Trans>
                    funds last until <span className="font-medium text-foreground">{runsOut}</span>{' '}
                    if income stopped
                  </Trans>
                </span>
              ) : null}
              <span className="text-muted-foreground">
                <Trans>
                  burn{' '}
                  <span className="font-medium text-foreground">
                    {money.amount(runway.avgMonthlySpend)}
                  </span>
                  /month
                </Trans>
              </span>
            </div>
          </>
        )
      }
      isLoading={data.isLoading}
      isEmpty={isEmpty}
      emptyText={t`No account activity in this period.`}
      panel={
        <>
          <div className="grid grid-cols-2 gap-2">
            <StatTile label={t`Net worth`} value={current ? money.tile(current.netWorth) : '—'} />
            <StatTile
              label={t`Net change`}
              value={money.tile(change)}
              valueClassName={trendTextClass(change)}
              detail={first ? t`vs ${shortMonthLabel(first.monthKey)}` : undefined}
            />
            <StatTile label={t`Assets`} value={current ? money.tile(current.assets) : '—'} />
            <StatTile
              label={t`Debt`}
              value={current ? money.tile(current.debt) : '—'}
              valueClassName={
                current && current.debt > 0 ? 'text-red-600 dark:text-red-300' : undefined
              }
            />
          </div>
          {forecast ? (
            <p className="mt-3 text-xs text-muted-foreground">
              <Trans>
                Forecast: OLS over {points.length} months, slope{' '}
                {money.amount(Math.round(forecast.slope))}/mo ±{' '}
                {money.amount(Math.round(forecast.slopeSE))}, p{' '}
                {forecast.pValue < 0.001 ? '< 0.001' : `= ${forecast.pValue.toFixed(3)}`}, R²{' '}
                {forecast.rSquared.toFixed(2)}. Shaded band is the 95% prediction interval.
              </Trans>
            </p>
          ) : null}
          <PanelSectionTitle>
            <Trans>Monthly</Trans>
          </PanelSectionTitle>
          <div className="divide-y divide-border/50">
            {monthlyRows.map(({ point, delta }) => (
              <MonthRow
                key={point.monthKey}
                label={shortMonthLabel(point.monthKey)}
                primary={money.amount(point.netWorth)}
                secondary={
                  delta === null
                    ? undefined
                    : t`${delta >= 0 ? '+' : ''}${money.amount(delta)} vs prev`
                }
              />
            ))}
          </div>
        </>
      }
    />
  );
}
