import { Trans, useLingui } from '@lingui/react/macro';
import { useEffect, useMemo, useState } from 'react';
import type { EChartsCoreOption } from 'echarts/core';
import { Server } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import { EChart } from '@shared/ui/echart';
import { tooltipBase, tooltipHtml, useChartPalette } from '@shared/lib/charts/echarts-chrome';
import { useAdminApi } from '@features/admin/api/useAdminApi';
import type { SelfHostInstallSummary } from '@features/admin/model/admin-dashboard';

/**
 * SaaS admin only: weekly active self-host installs, counted as distinct
 * update-check senders per UTC week, plus self-host pings per version.
 */
export default function SelfHostInstallsSection() {
  const { t } = useLingui();
  const adminApi = useAdminApi();
  const palette = useChartPalette();
  const [data, setData] = useState<SelfHostInstallSummary | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    adminApi
      .getSelfHostInstalls()
      .then(setData)
      .catch((error: unknown) => {
        console.error('Failed to load self-host installs:', error);
        setFailed(true);
      });
  }, [adminApi]);

  const weeks = useMemo(() => data?.weeks ?? [], [data]);
  const lastFull = [...weeks].reverse().find((w) => !w.partial);
  const current = weeks.find((w) => w.partial);

  const option = useMemo<EChartsCoreOption>(() => {
    const { chrome } = palette;
    const color = palette.series[0];
    return {
      grid: { left: 8, right: 16, top: 16, bottom: 4, containLabel: true },
      xAxis: {
        type: 'category',
        data: weeks.map((w) => w.week.slice(5)),
        axisLine: { lineStyle: { color: chrome.axisLine } },
        axisTick: { show: false },
        axisLabel: { color: chrome.axisText, fontSize: 11 },
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
          const week = weeks[(params as { dataIndex: number }[])[0]?.dataIndex ?? 0];
          if (!week) return '';
          const title = week.partial ? t`Week of ${week.week} (so far)` : t`Week of ${week.week}`;
          return tooltipHtml(title, [
            { color, name: t`Active installs`, value: String(week.installs) },
          ]);
        },
      },
      series: [
        {
          name: t`Active installs`,
          type: 'bar',
          data: weeks.map((w) => ({
            value: w.installs,
            itemStyle: { color, opacity: w.partial ? 0.45 : 1 },
          })),
          barMaxWidth: 32,
        },
      ],
    };
  }, [weeks, palette, t]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Trans>
            <Server className="h-5 w-5 text-emerald-500" />
            Self-host installs
          </Trans>
        </CardTitle>
        <CardDescription>
          <Trans>
            Distinct servers sending the update check each week (UTC, Monday start). Installs with
            the check turned off aren’t counted.
          </Trans>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {failed ? (
          <p className="text-sm text-muted-foreground">
            <Trans>Couldn’t load self-host installs.</Trans>
          </p>
        ) : !data ? (
          <div className="h-48 animate-pulse rounded bg-muted" />
        ) : (
          <>
            <div className="flex flex-wrap gap-8">
              <div>
                <div className="text-3xl font-bold">{lastFull?.installs ?? '—'}</div>
                <div className="text-xs text-muted-foreground">
                  <Trans>Last full week</Trans>
                </div>
              </div>
              <div>
                <div className="text-3xl font-bold">{current?.installs ?? 0}</div>
                <div className="text-xs text-muted-foreground">
                  <Trans>This week so far</Trans>
                </div>
              </div>
            </div>
            {weeks.length > 0 ? (
              <EChart
                option={option}
                className="h-48 w-full"
                ariaLabel={t`Weekly active self-host installs`}
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                <Trans>No update checks counted yet.</Trans>
              </p>
            )}
            <div>
              <h3 className="mb-2 text-sm font-medium">
                <Trans>Pings by version, last {data.days} days</Trans>
              </h3>
              <div className="space-y-1">
                {data.versions.map((v) => (
                  <div key={v.version} className="flex items-center justify-between text-sm">
                    <span className="font-mono">{v.version}</span>
                    <span className="text-muted-foreground tabular-nums">
                      <Trans>
                        {v.pings} pings · {v.days} days
                      </Trans>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
