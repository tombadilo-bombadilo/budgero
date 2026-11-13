import { Trans, useLingui } from '@lingui/react/macro';
import { useMemo, useState } from 'react';
import { ArrowDownRight, ArrowRight, ArrowUpRight } from 'lucide-react';
import type { EChartsCoreOption } from 'echarts/core';
import {
  createQuestion,
  previousPeriodQuestion,
  todayIso,
  trendDateFilter,
  trendPeriods,
  type QuestionDisplay,
  type QuestionSource,
  type QuestionSpec,
} from '@features/reports/lib/question';
import { EChart } from '@shared/ui/echart';
import { useChartPalette } from '@shared/lib/charts/echarts-chrome';
import { useUiStore } from '@shared/store/useUiStore';
import { cn } from '@shared/lib/utils';
import { buildChartModel, type ChartModel } from '../chart-model';
import { isCompleteBucket } from './summary';
import { columnLabel, formatBucketValue } from '../question-labels';
import { useQuestionFormatters, type QuestionFormatters } from '../useQuestionFormatters';
import { useQuestionQuery } from '../useQuestionQuery';
import { buildTrend, trendChange, type TrendData } from './transforms';
import { metricPolarity, withAlpha } from './display';
import type { VizViewProps } from './types';

/**
 * Big number per metric with the change against the period before: the
 * previous date bucket (date grouping) or the same span before the date
 * filter's range (re-run in the background). Date groupings add a sparkline.
 */
export function TrendNumberView({
  result,
  columns,
  source,
  display,
  spec,
  className,
}: VizViewProps) {
  const { t } = useLingui();
  const format = useQuestionFormatters(source, result);
  const full = useMemo(() => buildChartModel(result, columns), [result, columns]);
  const [includeRunning, setIncludeRunning] = useState(false);
  const today = todayIso();
  // The running period (this month so far) would compare a part with a whole:
  // by default the last complete period is the one shown.
  const running =
    full.x !== null &&
    full.xValues.length >= 2 &&
    !isCompleteBucket(full.x, full.xValues[full.xValues.length - 1], today);
  const model = useMemo(
    () => (running && !includeRunning ? withoutLastPoint(full) : full),
    [full, running, includeRunning]
  );
  const runningLabel =
    running && full.x?.kind === 'breakout' && full.x.breakout.bucket
      ? formatBucketValue(full.x.breakout.bucket, full.xValues[full.xValues.length - 1], 'long')
      : '';
  // "Previous period" / "% change" columns derive from a metric; they get no tile of their own.
  const metrics = columns.filter((column) => column.kind === 'aggregation' && !column.derived);
  const trends = metrics
    .map((metric) => buildTrend(result, metric, model))
    .filter((trend): trend is TrendData => trend !== null);
  const needsPrevious = !model.x && spec !== undefined && trendDateFilter(spec) !== null;
  // One background run for the previous period, shared by every metric's tile.
  const previous = usePreviousPeriod(needsPrevious ? spec : undefined);

  return (
    <div
      className={cn(
        'grid min-h-40 gap-6 py-4',
        trends.length > 1 ? 'sm:grid-cols-2' : '',
        trends.length > 2 ? 'lg:grid-cols-3' : '',
        className
      )}
      data-no-export
    >
      {running && (
        <div className="col-span-full -mb-2 flex justify-center">
          <button
            type="button"
            aria-pressed={includeRunning}
            onClick={() => setIncludeRunning((value) => !value)}
            className="rounded-full border px-3 py-1 text-xs text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {includeRunning
              ? t`Showing ${runningLabel} so far · show the last full period`
              : t`Showing the last full period · include ${runningLabel} so far`}
          </button>
        </div>
      )}
      {trends.map((trend) =>
        needsPrevious && spec ? (
          <PreviousPeriodTile
            key={trend.metric.key}
            previous={previous}
            trend={trend}
            source={source}
            format={format}
            display={display}
          />
        ) : (
          <TrendTile
            key={trend.metric.key}
            trend={trend}
            source={source}
            format={format}
            display={display}
            bucket={model.x?.kind === 'breakout' ? (model.x.breakout.bucket ?? null) : null}
          />
        )
      )}
    </div>
  );
}

function withoutLastPoint(model: ChartModel): ChartModel {
  return {
    ...model,
    xValues: model.xValues.slice(0, -1),
    xKeys: model.xKeys.slice(0, -1),
    series: model.series.map((series) => ({ ...series, values: series.values.slice(0, -1) })),
  };
}

interface PreviousPeriod {
  query: ReturnType<typeof useQuestionQuery>;
  /** "1 Mar – 31 Mar" of the previous span, or ''. */
  label: string;
}

/** The question re-run over the span before its date filter; idle without a spec. */
function usePreviousPeriod(spec: QuestionSpec | undefined): PreviousPeriod {
  const budgetId = useUiStore((state) => state.selectedBudget?.ID ?? 0);
  const today = todayIso();
  const previousSpec = useMemo(
    () => (spec ? previousPeriodQuestion(spec, today) : null),
    [spec, today]
  );
  const periods = useMemo(() => {
    const filter = spec ? trendDateFilter(spec) : null;
    return filter ? trendPeriods(filter, today) : null;
  }, [spec, today]);
  const query = useQuestionQuery({
    spec: previousSpec ?? EMPTY_SPEC,
    budgetId,
    enabled: previousSpec !== null,
  });
  const label = periods
    ? `${formatBucketValue('day', periods.previous.from)} – ${formatBucketValue('day', periods.previous.to)}`
    : '';
  return { query, label };
}

const EMPTY_SPEC = createQuestion();

function PreviousPeriodTile({
  previous: { query, label },
  trend,
  source,
  format,
  display,
}: {
  previous: PreviousPeriod;
  trend: TrendData;
  source: QuestionSource;
  format: QuestionFormatters;
  display?: QuestionDisplay;
}) {
  const index = query.result?.columns.indexOf(trend.metric.key) ?? -1;
  const raw = index >= 0 ? query.result?.rows[0]?.[index] : undefined;
  const previous = query.result ? (raw === undefined || raw === null ? 0 : Number(raw)) : null;
  return (
    <TrendTile
      trend={{ ...trend, previous: Number.isFinite(previous) ? previous : null }}
      source={source}
      format={format}
      display={display}
      bucket={null}
      previousLabel={label}
      loading={!query.result && !query.error && query.isRunning}
    />
  );
}

function TrendTile({
  trend,
  source,
  format,
  display,
  bucket,
  previousLabel,
  loading = false,
}: {
  trend: TrendData;
  source: QuestionSource;
  format: QuestionFormatters;
  display?: QuestionDisplay;
  bucket: Parameters<typeof formatBucketValue>[0] | null;
  previousLabel?: string;
  loading?: boolean;
}) {
  const { t } = useLingui();
  const palette = useChartPalette();
  const { metric, current, previous } = trend;
  const label = columnLabel(source, metric);
  const change = previous !== null ? trendChange(current, previous) : null;
  const polarity = metricPolarity(metric);
  const direction = change ? Math.sign(change.delta) : 0;
  const good = direction * polarity > 0;
  const changeColor =
    direction === 0
      ? palette.chrome.inkSecondary
      : good
        ? palette.flow.positive
        : palette.flow.negative;
  const ArrowIcon = direction > 0 ? ArrowUpRight : direction < 0 ? ArrowDownRight : ArrowRight;
  const percent =
    change?.ratio !== null && change?.ratio !== undefined
      ? `${change.ratio > 0 ? '+' : change.ratio < 0 ? '−' : ''}${Math.abs(change.ratio * 100).toFixed(1)}%`
      : null;
  const deltaText = change
    ? `${change.delta > 0 ? '+' : change.delta < 0 ? '−' : ''}${format.cell(metric, Math.abs(change.delta))}`
    : '';
  const currentPeriod =
    bucket && trend.currentX !== null ? formatBucketValue(bucket, trend.currentX, 'long') : '';
  const previousPeriod =
    previousLabel ??
    (bucket && trend.previousX !== null ? formatBucketValue(bucket, trend.previousX, 'long') : '');
  const goal = display?.goal;
  const goalShare = goal ? Math.round((current / goal) * 100) : null;
  const goalText = goal !== undefined ? format.cell(metric, goal) : '';

  return (
    <div className="flex min-w-0 flex-col items-center justify-center gap-2 text-center">
      <div className="text-sm text-muted-foreground">
        {label}
        {currentPeriod && <span> · {currentPeriod}</span>}
      </div>
      <div className="text-4xl font-semibold tabular-nums sm:text-5xl">
        {format.cell(metric, current)}
      </div>
      {loading ? (
        <div className="h-5 text-xs text-muted-foreground">
          <Trans>Comparing with the period before…</Trans>
        </div>
      ) : change ? (
        <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-sm">
          <span
            className="inline-flex items-center gap-1 font-medium tabular-nums"
            style={{ color: changeColor }}
          >
            <ArrowIcon className="h-4 w-4" aria-hidden />
            {percent ?? deltaText}
          </span>
          <span className="text-muted-foreground">
            {percent ? `${deltaText} · ` : ''}
            {previousPeriod ? t`vs ${previousPeriod}` : t`vs the period before`}
          </span>
        </div>
      ) : (
        <div className="text-xs text-muted-foreground">
          <Trans>No earlier period to compare with.</Trans>
        </div>
      )}
      {goalShare !== null && (
        <div className="w-full max-w-60 space-y-1">
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.max(0, Math.min(100, goalShare))}%`,
                backgroundColor: palette.series[0],
              }}
            />
          </div>
          <div className="text-xs text-muted-foreground tabular-nums">
            {t`${goalShare}% of the ${goalText} goal`}
          </div>
        </div>
      )}
      {trend.points.length > 1 && (
        <Sparkline trend={trend} color={palette.series[0]} format={format} bucket={bucket} />
      )}
    </div>
  );
}

function Sparkline({
  trend,
  color,
  format,
  bucket,
}: {
  trend: TrendData;
  color: string;
  format: QuestionFormatters;
  bucket: Parameters<typeof formatBucketValue>[0] | null;
}) {
  const { t } = useLingui();
  const palette = useChartPalette();
  const option = useMemo<EChartsCoreOption>(() => {
    const values = trend.points.map((point) => point.value);
    return {
      grid: { left: 2, right: 2, top: 4, bottom: 2 },
      xAxis: { type: 'category' as const, show: false, data: values.map((_, index) => index) },
      yAxis: { type: 'value' as const, show: false, scale: true },
      tooltip: {
        trigger: 'axis' as const,
        backgroundColor: palette.chrome.surface,
        borderColor: palette.chrome.grid,
        textStyle: { color: palette.chrome.inkPrimary, fontSize: 11 },
        formatter: (params: unknown) => {
          const [item] = params as { dataIndex: number }[];
          const point = trend.points[item?.dataIndex ?? 0];
          const when = bucket ? formatBucketValue(bucket, point.x) : '';
          return `${when}: ${format.cell(trend.metric, point.value)}`;
        },
      },
      series: [
        {
          type: 'line' as const,
          data: values,
          smooth: true,
          showSymbol: false,
          lineStyle: { color, width: 2 },
          areaStyle: { color: withAlpha(color, 0.15) },
          markPoint: {
            symbol: 'circle',
            symbolSize: 6,
            itemStyle: { color },
            label: { show: false },
            data: [{ coord: [values.length - 1, values[values.length - 1]] }],
          },
        },
      ],
    };
  }, [trend, color, palette, format, bucket]);
  return <EChart option={option} ariaLabel={t`Trend`} className="h-14 w-full max-w-72" />;
}
