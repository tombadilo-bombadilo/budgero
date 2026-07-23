import { useCallback, useMemo } from 'react';
import type { EChartsCoreOption } from 'echarts/core';
import { buttonizeProps } from '@shared/lib/a11y';
import { EChart } from '@shared/ui/echart';
import {
  resolveCssColor,
  tooltipBase,
  tooltipHtml,
  useChartPalette,
} from '@shared/lib/charts/echarts-chrome';
import { ChartEmptyState } from '@shared/ui/ChartEmptyState';
import { useUiStore } from '@shared/store/useUiStore';
import { formatMaskedAmount } from '@shared/lib/privacy/mask-numbers';

export interface SpendingDonutDatum {
  /** Display name (legend + tooltip). */
  name: string;
  /** Positive spending amount. Non-positive values are filtered out. */
  value: number;
  /** Optional explicit slice color (e.g. a label's color). Falls back to the chart palette. */
  color?: string;
}

interface SpendingDonutChartProps<T extends SpendingDonutDatum> {
  data: T[];
  isLoading?: boolean;
  emptyHint?: string;
  /**
   * When provided, slices and legend entries become clickable (with a pointer
   * cursor + legend hover affordance) and surface the full clicked datum. Omit
   * to render a static, non-interactive donut.
   */
  onSliceClick?: (datum: T) => void;
}

/**
 * Presentational donut (innerRadius) chart for a spending breakdown, matching the
 * category-group breakdown style: ring chart + masked tooltip + two-column legend.
 * Data fetching/shaping lives in the calling report component.
 */
export function SpendingDonutChart<T extends SpendingDonutDatum>({
  data,
  isLoading,
  emptyHint,
  onSliceClick,
}: SpendingDonutChartProps<T>) {
  const globalLocalizer = useUiStore((state) => state.globalLocalizer);
  const privacyMaskNumbers = useUiStore((state) => state.privacyMaskNumbers);
  const palette = useChartPalette();

  const chartData = useMemo(
    () => data.filter((item) => item.value > 0).sort((a, b) => b.value - a.value),
    [data]
  );

  const colorFor = useCallback(
    (item: T, index: number) => item.color || palette.series[index % palette.series.length],
    [palette]
  );

  const option = useMemo<EChartsCoreOption>(() => {
    const { chrome } = palette;
    // resolveCssColor: entity colors may be CSS vars, which canvas ignores.
    const sliceColor = (item: SpendingDonutDatum, index: number) =>
      item.color ? resolveCssColor(item.color) : palette.series[index % palette.series.length];

    return {
      tooltip: {
        ...tooltipBase(chrome),
        trigger: 'item' as const,
        formatter: (params: unknown) => {
          const item = params as { name: string; value: number; color?: string };
          return tooltipHtml(item.name, [
            {
              color: typeof item.color === 'string' ? item.color : chrome.other,
              name: '',
              value: formatMaskedAmount(globalLocalizer, item.value, privacyMaskNumbers),
            },
          ]);
        },
      },
      series: [
        {
          type: 'pie' as const,
          radius: ['48%', '76%'],
          padAngle: 1,
          data: chartData.map((item, index) => ({
            name: item.name,
            value: item.value,
            itemStyle: {
              color: sliceColor(item, index),
              borderColor: chrome.surface,
              borderWidth: 2,
            },
          })),
          // No slice labels: this card already has a full legend below and a
          // tooltip — leader-line labels just collide on the small canvas.
          label: { show: false },
          labelLine: { show: false },
          emphasis: { scaleSize: 4 },
        },
      ],
    };
  }, [chartData, palette, globalLocalizer, privacyMaskNumbers]);

  if (isLoading) {
    return (
      <div className="flex h-[300px] items-center justify-center">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (chartData.length === 0) {
    return <ChartEmptyState hint={emptyHint} />;
  }

  const interactive = Boolean(onSliceClick);

  return (
    <div className="space-y-3">
      <div className="h-[250px]">
        <EChart
          option={option}
          ariaLabel="Spending breakdown donut chart"
          className="h-[250px]"
          onMarkClick={
            onSliceClick
              ? ({ dataIndex }) => {
                  const item = chartData[dataIndex];
                  if (item) onSliceClick(item);
                }
              : undefined
          }
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        {chartData.slice(0, 6).map((item, index) => (
          <div
            key={item.name}
            className={
              interactive
                ? 'flex cursor-pointer items-center gap-2 rounded p-1 text-sm hover:bg-muted'
                : 'flex items-center gap-2 p-1 text-sm'
            }
            {...(interactive ? buttonizeProps(() => onSliceClick?.(item)) : {})}
          >
            <div
              className="h-3 w-3 flex-shrink-0 rounded-full"
              style={{ backgroundColor: colorFor(item, index) }}
            />
            <span className="truncate">{item.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
