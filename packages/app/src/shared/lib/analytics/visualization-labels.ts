import type { ChartConfiguration } from '@budgero/core/browser';

export type ExtendedChartType = ChartConfiguration['chartType'] | 'table' | 'stat';

export function getVisualizationTypeLabel(chartType: ExtendedChartType): string {
  switch (chartType) {
    case 'bar':
      return 'Bar Chart';
    case 'line':
      return 'Line Chart';
    case 'area':
      return 'Area Chart';
    case 'pie':
      return 'Pie Chart';
    case 'scatter':
      return 'Scatter Plot';
    case 'table':
      return 'Table';
    case 'stat':
      return 'Stat';
    default:
      return chartType;
  }
}

export function getVisualizationDisplayName(chart: {
  title?: string;
  chartType: ExtendedChartType;
}): string {
  return chart.title || getVisualizationTypeLabel(chart.chartType);
}
