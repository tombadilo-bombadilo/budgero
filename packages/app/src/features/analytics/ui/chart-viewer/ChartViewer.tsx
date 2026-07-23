import { useCallback, useMemo } from 'react';
import type { ChartConfiguration } from '@budgero/core/browser';
import type { ExtendedChartType } from '@shared/lib/analytics/visualization-labels';
import { useChartViewerState } from './useChartViewerState';
import { ChartControls } from './ChartControls';
import { ChartLegend } from './ChartLegend';
import { ChartCanvas } from './ChartCanvas';
import { exportChartData, QueryResult } from './chart-viewer.utils';

type ExtendedChartConfiguration = Omit<ChartConfiguration, 'chartType'> & {
  chartType: ExtendedChartType;
};

interface ChartViewerProps {
  queryResult: QueryResult;
  chartConfig: ExtendedChartConfiguration;
  fitHeight?: boolean;
  compactToolbar?: boolean;
  showLegendSummary?: boolean;
}

export function ChartViewer({
  queryResult,
  chartConfig,
  fitHeight = false,
  compactToolbar = false,
  showLegendSummary = true,
}: ChartViewerProps) {
  const { hiddenGroups, valueKey, chartData, groups, visibleGroups, toggleGroup } =
    useChartViewerState({ queryResult, chartConfig: chartConfig as ChartConfiguration });

  const handleExport = useCallback(() => {
    exportChartData(chartData, groups, visibleGroups, chartConfig as ChartConfiguration, valueKey);
  }, [chartData, groups, visibleGroups, chartConfig, valueKey]);

  const legendItems = useMemo(() => {
    if (chartConfig.chartType === 'stat') {
      return [];
    }
    if (chartConfig.chartType === 'pie') {
      return chartData.map((item) => String(item[chartConfig.xAxisColumn] ?? ''));
    }
    return groups;
  }, [chartConfig.chartType, chartData, chartConfig.xAxisColumn, groups]);

  const getColorIndex = useCallback(
    (item: string) => {
      if (chartConfig.chartType === 'pie') {
        return chartData.findIndex((d) => String(d[chartConfig.xAxisColumn] ?? '') === item);
      }
      return groups.indexOf(item);
    },
    [chartConfig.chartType, chartData, chartConfig.xAxisColumn, groups]
  );

  return (
    <div
      className={
        fitHeight
          ? 'w-full h-full min-h-0 min-w-0 overflow-hidden flex flex-col'
          : 'w-full min-w-0 overflow-hidden'
      }
    >
      {compactToolbar ? (
        <div className="mb-0.5 flex items-center justify-start gap-2">
          <ChartControls
            title=""
            chartType={chartConfig.chartType}
            onExport={handleExport}
            showTitle={false}
          />
          {chartConfig.chartType !== 'stat' && (
            <ChartLegend
              legendItems={legendItems}
              hiddenGroups={hiddenGroups}
              onToggleGroup={toggleGroup}
              getColorIndex={getColorIndex}
              compact
              showSummary={showLegendSummary}
            />
          )}
        </div>
      ) : (
        <>
          <ChartControls
            title={chartConfig.title || ''}
            chartType={chartConfig.chartType}
            onExport={handleExport}
          />

          {chartConfig.chartType !== 'stat' && (
            <ChartLegend
              legendItems={legendItems}
              hiddenGroups={hiddenGroups}
              onToggleGroup={toggleGroup}
              getColorIndex={getColorIndex}
            />
          )}
        </>
      )}

      <ChartCanvas
        queryResult={queryResult}
        chartData={chartData}
        chartConfig={chartConfig}
        groups={groups}
        visibleGroups={visibleGroups}
        hiddenGroups={hiddenGroups}
        valueKey={valueKey}
        className={fitHeight ? 'flex-1 min-h-[220px] sm:min-h-[260px] h-full' : undefined}
      />
    </div>
  );
}
