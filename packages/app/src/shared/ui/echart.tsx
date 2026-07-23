import { useEffect, useRef } from 'react';
import * as echarts from 'echarts/core';
import {
  BarChart,
  LineChart,
  PieChart,
  ScatterChart,
  TreemapChart,
  SankeyChart,
} from 'echarts/charts';
import {
  GridComponent,
  TooltipComponent,
  MarkLineComponent,
  MarkPointComponent,
} from 'echarts/components';
import { LabelLayout } from 'echarts/features';
import { CanvasRenderer } from 'echarts/renderers';
import type { EChartsCoreOption } from 'echarts/core';
import { cn } from '@shared/lib/utils';

echarts.use([
  BarChart,
  LineChart,
  PieChart,
  ScatterChart,
  TreemapChart,
  SankeyChart,
  GridComponent,
  TooltipComponent,
  MarkLineComponent,
  MarkPointComponent,
  LabelLayout,
  CanvasRenderer,
]);

export interface EChartClickParams {
  seriesName?: string;
  name?: string;
  dataIndex: number;
  value: unknown;
}

interface EChartProps {
  option: EChartsCoreOption;
  className?: string;
  ariaLabel: string;
  /** Click on a mark (bar, slice, point). Also makes marks show a pointer cursor. */
  onMarkClick?: (params: EChartClickParams) => void;
}

/**
 * Thin ECharts host: init once, notMerge on option changes, resize with the
 * container, dispose on unmount. Theme changes arrive as new options (the
 * palette is baked in by the caller), so no ECharts theme registration.
 */
export function EChart({ option, className, ariaLabel, onMarkClick }: EChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  const clickHandlerRef = useRef<EChartProps['onMarkClick']>(undefined);
  useEffect(() => {
    clickHandlerRef.current = onMarkClick;
  }, [onMarkClick]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const chart = echarts.init(container, undefined, { renderer: 'canvas' });
    chartRef.current = chart;
    chart.on('click', (params) => {
      const { seriesName, name, dataIndex, value } = params as unknown as EChartClickParams;
      clickHandlerRef.current?.({ seriesName, name, dataIndex, value });
    });
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(container);
    return () => {
      observer.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    const container = containerRef.current;
    if (!chart || !container) return;
    // Charts speak the app's typeface: whatever font the container computed
    // (theme preset / Classic font choice) becomes the canvas default. The
    // option spread comes second so callers can still override textStyle.
    chart.setOption(
      { textStyle: { fontFamily: getComputedStyle(container).fontFamily }, ...option },
      { notMerge: true }
    );
  }, [option]);

  return (
    <div
      ref={containerRef}
      role="img"
      aria-label={ariaLabel}
      className={cn('h-[380px] w-full', className)}
    />
  );
}
