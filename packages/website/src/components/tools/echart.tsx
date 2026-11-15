'use client';

import { useEffect, useRef } from 'react';
import * as echarts from 'echarts/core';
import { LineChart } from 'echarts/charts';
import {
  GridComponent,
  MarkLineComponent,
  MarkPointComponent,
  TooltipComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { EChartsCoreOption } from 'echarts/core';
import { cn } from '@/lib/utils';

echarts.use([
  LineChart,
  GridComponent,
  TooltipComponent,
  MarkLineComponent,
  MarkPointComponent,
  CanvasRenderer,
]);

interface EChartProps {
  option: EChartsCoreOption;
  ariaLabel: string;
  className?: string;
}

/**
 * Thin ECharts host, modelled on the app's: init once, replace the option on
 * change, resize with the container, dispose on unmount. Load it with
 * next/dynamic and `ssr: false`; the caller reserves the height.
 */
export function EChart({ option, ariaLabel, className }: EChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const chart = echarts.init(container, undefined, { renderer: 'canvas' });
    chartRef.current = chart;
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
    // The canvas uses the page's typeface; callers can still override it.
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
      className={cn('h-full w-full', className)}
    />
  );
}

export default EChart;
