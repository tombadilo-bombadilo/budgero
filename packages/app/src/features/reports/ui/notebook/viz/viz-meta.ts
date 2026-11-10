import {
  AreaChart,
  BarChart3,
  CalendarDays,
  ChartBarBig,
  ChartNoAxesCombined,
  ChartScatter,
  ChartColumnIncreasing,
  Grid3x3,
  Hash,
  LineChart,
  PieChart,
  Table2,
  TrendingUp,
  Waypoints,
  type LucideIcon,
} from 'lucide-react';
import {
  aggregationUnit,
  allowedVisualizations,
  getField,
  type QuestionBreakout,
  type QuestionSpec,
  type ResolvedVisualization,
} from '@features/reports/lib/question';

export const VIZ_ICONS: Record<ResolvedVisualization, LucideIcon> = {
  number: Hash,
  trend: TrendingUp,
  line: LineChart,
  bar: BarChart3,
  row: ChartBarBig,
  area: AreaChart,
  combo: ChartNoAxesCombined,
  pie: PieChart,
  waterfall: ChartColumnIncreasing,
  calendar: CalendarDays,
  sankey: Waypoints,
  scatter: ChartScatter,
  pivot: Grid3x3,
  table: Table2,
};

/** Visualizations drawn with ECharts (PNG export). */
export const CANVAS_VISUALIZATIONS = new Set<ResolvedVisualization>([
  'line',
  'bar',
  'row',
  'area',
  'combo',
  'pie',
  'waterfall',
  'calendar',
  'sankey',
  'scatter',
]);

export interface DisplayOptions {
  showValues: boolean;
  goal: boolean;
  sort: boolean;
  topN: boolean;
  dualAxis: boolean;
}

/** Which display settings a chart type uses (`categoryAxis`: first grouping isn't a date). */
export function displayOptionsFor(
  visualization: ResolvedVisualization,
  categoryAxis: boolean
): DisplayOptions {
  const bars = visualization === 'bar' || visualization === 'row';
  return {
    showValues: ['bar', 'row', 'line', 'area', 'combo', 'waterfall'].includes(visualization),
    goal: ['bar', 'row', 'line', 'area', 'combo', 'waterfall', 'trend'].includes(visualization),
    sort: bars && categoryAxis,
    topN:
      (bars && categoryAxis) ||
      visualization === 'pie' ||
      visualization === 'waterfall' ||
      visualization === 'sankey',
    dualAxis: visualization === 'combo',
  };
}

export function hasDisplayOptions(options: DisplayOptions): boolean {
  return Object.values(options).some(Boolean);
}

function isTimeLine(spec: QuestionSpec, breakout: QuestionBreakout | undefined): boolean {
  return !!breakout && !breakout.part && getField(spec.source, breakout.field)?.type === 'date';
}

/**
 * The chart types that suit this question best, best first (at most four),
 * all of them allowed. The picker shows these before the rest.
 */
export function recommendedVisualizations(spec: QuestionSpec): ResolvedVisualization[] {
  const allowed = new Set(allowedVisualizations(spec));
  const [first, second] = spec.breakouts;
  const metrics = spec.aggregations;
  let ranked: ResolvedVisualization[];
  if (metrics.length === 0) ranked = ['table'];
  else if (!first) ranked = ['number', 'trend', 'table'];
  else if (
    !second &&
    metrics.length >= 2 &&
    aggregationUnit(metrics[0]) !== aggregationUnit(metrics[1])
  ) {
    ranked = ['combo', 'bar', 'line', 'scatter'];
  } else if (second) {
    const timeFirst = isTimeLine(spec, first);
    const timeSecond = isTimeLine(spec, second);
    ranked =
      timeFirst || timeSecond
        ? ['bar', 'area', 'line', 'pivot']
        : ['bar', 'row', 'sankey', 'pivot'];
  } else if (isTimeLine(spec, first)) {
    ranked =
      first.bucket === 'day'
        ? ['line', 'calendar', 'bar', 'area']
        : metrics.length >= 2
          ? ['bar', 'line', 'area', 'combo']
          : ['line', 'bar', 'area', 'trend'];
  } else {
    ranked =
      metrics.length >= 2 ? ['bar', 'row', 'scatter', 'combo'] : ['bar', 'row', 'pie', 'waterfall'];
  }
  return ranked.filter((item) => allowed.has(item)).slice(0, 4);
}
