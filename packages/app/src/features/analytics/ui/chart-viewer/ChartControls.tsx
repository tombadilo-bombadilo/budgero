import {
  getVisualizationTypeLabel,
  type ExtendedChartType,
} from '@shared/lib/analytics/visualization-labels';
import { ChartExportButton } from './ChartExportButton';

interface ChartControlsProps {
  title: string;
  chartType: ExtendedChartType;
  onExport: () => void;
  showTitle?: boolean;
}

export function ChartControls({
  title,
  chartType,
  onExport,
  showTitle = true,
}: ChartControlsProps) {
  const displayTitle = title || getVisualizationTypeLabel(chartType);

  if (!showTitle) {
    return <ChartExportButton onExport={onExport} />;
  }

  return (
    <div className="flex items-center justify-between mb-1 sm:mb-4">
      <h3 className="text-sm sm:text-lg font-semibold truncate">{displayTitle}</h3>
      <ChartExportButton onExport={onExport} />
    </div>
  );
}
