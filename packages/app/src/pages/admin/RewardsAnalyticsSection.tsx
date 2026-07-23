import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@shared/ui/card';
import { Button } from '@shared/ui/button';
import { Input } from '@shared/ui/input';
import { Label } from '@shared/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@shared/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@shared/ui/table';
import type { EChartsCoreOption } from 'echarts/core';
import { EChart } from '@shared/ui/echart';
import {
  tooltipBase,
  tooltipHtml,
  useChartPalette,
  type TooltipRow,
} from '@shared/lib/charts/echarts-chrome';
import { Sparkles, TrendingUp } from 'lucide-react';
import { useAdminApi } from '@features/admin/api/useAdminApi';
import type {
  RewardsAnalytics,
  RewardsAnalyticsGranularity,
  TimeSeriesPoint,
  FunnelCohort,
} from '@features/admin/model/admin-dashboard';
import { dateInputToISO } from './admin-analytics.utils';
import { useAnalyticsQuery } from './useAnalyticsQuery';

/** Sum the count column across a series. */
function totalOf(points: TimeSeriesPoint[]): number {
  return points.reduce((acc, p) => acc + p.count, 0);
}

/**
 * Combine all 6 series into recharts-compatible row format keyed by period.
 * Each row has { period, signups, subscriptions, tier1, tier2, tier3, redemptions }.
 */
function combineSeries(data: RewardsAnalytics) {
  const map = new Map<string, Record<string, number | string>>();
  const ensure = (period: string) => {
    let row = map.get(period);
    if (!row) {
      row = {
        period,
        signups: 0,
        subscriptions: 0,
        tier1: 0,
        tier2: 0,
        tier3: 0,
        redemptions: 0,
      };
      map.set(period, row);
    }
    return row;
  };
  for (const p of data.series.signups) ensure(p.period).signups = p.count;
  for (const p of data.series.subscriptions) ensure(p.period).subscriptions = p.count;
  for (const p of data.series.tier1_unlocks) ensure(p.period).tier1 = p.count;
  for (const p of data.series.tier2_unlocks) ensure(p.period).tier2 = p.count;
  for (const p of data.series.tier3_unlocks) ensure(p.period).tier3 = p.count;
  for (const p of data.series.redemptions) ensure(p.period).redemptions = p.count;
  return Array.from(map.values()).sort((a, b) => String(a.period).localeCompare(String(b.period)));
}

function pct(num: number, den: number): string {
  if (den <= 0) return '—';
  return `${((num / den) * 100).toFixed(1)}%`;
}

/** Chart series in fixed palette-slot order (colors come from palette.series). */
const REWARDS_SERIES = [
  { key: 'signups', name: 'Signups' },
  { key: 'subscriptions', name: 'New subs' },
  { key: 'tier1', name: 'Tier 1' },
  { key: 'tier2', name: 'Tier 2' },
  { key: 'tier3', name: 'Tier 3' },
  { key: 'redemptions', name: 'Redemptions' },
] as const;

export default function RewardsAnalyticsSection() {
  const adminApi = useAdminApi();

  const [granularity, setGranularity] = useState<RewardsAnalyticsGranularity>('daily');

  // Default range: last 30 days, daily granularity. Subsequent loads happen
  // via the Apply button (which calls fetchData with the current inputs).
  const { from, setFrom, to, setTo, data, loading, fetchData } = useAnalyticsQuery<
    RewardsAnalytics,
    [RewardsAnalyticsGranularity]
  >({
    defaultDaysBack: 30,
    errorMessage: 'Failed to load rewards analytics',
    initialArgs: ['daily'],
    fetcher: (f, t, g) => adminApi.getRewardsAnalytics(dateInputToISO(f), dateInputToISO(t), g),
  });

  const totals = useMemo(() => {
    if (!data) return null;
    return {
      signups: totalOf(data.series.signups),
      subscriptions: totalOf(data.series.subscriptions),
      tier1: totalOf(data.series.tier1_unlocks),
      tier2: totalOf(data.series.tier2_unlocks),
      tier3: totalOf(data.series.tier3_unlocks),
      redemptions: totalOf(data.series.redemptions),
    };
  }, [data]);

  const chartData = useMemo(() => (data ? combineSeries(data) : []), [data]);

  const palette = useChartPalette();

  const chartOption = useMemo<EChartsCoreOption>(() => {
    const { chrome } = palette;
    const seriesColor = (index: number) => palette.series[index % palette.series.length];
    const readCount = (row: Record<string, number | string>, key: string): number =>
      Number(row[key] ?? 0);
    return {
      grid: { left: 8, right: 16, top: 16, bottom: 4, containLabel: true },
      xAxis: {
        type: 'category',
        data: chartData.map((row) => String(row.period)),
        axisLine: { lineStyle: { color: chrome.axisLine } },
        axisTick: { show: false },
        axisLabel: { color: chrome.axisText, fontSize: 11, hideOverlap: true },
      },
      yAxis: {
        type: 'value',
        minInterval: 1,
        axisLine: { show: false },
        splitLine: { lineStyle: { color: chrome.grid, width: 1 } },
        axisLabel: { color: chrome.axisText, fontSize: 11 },
      },
      tooltip: {
        ...tooltipBase(chrome),
        trigger: 'axis' as const,
        axisPointer: { type: 'line' as const, lineStyle: { color: chrome.axisLine } },
        formatter: (params: unknown) => {
          const items = params as { dataIndex: number }[];
          const row = chartData[items[0]?.dataIndex ?? 0];
          if (!row) return '';
          const rows: TooltipRow[] = REWARDS_SERIES.map((def, index) => ({
            color: seriesColor(index),
            name: def.name,
            value: readCount(row, def.key).toLocaleString(),
          }));
          return tooltipHtml(String(row.period), rows);
        },
      },
      series: REWARDS_SERIES.map((def, index) => ({
        name: def.name,
        type: 'line' as const,
        data: chartData.map((row) => readCount(row, def.key)),
        lineStyle: { color: seriesColor(index), width: 2 },
        itemStyle: { color: seriesColor(index), borderColor: chrome.surface, borderWidth: 2 },
        symbol: 'circle',
        symbolSize: 8,
        showSymbol: chartData.length <= 30,
      })),
    };
  }, [chartData, palette]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-amber-500" />
          Rewards Analytics
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Filter bar */}
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[140px]">
            <Label htmlFor="analytics-from" className="text-xs">
              From
            </Label>
            <Input
              id="analytics-from"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </div>
          <div className="flex-1 min-w-[140px]">
            <Label htmlFor="analytics-to" className="text-xs">
              To
            </Label>
            <Input
              id="analytics-to"
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </div>
          <div className="flex-1 min-w-[140px]">
            <Label htmlFor="analytics-granularity" className="text-xs">
              Granularity
            </Label>
            <Select
              value={granularity}
              onValueChange={(v) => setGranularity(v as RewardsAnalyticsGranularity)}
            >
              <SelectTrigger id="analytics-granularity">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="daily">Daily</SelectItem>
                <SelectItem value="weekly">Weekly</SelectItem>
                <SelectItem value="monthly">Monthly</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button onClick={() => void fetchData(from, to, granularity)} disabled={loading}>
            {loading ? 'Loading…' : 'Apply'}
          </Button>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <SummaryCard label="Signups" value={totals?.signups ?? 0} />
          <SummaryCard label="New subs" value={totals?.subscriptions ?? 0} />
          <SummaryCard label="Tier 1 unlocks" value={totals?.tier1 ?? 0} />
          <SummaryCard label="Tier 2 unlocks" value={totals?.tier2 ?? 0} />
          <SummaryCard label="Tier 3 unlocks" value={totals?.tier3 ?? 0} />
          <SummaryCard label="Redemptions" value={totals?.redemptions ?? 0} />
        </div>

        {/* Time series chart */}
        <div className="rounded-lg border p-4">
          <div className="flex items-center gap-2 mb-3 text-sm font-medium">
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
            Time series
          </div>
          {chartData.length === 0 ? (
            <p className="text-sm text-muted-foreground py-12 text-center">
              No data in the selected range.
            </p>
          ) : (
            <>
              <EChart
                option={chartOption}
                className="h-[320px]"
                ariaLabel="Rewards time series: signups, subscriptions, tier unlocks and redemptions"
              />
              <div className="mt-3 flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                {REWARDS_SERIES.map((def, index) => (
                  <span key={def.key} className="inline-flex items-center gap-1.5">
                    <span
                      className="inline-block h-[3px] w-3 rounded-sm"
                      style={{ backgroundColor: palette.series[index % palette.series.length] }}
                    />
                    {def.name}
                  </span>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Cohort funnel */}
        <div className="rounded-lg border">
          <div className="flex items-center gap-2 px-4 py-3 border-b text-sm font-medium">
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
            Cohort funnel — by signup period
          </div>
          {!data || data.funnel.length === 0 ? (
            <p className="text-sm text-muted-foreground py-12 text-center">
              No signup cohorts in the selected range.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cohort</TableHead>
                  <TableHead className="text-right">Signups</TableHead>
                  <TableHead className="text-right">→ T1</TableHead>
                  <TableHead className="text-right">→ T2</TableHead>
                  <TableHead className="text-right">→ T3</TableHead>
                  <TableHead className="text-right">→ Subscribed</TableHead>
                  <TableHead className="text-right">Conv %</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.funnel.map((row: FunnelCohort) => (
                  <TableRow key={row.cohort}>
                    <TableCell className="font-mono text-xs">{row.cohort}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.signups}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.tier1}
                      <span className="text-muted-foreground ml-1 text-xs">
                        ({pct(row.tier1, row.signups)})
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.tier2}
                      <span className="text-muted-foreground ml-1 text-xs">
                        ({pct(row.tier2, row.signups)})
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.tier3}
                      <span className="text-muted-foreground ml-1 text-xs">
                        ({pct(row.tier3, row.signups)})
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{row.subscribed}</TableCell>
                    <TableCell className="text-right tabular-nums font-medium">
                      {pct(row.subscribed, row.signups)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value.toLocaleString()}</div>
    </div>
  );
}
