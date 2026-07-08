import { useCallback, useMemo } from 'react';
import { Cell, Pie, PieChart } from 'recharts';
import { buttonizeProps } from '@shared/lib/a11y';
import { ChartConfig, ChartContainer, ChartTooltip } from '@shared/ui/chart';
import { ChartEmptyState } from '@shared/ui/ChartEmptyState';
import { useUiStore } from '@shared/store/useUiStore';
import { formatMaskedAmount } from '@shared/lib/privacy/mask-numbers';
import { CHART_COLORS } from './chart-viewer/chart-viewer.utils';

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

  const chartData = useMemo(
    () => data.filter((item) => item.value > 0).sort((a, b) => b.value - a.value),
    [data]
  );

  const colorFor = useCallback(
    (item: T, index: number) => item.color || CHART_COLORS[index % CHART_COLORS.length],
    []
  );

  const chartConfig = useMemo<ChartConfig>(() => {
    const config: ChartConfig = {};
    chartData.forEach((item, index) => {
      config[item.name] = { label: item.name, color: colorFor(item, index) };
    });
    return config;
  }, [chartData, colorFor]);

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
        <ChartContainer config={chartConfig} className="h-full w-full">
          <PieChart>
            <Pie
              data={chartData}
              cx="50%"
              cy="50%"
              innerRadius={50}
              outerRadius={90}
              paddingAngle={2}
              dataKey="value"
            >
              {chartData.map((entry, index) => (
                <Cell
                  key={`cell-${entry.name}`}
                  fill={colorFor(entry, index)}
                  style={interactive ? { cursor: 'pointer' } : undefined}
                  onClick={interactive ? () => onSliceClick?.(entry) : undefined}
                />
              ))}
            </Pie>
            <ChartTooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const slice = payload[0];
                return (
                  <div className="rounded-lg border border-border/50 bg-background px-3 py-2 text-xs shadow-xl">
                    <div className="flex items-center gap-2">
                      <div
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: slice.color }}
                      />
                      <span className="font-medium">{slice.name}</span>
                    </div>
                    <div className="mt-1 font-mono text-sm">
                      {formatMaskedAmount(
                        globalLocalizer,
                        slice.value as number,
                        privacyMaskNumbers
                      )}
                    </div>
                  </div>
                );
              }}
            />
          </PieChart>
        </ChartContainer>
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
