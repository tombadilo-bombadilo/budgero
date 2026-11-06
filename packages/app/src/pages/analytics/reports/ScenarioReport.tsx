import { Trans, useLingui } from '@lingui/react/macro';
import { useMemo, useState } from 'react';
import type { EChartsCoreOption } from 'echarts/core';
import { Plus, Save, Trash2 } from 'lucide-react';
import { EChart } from '@shared/ui/echart';
import { Button } from '@shared/ui/button';
import { Input } from '@shared/ui/input';
import { Slider } from '@shared/ui/slider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@shared/ui/select';
import MonthPickerPopover from '@shared/ui/MonthPickerPopover';
import { trendTextClass } from '@shared/lib/amount-color';
import { cn } from '@shared/lib/utils';
import { getTodayISO } from '@shared/lib/date-utils';
import { CalculatorCell } from '@shared/ui/calculator-cell';
import { asMilli } from '@shared/lib/currency/milli';
import { useUiStore } from '@shared/store/useUiStore';
import {
  buildMonthlyFlow,
  buildNetWorthSeries,
  projectScenario,
  shiftMonthKey,
  type ScenarioOneOff,
} from '../analytics-model';
import {
  holtDampedPositiveForecast,
  linearForecast,
  seasonalAverageForecast,
  theilSenForecast,
} from '../forecast';
import type { AnalyticsData } from '../useAnalyticsData';
import {
  BASE_GRID,
  BAR_MAX_WIDTH,
  monthAxis,
  moneyAxis,
  shortMonthLabel,
  tooltipBase,
  tooltipHtml,
  useMoneyFormatters,
  usePalette,
} from '../components/chart-utils';
import { KeyFigures, ReportLayout, ToolbarField, ViewSwitch } from '../components/ReportLayout';
import { LedgerTable } from '../components/LedgerTable';
import { LegendChips } from '../components/panels';
import { reportMeta } from '../report-questions';
import { scenarioAnswer } from '../report-answers';
import {
  DEFAULT_SCENARIO_PAYLOAD,
  parseScenarioPayload,
  useDeleteScenario,
  useSaveScenario,
  useScenarios,
  type ScenarioPayload,
} from '../useScenarios';

interface ScenarioReportProps {
  data: AnalyticsData;
  /** Historical months from the page filter — the baseline sample. */
  months: string[];
  accountIds: number[];
}

function nextOneOffId(): string {
  return `oo_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Scenario Planner: stress-test the finances. Baseline income/spending come
 * from the filtered history (flat average or the OLS forecast trend), the
 * sliders scale them, dated one-offs land on top, and the projection shows
 * where the balance goes — including the month it would break.
 */
export function ScenarioReport({ data, months, accountIds }: ScenarioReportProps) {
  const { t } = useLingui();

  const palette = usePalette();
  const money = useMoneyFormatters();
  const globalLocalizer = useUiStore((state) => state.globalLocalizer);

  const [payload, setPayload] = useState<ScenarioPayload>(DEFAULT_SCENARIO_PAYLOAD);
  const [view, setView] = useState<'balance' | 'flow'>('balance');
  const [scenarioName, setScenarioName] = useState('');
  const [loadedId, setLoadedId] = useState<string | null>(null);

  const { data: saved = [] } = useScenarios(data.budgetId);
  const saveMutation = useSaveScenario();
  const deleteMutation = useDeleteScenario();

  const patch = (part: Partial<ScenarioPayload>) =>
    setPayload((current) => ({ ...current, ...part }));

  // ----- Scope: the user's account selection VERBATIM (off-budget counts
  // when selected), defaulting to on-budget — same semantics as Runway.
  const scopedIds = useMemo(() => {
    const accountSet = accountIds.length ? new Set(accountIds) : null;
    const scoped = accountSet
      ? data.accounts.filter((account) => accountSet.has(account.id))
      : data.accounts.filter((account) => account.onBudget);
    return new Set(scoped.map((account) => account.id));
  }, [data.accounts, accountIds]);

  // ----- Baseline: history → per-future-month income/spending -----
  // The current in-progress month is structurally incomplete data — a few
  // days of spending masquerading as a collapsed month — and poisons every
  // model (recency-weighted ones worst). It never enters the fitting sample.
  const flows = useMemo(() => {
    const currentMonth = getTodayISO().slice(0, 7);
    return buildMonthlyFlow(data.txns, months, scopedIds).filter(
      (point) => point.monthKey < currentMonth
    );
  }, [data.txns, months, scopedIds]);

  const startBalance = useMemo(() => {
    const scoped = data.accounts.filter((account) => scopedIds.has(account.id));
    const series = buildNetWorthSeries(
      scoped,
      data.allTxns.filter((txn) => scopedIds.has(txn.accountId)),
      months
    );
    return series.at(-1)?.netWorth ?? 0;
  }, [data.accounts, data.allTxns, months, scopedIds]);

  // Charted months = the chosen horizon; break detection runs far past it so
  // "when does this break" is answered honestly even off-chart.
  const BREAK_SEARCH_MONTHS = 600;
  const futureMonths = useMemo(() => {
    const last = months.at(-1);
    if (!last) return [];
    return Array.from({ length: BREAK_SEARCH_MONTHS }, (_, index) =>
      shiftMonthKey(last, index + 1)
    );
  }, [months]);
  const chartedMonths = useMemo(
    () => futureMonths.slice(0, payload.horizon),
    [futureMonths, payload.horizon]
  );

  const historyMonthKeys = useMemo(() => flows.map((point) => point.monthKey), [flows]);
  const seasonalReady = flows.length >= 12;

  const baseline = useMemo(() => {
    const incomes = flows.map((point) => point.income);
    const spendings = flows.map((point) => point.spending);
    const average = (values: number[]) =>
      values.length ? Math.round(values.reduce((sum, v) => sum + v, 0) / values.length) : 0;
    const avgIncome = average(incomes);
    const avgSpending = average(spendings);
    const flat = () => ({
      income: futureMonths.map(() => avgIncome),
      spending: futureMonths.map(() => avgSpending),
    });

    switch (payload.model) {
      case 'linear': {
        const incomeFit = linearForecast(incomes, BREAK_SEARCH_MONTHS);
        const spendingFit = linearForecast(spendings, BREAK_SEARCH_MONTHS);
        if (!incomeFit && !spendingFit) return flat();
        return {
          income: futureMonths.map((_, index) =>
            Math.max(0, Math.round(incomeFit?.points[index]?.predicted ?? avgIncome))
          ),
          spending: futureMonths.map((_, index) =>
            Math.max(0, Math.round(spendingFit?.points[index]?.predicted ?? avgSpending))
          ),
        };
      }
      case 'robust': {
        const incomeFit = theilSenForecast(incomes, BREAK_SEARCH_MONTHS);
        const spendingFit = theilSenForecast(spendings, BREAK_SEARCH_MONTHS);
        if (!incomeFit && !spendingFit) return flat();
        return {
          income: futureMonths.map((_, index) =>
            Math.max(0, Math.round(incomeFit?.points[index] ?? avgIncome))
          ),
          spending: futureMonths.map((_, index) =>
            Math.max(0, Math.round(spendingFit?.points[index] ?? avgSpending))
          ),
        };
      }
      case 'holt': {
        const incomeFit = holtDampedPositiveForecast(incomes, BREAK_SEARCH_MONTHS);
        const spendingFit = holtDampedPositiveForecast(spendings, BREAK_SEARCH_MONTHS);
        if (!incomeFit && !spendingFit) return flat();
        return {
          income: futureMonths.map((_, index) => Math.round(incomeFit?.[index] ?? avgIncome)),
          spending: futureMonths.map((_, index) => Math.round(spendingFit?.[index] ?? avgSpending)),
        };
      }
      case 'seasonal': {
        if (!seasonalReady) return flat();
        return {
          income: seasonalAverageForecast(incomes, historyMonthKeys, futureMonths).map((value) =>
            Math.max(0, Math.round(value))
          ),
          spending: seasonalAverageForecast(spendings, historyMonthKeys, futureMonths).map(
            (value) => Math.max(0, Math.round(value))
          ),
        };
      }
      default:
        return flat();
    }
  }, [flows, futureMonths, historyMonthKeys, seasonalReady, payload.model]);

  // ----- Projection: scenario vs untouched baseline -----
  const scenario = useMemo(
    () =>
      projectScenario({
        startBalance,
        months: futureMonths,
        baselineIncome: baseline.income,
        baselineSpending: baseline.spending,
        incomeFactor: payload.incomePct / 100,
        spendingFactor: payload.spendingPct / 100,
        oneOffs: payload.oneOffs,
      }),
    [startBalance, futureMonths, baseline, payload]
  );

  // Charted slice of the full projection (stats over what's visible; the
  // break month may legitimately land beyond it).
  const chartedPoints = useMemo(
    () => scenario.points.slice(0, payload.horizon),
    [scenario.points, payload.horizon]
  );
  const chartedEnd = chartedPoints.at(-1)?.balance ?? startBalance;
  const chartedMin = chartedPoints.reduce(
    (min, point) => (point.balance < min.balance ? point : min),
    { balance: startBalance, monthKey: null as string | null, income: 0, spending: 0, oneOff: 0 }
  );
  const breakBeyondChart =
    scenario.breakMonthKey !== null && !chartedMonths.includes(scenario.breakMonthKey);

  const scenarioColor = palette.series[0];
  const isEmpty = chartedMonths.length === 0;

  const option = useMemo<EChartsCoreOption>(() => {
    const { chrome } = palette;
    const tooltip = {
      ...tooltipBase(chrome),
      trigger: 'axis' as const,
      axisPointer: { type: 'line' as const, lineStyle: { color: chrome.axisLine } },
      formatter: (params: unknown) => {
        const items = params as { dataIndex: number }[];
        const index = items[0]?.dataIndex ?? 0;
        const point = chartedPoints[index];
        if (!point) return '';
        const rows = [
          { color: scenarioColor, name: t`Balance`, value: money.amount(point.balance) },
          { color: palette.flow.positive, name: t`Income`, value: money.amount(point.income) },
          { color: palette.flow.negative, name: t`Spending`, value: money.amount(-point.spending) },
        ];
        for (const oneOff of payload.oneOffs) {
          if (oneOff.monthKey !== point.monthKey || oneOff.amount <= 0) continue;
          rows.push({
            color: oneOff.kind === 'inflow' ? palette.flow.positive : palette.flow.negative,
            name: oneOff.label.trim() || t`One-off`,
            value: money.amount(oneOff.kind === 'inflow' ? oneOff.amount : -oneOff.amount),
          });
        }
        return tooltipHtml(shortMonthLabel(point.monthKey), rows);
      },
    };

    // One-off months are annotated with a thin dashed vertical carrying the
    // event's label — visible at any chart scale without decorating the line.
    const oneOffAnnotations = (() => {
      const byMonth = new Map<number, { labels: string[]; net: number }>();
      for (const row of payload.oneOffs) {
        if (row.amount <= 0) continue;
        const index = chartedMonths.indexOf(row.monthKey);
        if (index === -1) continue;
        const entry = byMonth.get(index) ?? { labels: [], net: 0 };
        entry.labels.push(row.label.trim() || money.compact(row.amount));
        entry.net += row.kind === 'inflow' ? row.amount : -row.amount;
        byMonth.set(index, entry);
      }
      return [...byMonth.entries()].map(([index, entry]) => ({
        xAxis: index,
        lineStyle: {
          color: entry.net >= 0 ? palette.flow.positive : palette.flow.negative,
          type: 'dashed' as const,
          width: 1,
          opacity: 0.7,
        },
        label: {
          show: true,
          position: 'insideEndTop' as const,
          formatter: entry.labels.join(' · '),
          color: chrome.inkSecondary,
          fontSize: 10,
        },
      }));
    })();

    const balanceLine = {
      name: t`Balance`,
      type: 'line' as const,
      data: chartedPoints.map((point) => point.balance / 1000),
      lineStyle: { color: scenarioColor, width: 2 },
      itemStyle: { color: scenarioColor, borderColor: chrome.surface, borderWidth: 2 },
      symbol: 'circle',
      symbolSize: 8,
      showSymbol: view === 'balance' && chartedMonths.length <= 30,
      markLine: {
        silent: true,
        symbol: 'none',
        label: { show: false },
        lineStyle: { color: chrome.axisLine, type: 'solid' as const, width: 1 },
        data: [
          // The zero line is the whole point of a stress test — make it read
          // as a hard floor, not a gridline.
          {
            yAxis: 0,
            lineStyle: {
              color: palette.flow.negative,
              type: 'solid' as const,
              width: 2,
              opacity: 0.8,
            },
            label: {
              show: true,
              position: 'insideStartTop' as const,
              formatter: '0',
              color: palette.flow.negative,
              fontSize: 10,
              fontWeight: 'bold' as const,
            },
          },
          ...(view === 'balance' ? oneOffAnnotations : []),
        ],
      },
      z: 3,
    };

    if (view === 'balance') {
      return {
        grid: BASE_GRID,
        xAxis: monthAxis(chartedMonths, chrome),
        yAxis: moneyAxis(chrome, money.compact),
        tooltip,
        series: [{ ...balanceLine, areaStyle: { color: scenarioColor, opacity: 0.1 } }],
      };
    }

    // Composition view: monthly income up / spending down (one-offs stacked
    // on their side in a distinct hue), balance line riding on top. The
    // flows and the balance live on DIFFERENT scales (monthly ~1M vs
    // cumulative ~16M), so the balance gets its own right-hand axis —
    // otherwise the bars compress into unreadable stubs.
    return {
      grid: { ...BASE_GRID, right: 8 },
      xAxis: monthAxis(chartedMonths, chrome),
      yAxis: [
        moneyAxis(chrome, money.compact),
        {
          ...moneyAxis(chrome, money.compact),
          // Gridlines come from the left axis only; two grids is noise.
          splitLine: { show: false },
        },
      ],
      tooltip,
      series: [
        {
          name: t`Income`,
          type: 'bar' as const,
          stack: 'flow',
          data: chartedPoints.map((point) => point.income / 1000),
          barMaxWidth: BAR_MAX_WIDTH,
          itemStyle: {
            color: palette.flow.positive,
            borderColor: chrome.surface,
            borderWidth: 1,
            opacity: 0.55,
          },
        },
        {
          name: t`One-off in`,
          type: 'bar' as const,
          stack: 'flow',
          data: chartedPoints.map((point) => (point.oneOff > 0 ? point.oneOff / 1000 : 0)),
          barMaxWidth: BAR_MAX_WIDTH,
          itemStyle: {
            color: palette.series[4],
            borderColor: chrome.surface,
            borderWidth: 1,
            opacity: 0.55,
          },
        },
        {
          name: t`Spending`,
          type: 'bar' as const,
          stack: 'flow',
          data: chartedPoints.map((point) => -point.spending / 1000),
          barMaxWidth: BAR_MAX_WIDTH,
          itemStyle: {
            color: palette.flow.negative,
            borderColor: chrome.surface,
            borderWidth: 1,
            opacity: 0.55,
          },
        },
        {
          name: t`One-off out`,
          type: 'bar' as const,
          stack: 'flow',
          data: chartedPoints.map((point) => (point.oneOff < 0 ? point.oneOff / 1000 : 0)),
          barMaxWidth: BAR_MAX_WIDTH,
          itemStyle: {
            color: palette.series[5],
            borderColor: chrome.surface,
            borderWidth: 1,
            opacity: 0.55,
          },
        },
        { ...balanceLine, yAxisIndex: 1 },
      ],
    };
  }, [view, chartedMonths, chartedPoints, payload.oneOffs, palette, money, scenarioColor, t]);

  // Gross one-off in/out per month (ScenarioPoint carries only the net).
  const oneOffGrossByMonth = useMemo(() => {
    const byMonth = new Map<string, { inflow: number; outflow: number }>();
    for (const row of payload.oneOffs) {
      if (row.amount <= 0) continue;
      const entry = byMonth.get(row.monthKey) ?? { inflow: 0, outflow: 0 };
      if (row.kind === 'inflow') entry.inflow += row.amount;
      else entry.outflow += row.amount;
      byMonth.set(row.monthKey, entry);
    }
    return byMonth;
  }, [payload.oneOffs]);

  // ----- One-off table helpers -----
  const defaultOneOffMonth = chartedMonths[0] ?? '';
  const addOneOff = () =>
    patch({
      oneOffs: [
        ...payload.oneOffs,
        {
          id: nextOneOffId(),
          monthKey: defaultOneOffMonth,
          amount: 0,
          kind: 'outflow',
          label: '',
        },
      ],
    });
  const updateOneOff = (id: string, part: Partial<ScenarioOneOff>) =>
    patch({
      oneOffs: payload.oneOffs.map((row) => (row.id === id ? { ...row, ...part } : row)),
    });
  const removeOneOff = (id: string) =>
    patch({ oneOffs: payload.oneOffs.filter((row) => row.id !== id) });

  const handleSave = async () => {
    const name = scenarioName.trim();
    if (!name) return;
    const record = await saveMutation.mutateAsync({
      id: loadedId ?? undefined,
      budgetId: data.budgetId,
      name,
      payload,
    });
    setLoadedId(record.ID);
  };

  const handleLoad = (id: string) => {
    const record = saved.find((row) => row.ID === id);
    if (!record) return;
    setPayload(parseScenarioPayload(record.Payload));
    setScenarioName(record.Name);
    setLoadedId(record.ID);
  };

  const fmt = { money: (milli: number) => money.amount(milli), monthLabel: shortMonthLabel };

  return (
    <ReportLayout
      question={reportMeta('scenario').question}
      answer={scenarioAnswer(
        {
          endBalance: chartedEnd,
          horizon: payload.horizon,
          breakMonthKey: scenario.breakMonthKey,
          breakBeyondChart,
        },
        fmt
      )}
      toolbar={
        <>
          <ViewSwitch
            label={t`Show`}
            value={view}
            onChange={setView}
            options={[
              { value: 'balance', label: t`Balance` },
              { value: 'flow', label: t`Composition` },
            ]}
          />
          <ToolbarField label={t`Projection model`}>
            {(labelId) => (
              <Select
                value={payload.model}
                onValueChange={(value) => patch({ model: value as ScenarioPayload['model'] })}
              >
                <SelectTrigger className="h-8 w-[220px]" size="sm" aria-labelledby={labelId}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="average">
                    <Trans>Flat average</Trans>
                  </SelectItem>
                  <SelectItem value="linear">
                    <Trans>Linear trend (OLS)</Trans>
                  </SelectItem>
                  <SelectItem value="robust">
                    <Trans>Robust trend (Theil–Sen)</Trans>
                  </SelectItem>
                  <SelectItem value="holt">
                    <Trans>Damped trend (Holt)</Trans>
                  </SelectItem>
                  <SelectItem value="seasonal" disabled={!seasonalReady}>
                    <Trans>Seasonal average{seasonalReady ? '' : t` (needs 12+ mo)`}</Trans>
                  </SelectItem>
                </SelectContent>
              </Select>
            )}
          </ToolbarField>
          <ToolbarField label={t`Horizon`}>
            {(labelId) => (
              <Select
                value={String(payload.horizon)}
                onValueChange={(value) => patch({ horizon: Number(value) })}
              >
                <SelectTrigger className="h-8 w-[135px]" size="sm" aria-labelledby={labelId}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[12, 24, 36, 60].map((horizon) => (
                    <SelectItem key={horizon} value={String(horizon)}>
                      <Trans>{horizon} months</Trans>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </ToolbarField>
        </>
      }
      legend={
        view === 'flow' ? (
          <LegendChips
            items={[
              { color: palette.flow.positive, label: t`Income` },
              { color: palette.flow.negative, label: t`Spending` },
              ...(payload.oneOffs.some((row) => row.kind === 'inflow')
                ? [{ color: palette.series[4], label: t`One-off in` }]
                : []),
              ...(payload.oneOffs.some((row) => row.kind === 'outflow')
                ? [{ color: palette.series[5], label: t`One-off out` }]
                : []),
              { color: scenarioColor, label: t`Balance` },
            ]}
          />
        ) : null
      }
      chart={<EChart option={option} ariaLabel="Scenario balance projection" />}
      isLoading={data.isLoading}
      isEmpty={isEmpty}
      emptyText={t`Pick a period with some history to project from.`}
      figures={
        <KeyFigures
          items={[
            { label: t`Starting funds`, value: money.tile(startBalance) },
            {
              label: t`End balance`,
              value: money.tile(chartedEnd),
              valueClassName: trendTextClass(chartedEnd),
            },
            {
              label: t`Lowest point`,
              value: money.tile(chartedMin.balance),
              valueClassName: trendTextClass(chartedMin.balance),
              detail: chartedMin.monthKey ? shortMonthLabel(chartedMin.monthKey) : undefined,
            },
            {
              label: t`Funds run out`,
              value: scenario.breakMonthKey ? shortMonthLabel(scenario.breakMonthKey) : t`Never`,
              valueClassName: scenario.breakMonthKey
                ? 'text-red-600 dark:text-red-300'
                : 'text-green-600',
              detail: breakBeyondChart
                ? t`beyond charted window`
                : scenario.breakMonthKey
                  ? undefined
                  : t`net stays positive for 50 years`,
            },
          ]}
        />
      }
    >
      {isEmpty ? null : (
        <>
          <div className="rounded-lg border border-border bg-card">
            <h3 className="border-b border-border px-4 py-2.5 text-sm font-semibold">
              <Trans>Adjust the scenario</Trans>
            </h3>
            <div className="p-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <div className="flex items-baseline justify-between">
                    <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      <Trans>Monthly income</Trans>
                    </span>
                    <span className="text-sm font-semibold tabular-nums">
                      {payload.incomePct}% ·{' '}
                      {money.amount(
                        Math.round((baseline.income[0] ?? 0) * (payload.incomePct / 100))
                      )}
                    </span>
                  </div>
                  <Slider
                    value={[payload.incomePct]}
                    min={0}
                    max={200}
                    step={5}
                    onValueChange={([value]) => patch({ incomePct: value })}
                    className="mt-2"
                  />
                </div>
                <div>
                  <div className="flex items-baseline justify-between">
                    <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      <Trans>Monthly spending</Trans>
                    </span>
                    <span className="text-sm font-semibold tabular-nums">
                      {payload.spendingPct}% ·{' '}
                      {money.amount(
                        Math.round((baseline.spending[0] ?? 0) * (payload.spendingPct / 100))
                      )}
                    </span>
                  </div>
                  <Slider
                    value={[payload.spendingPct]}
                    min={0}
                    max={200}
                    step={5}
                    onValueChange={([value]) => patch({ spendingPct: value })}
                    className="mt-2"
                  />
                </div>
              </div>

              <div className="mt-4 border-t border-border pt-4">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <Trans>One-off inflows / outflows</Trans>
                  </span>
                  <Button variant="outline" size="sm" onClick={addOneOff}>
                    <Trans>
                      <Plus className="mr-1 h-3.5 w-3.5" />
                      Add
                    </Trans>
                  </Button>
                </div>
                {payload.oneOffs.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    <Trans>
                      Nothing yet — add a car repair, a bonus, a tax bill… and watch the line react.
                    </Trans>
                  </p>
                ) : (
                  <div className="space-y-2">
                    {payload.oneOffs.map((row) => (
                      <div key={row.id} className="flex flex-wrap items-center gap-2">
                        <MonthPickerPopover
                          value={row.monthKey || defaultOneOffMonth}
                          onChange={(monthKey) => {
                            // Clamp into the charted window so the one-off lands.
                            const first = chartedMonths[0];
                            const last = chartedMonths.at(-1) ?? monthKey;
                            const clamped =
                              monthKey < first ? first : monthKey > last ? last : monthKey;
                            updateOneOff(row.id, { monthKey: clamped });
                          }}
                        />
                        <Select
                          value={row.kind}
                          onValueChange={(value) =>
                            updateOneOff(row.id, { kind: value as ScenarioOneOff['kind'] })
                          }
                        >
                          <SelectTrigger className="h-8 w-[110px]" size="sm">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="outflow">
                              <Trans>Outflow</Trans>
                            </SelectItem>
                            <SelectItem value="inflow">
                              <Trans>Inflow</Trans>
                            </SelectItem>
                          </SelectContent>
                        </Select>
                        <CalculatorCell
                          value={asMilli(row.amount)}
                          onCommit={(value) =>
                            updateOneOff(row.id, { amount: Math.max(0, Math.round(Number(value))) })
                          }
                          localizer={globalLocalizer}
                          formatter={(value) => globalLocalizer.format(value)}
                          placeholder={t`Amount`}
                          inputAlign="right"
                          zeroAsEmpty
                          className="w-[170px] shrink-0 overflow-hidden"
                          displayClassName="truncate"
                        />
                        <Input
                          value={row.label}
                          placeholder={t`Label (optional)`}
                          onChange={(event) => updateOneOff(row.id, { label: event.target.value })}
                          className="h-8 min-w-[120px] flex-1"
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground"
                          onClick={() => removeOneOff(row.id)}
                          aria-label={t`Remove one-off`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <LedgerTable
              title={<Trans>Projection</Trans>}
              rows={chartedPoints}
              rowKey={(point) => point.monthKey}
              maxHeightClassName="max-h-[420px]"
              columns={[
                {
                  key: 'month',
                  header: t`Month`,
                  render: (point) => shortMonthLabel(point.monthKey),
                },
                {
                  key: 'in',
                  header: t`In`,
                  align: 'right',
                  render: (point) =>
                    money.amount(
                      point.income + (oneOffGrossByMonth.get(point.monthKey)?.inflow ?? 0)
                    ),
                },
                {
                  key: 'out',
                  header: t`Out`,
                  align: 'right',
                  render: (point) =>
                    money.amount(
                      point.spending + (oneOffGrossByMonth.get(point.monthKey)?.outflow ?? 0)
                    ),
                  cellClassName: () => 'text-red-600 dark:text-red-300',
                },
                {
                  key: 'balance',
                  header: t`Balance`,
                  align: 'right',
                  render: (point) => money.amount(point.balance),
                  cellClassName: (point) => cn('font-medium', trendTextClass(point.balance)),
                },
              ]}
            />
            <div className="h-fit rounded-lg border border-border bg-card">
              <h3 className="border-b border-border px-4 py-2.5 text-sm font-semibold">
                <Trans>Save scenario</Trans>
              </h3>
              <div className="p-4">
                <div className="flex gap-2">
                  <Input
                    value={scenarioName}
                    onChange={(event) => setScenarioName(event.target.value)}
                    placeholder={t`Scenario name`}
                    className="h-8"
                  />
                  <Button
                    size="sm"
                    className="h-8"
                    onClick={() => void handleSave()}
                    disabled={!scenarioName.trim() || saveMutation.isPending}
                  >
                    <Save className="mr-1 h-3.5 w-3.5" />
                    {loadedId ? t`Update` : t`Save`}
                  </Button>
                </div>
                {saveMutation.isError ? (
                  <p className="mt-1 text-xs text-red-600 dark:text-red-300">
                    {saveMutation.error.message}
                  </p>
                ) : null}

                {saved.length > 0 ? (
                  <>
                    <h4 className="mb-1 mt-4 text-xs font-medium text-muted-foreground">
                      <Trans>Saved scenarios</Trans>
                    </h4>
                    <div className="divide-y divide-border/50">
                      {saved.map((record) => (
                        <div key={record.ID} className="flex items-center gap-1 py-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className={`h-8 flex-1 justify-start ${record.ID === loadedId ? 'font-semibold' : ''}`}
                            onClick={() => handleLoad(record.ID)}
                          >
                            {record.Name}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground"
                            onClick={() => {
                              deleteMutation.mutate({ id: record.ID });
                              if (record.ID === loadedId) setLoadedId(null);
                            }}
                            aria-label={t`Delete scenario ${record.Name}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  </>
                ) : null}
              </div>
            </div>
          </div>
        </>
      )}
    </ReportLayout>
  );
}
