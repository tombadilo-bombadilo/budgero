import { msg } from '@lingui/core/macro';
import type { MessageDescriptor } from '@lingui/core';
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
import type { ResolvedVisualization } from '@features/reports/lib/question';

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

/** Chart-type picker sections, in order. */
export const VIZ_GROUPS: {
  id: string;
  label: MessageDescriptor;
  items: ResolvedVisualization[];
}[] = [
  { id: 'values', label: msg`Values`, items: ['number', 'trend'] },
  { id: 'compare', label: msg`Compare`, items: ['bar', 'row', 'combo', 'waterfall'] },
  { id: 'time', label: msg`Over time`, items: ['line', 'area', 'calendar'] },
  { id: 'parts', label: msg`Parts and flows`, items: ['pie', 'sankey'] },
  { id: 'relations', label: msg`Relationships`, items: ['scatter', 'pivot'] },
];

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
