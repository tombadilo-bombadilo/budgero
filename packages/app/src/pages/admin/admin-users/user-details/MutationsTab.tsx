import { useMemo } from 'react';
import { format, parseISO } from 'date-fns';
import type { EChartsCoreOption } from 'echarts/core';

import { EChart } from '@shared/ui/echart';
import {
  tooltipBase,
  tooltipHtml,
  useChartPalette,
  BAR_MAX_WIDTH,
  BAR_RADIUS_TOP,
} from '@shared/lib/charts/echarts-chrome';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import type { AdminUserDetails } from '@features/admin/model/admin-users';
import { TabSection } from './TabSection';
import { CompactMetric, EmptyState, SectionError } from './primitives';

export function MutationsTab({
  details,
  loading,
  error,
  onRetry,
}: {
  details: AdminUserDetails | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  const palette = useChartPalette();
  const days = details?.mutations.days;

  const chartOption = useMemo<EChartsCoreOption>(() => {
    const { chrome } = palette;
    const barColor = palette.series[0];
    const points = days ?? [];
    return {
      grid: { left: 8, right: 16, top: 16, bottom: 4, containLabel: true },
      xAxis: {
        type: 'category',
        data: points.map((entry) => entry.day),
        axisLine: { lineStyle: { color: chrome.axisLine } },
        axisTick: { show: false },
        axisLabel: {
          color: chrome.axisText,
          fontSize: 11,
          hideOverlap: true,
          formatter: (value: string) => format(parseISO(value), 'MMM d'),
        },
      },
      yAxis: {
        type: 'value',
        minInterval: 1,
        axisLine: { show: false },
        splitLine: { lineStyle: { color: chrome.grid, width: 1 } },
        // The original chart drew grid lines but no y-axis tick labels.
        axisLabel: { show: false },
      },
      tooltip: {
        ...tooltipBase(chrome),
        trigger: 'axis' as const,
        axisPointer: { type: 'line' as const, lineStyle: { color: chrome.axisLine } },
        formatter: (params: unknown) => {
          const items = params as { dataIndex: number }[];
          const point = points[items[0]?.dataIndex ?? 0];
          if (!point) return '';
          return tooltipHtml(format(parseISO(point.day), 'MMM d, yyyy'), [
            { color: barColor, name: 'Count', value: `${point.count} mutations` },
          ]);
        },
      },
      series: [
        {
          name: 'Count',
          type: 'bar',
          data: points.map((entry) => entry.count),
          barMaxWidth: BAR_MAX_WIDTH,
          itemStyle: { color: barColor, borderRadius: BAR_RADIUS_TOP },
        },
      ],
    };
  }, [days, palette]);

  return (
    <TabSection loading={loading} error={error} onRetry={onRetry}>
      <Card>
        <CardHeader>
          <CardTitle>Mutation KPIs</CardTitle>
          <CardDescription>
            All-time totals with a daily activity view for the current window.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          <CompactMetric
            label="All-Time Mutations"
            value={`${details?.mutations.totalMutations ?? 0}`}
          />
          <CompactMetric label="Active Days" value={`${details?.mutations.activeDays ?? 0}`} />
          <CompactMetric
            label="Avg / Active Day"
            value={(details?.mutations.avgPerActiveDay ?? 0).toFixed(1)}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Mutations Per Day</CardTitle>
          <CardDescription>
            Daily mutation counts over the same{' '}
            {details?.activity?.windowDays ?? details?.mutations.days?.length ?? 365}-day window.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <SectionError message={details?.sectionErrors?.mutations} />
          {days?.some((entry) => entry.count > 0) ? (
            <EChart option={chartOption} className="h-80" ariaLabel="Mutations per day" />
          ) : (
            <EmptyState message="No mutation activity in the current window." />
          )}
        </CardContent>
      </Card>
    </TabSection>
  );
}
