import { Trans, useLingui } from '@lingui/react/macro';
import { useMemo, useState } from 'react';
import type { EChartsCoreOption } from 'echarts/core';
import { EChart, type EChartClickParams } from '@shared/ui/echart';
import { tooltipBase, tooltipHtml, useChartPalette } from '@shared/lib/charts/echarts-chrome';
import { getLocaleTag } from '@shared/i18n';
import { Button } from '@shared/ui/button';
import { cn } from '@shared/lib/utils';
import { columnLabel, formatBucketValue } from '../question-labels';
import { useQuestionFormatters } from '../useQuestionFormatters';
import { metricPolarity, withAlpha } from './display';
import { buildCalendar } from './transforms';
import type { VizViewProps } from './types';

interface CalendarHeatmapViewProps extends VizViewProps {
  /** Click on a day (ISO date), e.g. to filter the question to it. */
  onDayClick?: (day: string) => void;
}

function percentile(values: number[], share: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(share * (sorted.length - 1)))];
}

function monthNames(locale: string): string[] {
  const format = new Intl.DateTimeFormat(locale, { month: 'short' });
  return Array.from({ length: 12 }, (_, month) => format.format(new Date(2024, month, 1)));
}

function dayNames(locale: string): string[] {
  const format = new Intl.DateTimeFormat(locale, { weekday: 'narrow' });
  // ECharts wants Sunday first; 2024-01-07 was a Sunday.
  return Array.from({ length: 7 }, (_, day) => format.format(new Date(2024, 0, 7 + day)));
}

/**
 * A year of daily values as a GitHub-style calendar: one cell per day, darker
 * = more. Days with negative values (e.g. net) use a diverging scale.
 */
export function CalendarHeatmapView({
  result,
  columns,
  source,
  fitHeight,
  className,
  onDayClick,
}: CalendarHeatmapViewProps) {
  const { t } = useLingui();
  const palette = useChartPalette();
  const format = useQuestionFormatters(source);
  const years = useMemo(() => buildCalendar(result, columns), [result, columns]);
  const [pickedYear, setPickedYear] = useState<number | null>(null);
  const year = years.find((entry) => entry.year === pickedYear) ?? years[0];
  const metric = columns.find((column) => column.kind === 'aggregation');

  const option = useMemo<EChartsCoreOption | null>(() => {
    if (!year || !metric) return null;
    const { chrome } = palette;
    const locale = getLocaleTag();
    const diverging = year.min < 0 && year.max > 0;
    // Scale to the 95th percentile so a few big days (rent) don't wash out the rest.
    const top = percentile(
      year.days.map(([, value]) => Math.abs(value)),
      0.95
    );
    const bound = top || Math.max(Math.abs(year.min), Math.abs(year.max)) || 1;
    const low = diverging ? -bound : Math.min(0, year.min);
    const high = diverging ? bound : Math.min(year.max, bound) || 1;
    const polarity = metricPolarity(metric);
    const good = palette.flow.positive;
    const bad = palette.flow.negative;
    const inRange = diverging
      ? [polarity > 0 ? bad : good, withAlpha(palette.series[0], 0.08), polarity > 0 ? good : bad]
      : [withAlpha(palette.series[0], 0.18), palette.series[0]];
    return {
      tooltip: {
        ...tooltipBase(chrome),
        trigger: 'item' as const,
        formatter: (params: unknown) => {
          const { value } = params as { value: [string, number] };
          return tooltipHtml(formatBucketValue('day', value[0], 'long'), [
            {
              color: palette.series[0],
              name: columnLabel(source, metric),
              value: format.cell(metric, value[1]),
            },
          ]);
        },
      },
      visualMap: {
        type: 'continuous' as const,
        min: low,
        max: high,
        calculable: false,
        text: [`${format.compact(metric, high)}+`, format.compact(metric, low)],
        textGap: 6,
        orient: 'horizontal' as const,
        left: 'center',
        bottom: 0,
        itemHeight: 160,
        itemWidth: 10,
        inRange: { color: inRange },
        textStyle: { color: chrome.axisText, fontSize: 10 },
      },
      calendar: {
        range: String(year.year),
        top: 28,
        left: 36,
        right: 12,
        bottom: 52,
        cellSize: ['auto', 'auto'],
        orient: 'horizontal' as const,
        splitLine: { show: false },
        itemStyle: {
          color: withAlpha(palette.series[0], 0.05),
          borderColor: chrome.surface,
          borderWidth: 3,
        },
        yearLabel: { show: false },
        dayLabel: {
          firstDay: 1,
          nameMap: dayNames(locale),
          color: chrome.axisText,
          fontSize: 10,
        },
        monthLabel: { nameMap: monthNames(locale), color: chrome.axisText, fontSize: 11 },
      },
      series: [
        {
          type: 'heatmap' as const,
          coordinateSystem: 'calendar' as const,
          data: year.days,
          itemStyle: { borderColor: chrome.surface, borderWidth: 2, borderRadius: 2 },
          emphasis: { itemStyle: { borderColor: chrome.inkPrimary, borderWidth: 1 } },
        },
      ],
    };
  }, [year, metric, palette, format, source]);

  if (!option || !year || !metric) {
    return (
      <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
        <Trans>Nothing to chart for these rows.</Trans>
      </div>
    );
  }
  const total = format.cell(metric, year.total);
  const activeDays = year.days.length;
  const yearText = String(year.year);
  return (
    <div className={cn('flex min-h-0 flex-col gap-2', fitHeight && 'h-full', className)}>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>{t`${yearText}: ${total} over ${activeDays} days`}</span>
        {years.length > 1 && (
          <div className="flex flex-wrap gap-1" role="group" aria-label={t`Year`}>
            {years.slice(0, 12).map((entry) => (
              <Button
                key={entry.year}
                type="button"
                size="sm"
                variant={entry.year === year.year ? 'secondary' : 'ghost'}
                aria-pressed={entry.year === year.year}
                className="h-7 px-2 text-xs"
                onClick={() => setPickedYear(entry.year)}
              >
                {entry.year}
              </Button>
            ))}
          </div>
        )}
      </div>
      <div className={cn('min-h-0 w-full', fitHeight ? 'min-h-[180px] flex-1' : 'h-56')}>
        <EChart
          option={option}
          ariaLabel={t`Calendar heatmap`}
          className="h-full w-full"
          onMarkClick={
            onDayClick
              ? (params: EChartClickParams) => {
                  const value = params.value as [string, number] | undefined;
                  if (value?.[0]) onDayClick(value[0]);
                }
              : undefined
          }
        />
      </div>
    </div>
  );
}
