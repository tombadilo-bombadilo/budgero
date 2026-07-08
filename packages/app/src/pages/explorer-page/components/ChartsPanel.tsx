import { memo } from 'react';
import { Card, CardContent, CardHeader } from '@shared/ui/card';
import { Button } from '@shared/ui/button';
import { Badge } from '@shared/ui/badge';
import { ChartViewer } from '@features/analytics/ui/chart-viewer';
import { getVisualizationDisplayName } from '@shared/lib/analytics/visualization-labels';
import type { ChartConfiguration } from '@budgero/core/browser';
import type { QueryResult } from '../types';

export interface ChartsPanelProps {
  queryResult: QueryResult;
  charts: ChartConfiguration[];
  selectedChartConfig: ChartConfiguration | null;
  onSelectChart: (config: ChartConfiguration) => void;
}

// Lightweight memo wrapper for ChartViewer to avoid re-render while typing
const MemoChartViewer = memo(
  ({ result, config }: { result: QueryResult; config: ChartConfiguration | null }) => {
    if (!config) {
      return (
        <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
          No chart selected. Click a chart button above.
        </div>
      );
    }
    return <ChartViewer queryResult={result} chartConfig={config} />;
  },
  (prev, next) => prev.result === next.result && prev.config === next.config
);

MemoChartViewer.displayName = 'MemoChartViewer';

export const ChartsPanel = memo(
  ({ queryResult, charts, selectedChartConfig, onSelectChart }: ChartsPanelProps) => {
    if (!charts || charts.length === 0 || !queryResult) {
      return null;
    }

    return (
      <Card>
        <CardHeader className="pb-3 sm:pb-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4">
            <div className="flex items-center gap-2">
              <h3 className="text-base sm:text-lg font-semibold">Chart Visualizations</h3>
              <Badge variant="secondary" className="text-xs">
                {charts.length} chart
                {charts.length > 1 ? 's' : ''}
              </Badge>
            </div>
            <div className="flex gap-1.5 sm:gap-2 flex-wrap">
              {charts.map((config: ChartConfiguration) => (
                <Button
                  key={config.id}
                  variant={selectedChartConfig?.id === config.id ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => onSelectChart(config)}
                  className="transition-all whitespace-nowrap h-7 sm:h-8 text-xs sm:text-sm"
                >
                  <span className="hidden sm:inline">{getVisualizationDisplayName(config)}</span>
                  <span className="sm:hidden">{config.chartType.toUpperCase()}</span>
                </Button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0 pb-2 sm:pb-4">
          <MemoChartViewer result={queryResult} config={selectedChartConfig} />
        </CardContent>
      </Card>
    );
  }
);

ChartsPanel.displayName = 'ChartsPanel';
