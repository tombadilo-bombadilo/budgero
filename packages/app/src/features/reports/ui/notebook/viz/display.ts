import { t } from '@lingui/core/macro';
/**
 * Display settings (values on marks, goal line) applied to a finished
 * cartesian ECharts option, so chart views stay unaware of them.
 */
import type { QuestionColumn, QuestionDisplay } from '@features/reports/lib/question';
import type { ChartChrome } from '@shared/lib/charts/palette';
import { readableTextOn } from './series';

interface SeriesLike {
  type?: string;
  stack?: string;
  itemStyle?: { color?: unknown };
  label?: unknown;
  markLine?: unknown;
  [key: string]: unknown;
}

export interface CartesianDisplayOptions {
  chrome: ChartChrome;
  /** Formats a plotted value for a value label. */
  formatValue: (value: number) => string;
  /** Goal line caption, e.g. "Goal: €500". */
  goalLabel: string;
  /** Bars run left to right (row chart). */
  horizontal?: boolean;
  /** 100% stacked: no goal line (values are shares). */
  percent?: boolean;
  /** Formats a share (0..1) for a 100% stacked value label. */
  formatShare?: (ratio: number) => string;
}

/** Round `value` away from zero to a tidy axis bound (1 / 2 / 5 steps). */
function niceBound(value: number): number {
  const size = Math.abs(value);
  if (size === 0) return 0;
  const magnitude = 10 ** Math.floor(Math.log10(size));
  const step = [1, 2, 2.5, 5, 10].find((candidate) => candidate * magnitude >= size) ?? 10;
  return Math.sign(value) * step * magnitude;
}

/**
 * Value-axis bounds that keep the goal line on the chart: when the goal lies
 * beyond the data the axis stretches to it, otherwise ECharts picks as usual.
 */
export function goalAxisBounds(goal: number) {
  return {
    max: (extent: { max: number }) => (goal > extent.max ? niceBound(goal) : null),
    min: (extent: { min: number }) => (goal < extent.min ? niceBound(goal) : null),
  };
}

function withGoalBounds(axis: unknown, goal: number): unknown {
  const extend = (entry: unknown) =>
    entry && typeof entry === 'object' ? { ...entry, ...goalAxisBounds(goal) } : entry;
  return Array.isArray(axis)
    ? axis.map((entry, index) => (index === 0 ? extend(entry) : entry))
    : extend(axis);
}

export function goalMarkLine(goal: number, chrome: ChartChrome, label: string, horizontal = false) {
  return {
    silent: true,
    symbol: 'none',
    lineStyle: { type: 'dashed' as const, color: chrome.inkSecondary, width: 1.5 },
    label: {
      formatter: label,
      position: horizontal ? ('end' as const) : ('insideEndTop' as const),
      color: chrome.inkSecondary,
      fontSize: 11,
    },
    data: [horizontal ? { xAxis: goal } : { yAxis: goal }],
  };
}

export function applyCartesianDisplay<
  T extends { series?: unknown; xAxis?: unknown; yAxis?: unknown },
>(option: T, display: QuestionDisplay | undefined, options: CartesianDisplayOptions): T {
  if (!display || !Array.isArray(option.series)) return option;
  const { chrome, formatValue, horizontal = false, percent = false } = options;
  const formatShare = options.formatShare ?? ((ratio: number) => `${Math.round(ratio * 100)}%`);
  const series = (option.series as SeriesLike[]).map((entry, index) => {
    let next: SeriesLike = entry;
    if (display.showValues) {
      // Stacked bars carry the value inside the segment, in whichever of
      // white / near-black reads on that segment's colour.
      const inside = Boolean(entry.stack) && entry.type === 'bar';
      const fill = entry.itemStyle?.color;
      next = {
        ...next,
        label: {
          show: true,
          position: inside ? 'inside' : horizontal ? 'right' : 'top',
          color: inside
            ? readableTextOn(typeof fill === 'string' ? fill : chrome.inkPrimary)
            : chrome.inkSecondary,
          fontSize: 10,
          formatter: (params: { value: unknown }) => {
            const value = Array.isArray(params.value) ? params.value[1] : params.value;
            const numeric = typeof value === 'number' ? value : Number(value);
            if (!Number.isFinite(numeric) || numeric === 0) return '';
            return percent ? formatShare(numeric / 100) : formatValue(numeric);
          },
        },
        labelLayout: { hideOverlap: true },
      };
    }
    if (index === 0 && display.goal !== undefined && !percent) {
      next = {
        ...next,
        markLine: goalMarkLine(display.goal, chrome, options.goalLabel, horizontal),
      };
    }
    return next;
  });
  if (display.goal === undefined || percent) return { ...option, series };
  // A goal beyond the data would fall off the chart: stretch the value axis to it.
  return horizontal
    ? { ...option, series, xAxis: withGoalBounds(option.xAxis, display.goal) }
    : { ...option, series, yAxis: withGoalBounds(option.yAxis, display.goal) };
}

/** +1 when a higher value is good (income, net), -1 when it is bad (spending). */
export function metricPolarity(column: QuestionColumn): 1 | -1 {
  if (column.kind !== 'aggregation') return 1;
  const { op } = column.aggregation;
  return op === 'spending' || op === 'averageSpending' ? -1 : 1;
}

/** `#rrggbb` + alpha (0..1) → `rgba()`; other colors pass through. */
export function withAlpha(color: string, alpha: number): string {
  const match = /^#([0-9a-f]{6})$/i.exec(color);
  if (!match) return color;
  const value = parseInt(match[1], 16);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}

/** "Goal: €500" for the goal line (empty without a goal). */
export function goalText(goal: number | undefined, formatValue: (value: number) => string): string {
  if (goal === undefined) return '';
  const value = formatValue(goal);
  return t`Goal: ${value}`;
}
