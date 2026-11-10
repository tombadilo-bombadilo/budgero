import { Trans, useLingui } from '@lingui/react/macro';
import { Target } from 'lucide-react';
import { useChartPalette } from '@shared/lib/charts/echarts-chrome';
import { cn } from '@shared/lib/utils';
import { columnLabel } from '../question-labels';
import { useQuestionFormatters } from '../useQuestionFormatters';
import { metricPolarity } from './display';
import { progressOf } from './progress';
import type { VizViewProps } from './types';

/**
 * One number against the chart's goal: a bar filled to the share reached,
 * the value, the goal and the percent. Past the goal the bar fills and the
 * overshoot is called out, in the metric's good / bad colour.
 */
export function ProgressView({
  result,
  columns,
  source,
  display,
  fitHeight,
  className,
}: VizViewProps) {
  const { t } = useLingui();
  const palette = useChartPalette();
  const format = useQuestionFormatters(source, result);
  const metric = columns.find((column) => column.kind === 'aggregation' && !column.derived);
  const index = metric ? result.columns.indexOf(metric.key) : -1;
  const raw = index >= 0 ? result.rows[0]?.[index] : undefined;
  const value = Number(raw ?? 0);
  if (!metric) return null;
  const label = columnLabel(source, metric);
  const progress = progressOf(Number.isFinite(value) ? value : 0, display?.goal);
  const valueText = format.cell(metric, value);

  if (!progress) {
    return (
      <div
        className={cn(
          'flex min-h-40 flex-col items-center justify-center gap-2 py-4 text-center',
          fitHeight && 'h-full',
          className
        )}
      >
        <div className="text-sm text-muted-foreground">{label}</div>
        <div className="text-4xl font-semibold tabular-nums sm:text-5xl">{valueText}</div>
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Target className="h-3.5 w-3.5" aria-hidden />
          {display?.goal !== undefined ? (
            <Trans>Set a goal above zero in Settings to see progress.</Trans>
          ) : (
            <Trans>Set a goal in Settings to see progress.</Trans>
          )}
        </p>
      </div>
    );
  }

  const goalText = format.cell(metric, progress.goal);
  const percentText = format.masked ? '•••' : format.percent(progress.ratio, 0);
  const good = metricPolarity(metric) > 0;
  const overColor = good ? palette.flow.positive : palette.flow.negative;
  const fill = palette.series[0];
  const overText = format.cell(metric, progress.over);
  const leftText = format.cell(metric, progress.left);
  return (
    <div
      className={cn(
        'flex min-h-40 flex-col justify-center gap-3 px-2 py-4',
        fitHeight && 'h-full',
        className
      )}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <div className="min-w-0">
          <div className="truncate text-sm text-muted-foreground">{label}</div>
          <div className="text-3xl font-semibold tabular-nums sm:text-4xl">{valueText}</div>
        </div>
        <div className="text-right">
          <div
            className="text-2xl font-semibold tabular-nums"
            style={{ color: progress.over > 0 ? overColor : undefined }}
          >
            {percentText}
          </div>
          <div className="text-xs text-muted-foreground tabular-nums">{t`of ${goalText}`}</div>
        </div>
      </div>
      <div
        className="relative h-3 w-full overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(Math.min(progress.ratio, 1) * 100)}
        aria-label={t`${label}: ${percentText} of the goal`}
      >
        <div
          className="h-full rounded-full transition-[width]"
          style={{
            width: `${Math.min(progress.ratio, 1) * 100}%`,
            backgroundColor: progress.over > 0 ? overColor : fill,
          }}
        />
      </div>
      {progress.over > 0 ? (
        <p className="text-xs font-medium" style={{ color: overColor }}>
          {t`${overText} over the goal`}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">{t`${leftText} to go`}</p>
      )}
    </div>
  );
}
