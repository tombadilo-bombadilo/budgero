import { Trans, useLingui } from '@lingui/react/macro';
import { useMemo, useState } from 'react';
import type { EChartsCoreOption } from 'echarts/core';
import { UserPlus } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@shared/ui/card';
import { Button } from '@shared/ui/button';
import { Input } from '@shared/ui/input';
import { Label } from '@shared/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@shared/ui/select';
import { EChart } from '@shared/ui/echart';
import { tooltipBase, tooltipHtml, useChartPalette } from '@shared/lib/charts/echarts-chrome';
import { useAdminApi } from '@features/admin/api/useAdminApi';
import type { AnalyticsGranularity, SignupSeries } from '@features/admin/model/admin-dashboard';
import { dateInputToISO } from './admin-analytics.utils';
import { useAnalyticsQuery } from './useAnalyticsQuery';

/** SaaS admin only: signups per day, week or month over a date range (UTC). */
export default function SignupsSection() {
  const { t } = useLingui();
  const adminApi = useAdminApi();
  const palette = useChartPalette();
  const [granularity, setGranularity] = useState<AnalyticsGranularity>('daily');

  const { from, setFrom, to, setTo, data, loading, fetchData } = useAnalyticsQuery<
    SignupSeries,
    [AnalyticsGranularity]
  >({
    defaultDaysBack: 89,
    errorMessage: t`Failed to load signups`,
    initialArgs: ['daily'],
    fetcher: (f, end, g) => adminApi.getSignups(dateInputToISO(f), dateInputToISO(end), g),
  });

  const points = useMemo(() => data?.points ?? [], [data]);

  const option = useMemo<EChartsCoreOption>(() => {
    const { chrome } = palette;
    const color = palette.series[0];
    const label = (start: string) =>
      data?.granularity === 'monthly' ? start.slice(0, 7) : start.slice(5);
    return {
      grid: { left: 8, right: 16, top: 16, bottom: 4, containLabel: true },
      xAxis: {
        type: 'category',
        data: points.map((p) => label(p.start)),
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
        formatter: (params: unknown) => {
          const point = points[(params as { dataIndex: number }[])[0]?.dataIndex ?? 0];
          if (!point) return '';
          const title =
            data?.granularity === 'daily'
              ? point.start
              : data?.granularity === 'weekly'
                ? t`Week of ${point.start}`
                : point.start.slice(0, 7);
          return tooltipHtml(title, [{ color, name: t`Signups`, value: String(point.signups) }]);
        },
      },
      series: [
        {
          name: t`Signups`,
          type: 'bar',
          data: points.map((p) => p.signups),
          itemStyle: { color },
          barMaxWidth: 32,
        },
      ],
    };
  }, [points, data?.granularity, palette, t]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Trans>
            <UserPlus className="h-5 w-5 text-blue-500" />
            Signups
          </Trans>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
          <div className="space-y-1.5">
            <Label htmlFor="signups-from">
              <Trans>From</Trans>
            </Label>
            <Input
              id="signups-from"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="signups-to">
              <Trans>To</Trans>
            </Label>
            <Input id="signups-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="signups-group">
              <Trans>Group by</Trans>
            </Label>
            <Select
              value={granularity}
              onValueChange={(v) => setGranularity(v as AnalyticsGranularity)}
            >
              <SelectTrigger id="signups-group">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="daily">
                  <Trans>Day</Trans>
                </SelectItem>
                <SelectItem value="weekly">
                  <Trans>Week</Trans>
                </SelectItem>
                <SelectItem value="monthly">
                  <Trans>Month</Trans>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button onClick={() => void fetchData(from, to, granularity)} disabled={loading}>
            {loading ? t`Loading…` : t`Apply`}
          </Button>
        </div>

        <div className="text-sm text-muted-foreground">
          {data ? (
            <Trans>
              <span className="text-2xl font-semibold text-foreground tabular-nums">
                {data.total}
              </span>{' '}
              signups from {data.from} to {data.to} (UTC)
            </Trans>
          ) : (
            <Trans>No data yet</Trans>
          )}
        </div>

        {points.length > 0 && (
          <EChart option={option} className="h-64 w-full" ariaLabel={t`Signups over time`} />
        )}
      </CardContent>
    </Card>
  );
}
