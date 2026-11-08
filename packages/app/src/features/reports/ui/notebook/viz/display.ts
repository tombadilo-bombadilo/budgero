import { t } from '@lingui/core/macro';
/**
 * Display settings (values on marks, goal line) applied to a finished
 * cartesian ECharts option, so chart views stay unaware of them.
 */
import type { QuestionColumn, QuestionDisplay } from '@features/reports/lib/question';
import type { ChartChrome } from '@shared/lib/charts/palette';

interface SeriesLike {
  type?: string;
  stack?: string;
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

export function applyCartesianDisplay<T extends { series?: unknown }>(
  option: T,
  display: QuestionDisplay | undefined,
  options: CartesianDisplayOptions
): T {
  if (!display || !Array.isArray(option.series)) return option;
  const { chrome, formatValue, horizontal = false, percent = false } = options;
  const series = (option.series as SeriesLike[]).map((entry, index) => {
    let next: SeriesLike = entry;
    if (display.showValues) {
      const stacked = Boolean(entry.stack);
      next = {
        ...next,
        label: {
          show: true,
          position: stacked ? 'inside' : horizontal ? 'right' : 'top',
          color: stacked ? '#ffffff' : chrome.inkSecondary,
          fontSize: 10,
          formatter: (params: { value: unknown }) => {
            const value = Array.isArray(params.value) ? params.value[1] : params.value;
            const numeric = typeof value === 'number' ? value : Number(value);
            if (!Number.isFinite(numeric) || numeric === 0) return '';
            return percent ? `${numeric.toFixed(0)}%` : formatValue(numeric);
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
  return { ...option, series };
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

/** Toggle helper: never hides the last visible item. */
export function toggleHidden(previous: Set<string>, id: string, total: number): Set<string> {
  const next = new Set(previous);
  if (next.has(id)) next.delete(id);
  else if (total - next.size > 1) next.add(id);
  return next;
}
