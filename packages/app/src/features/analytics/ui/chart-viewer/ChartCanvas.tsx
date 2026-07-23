import { useMemo } from 'react';
import type { EChartsCoreOption } from 'echarts/core';
import { EChart } from '@shared/ui/echart';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@shared/ui/table';
import { cn } from '@shared/lib/utils';
import type { ChartConfiguration } from '@budgero/core/browser';
import type { ExtendedChartType } from '@shared/lib/analytics/visualization-labels';
import { maskFormattedIfEnabled } from '@shared/lib/privacy/mask-numbers';
import { useUiStore } from '@shared/store/useUiStore';
import {
  tooltipBase,
  tooltipHtml,
  useChartPalette,
  BAR_MAX_WIDTH,
  BAR_RADIUS_TOP,
  type TooltipRow,
} from '@shared/lib/charts/echarts-chrome';
import {
  aggregateValues,
  formatCompactNumber,
  toNumber,
  type ChartDataEntry,
  type QueryResult,
} from './chart-viewer.utils';

type ExtendedChartConfiguration = Omit<ChartConfiguration, 'chartType'> & {
  chartType: ExtendedChartType;
};

interface ChartCanvasProps {
  queryResult: QueryResult;
  chartData: ChartDataEntry[];
  chartConfig: ExtendedChartConfiguration;
  groups: string[];
  visibleGroups: string[];
  hiddenGroups: Set<string>;
  valueKey: string;
  className?: string;
}

function isStrictNumeric(value: unknown): boolean {
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'string') return false;
  return /^[-+]?(?:\d+\.?\d*|\.\d+)$/.test(value.trim());
}

/**
 * ECharts renderer behind ChartViewer — the same engine and mark specs as
 * the prebuilt Analytics reports, driving AI chat charts, dashboard
 * widgets, and explorer previews.
 *
 * Series colors are assigned by each series' index in the FULL `groups`
 * list, so hiding series never repaints the survivors. SQL results can
 * exceed the 8 validated slots; identity past that is carried by the
 * series filter + tooltip (cycling is a deliberate trade-off here since
 * the series set is user-controlled, not fixed).
 */
export function ChartCanvas({
  queryResult,
  chartData,
  chartConfig,
  groups,
  visibleGroups,
  hiddenGroups,
  valueKey,
  className,
}: ChartCanvasProps) {
  const privacyMaskNumbers = useUiStore((state) => state.privacyMaskNumbers);
  const palette = useChartPalette();

  const maskText = (value: string): string => maskFormattedIfEnabled(value, privacyMaskNumbers);

  const formatNumber = (value: number): string =>
    maskText(
      new Intl.NumberFormat(undefined, {
        maximumFractionDigits: Number.isInteger(value) ? 0 : 2,
      }).format(value)
    );

  const option = useMemo<EChartsCoreOption | null>(() => {
    const { chrome } = palette;
    const type = chartConfig.chartType;
    if (type === 'table' || type === 'stat' || chartData.length === 0) return null;

    // Local copies of the render helpers so the memo's dependency list stays
    // primitive (privacyMaskNumbers/palette/groups), not closure identities.
    const maskText = (value: string): string => maskFormattedIfEnabled(value, privacyMaskNumbers);
    const formatNumber = (value: number): string =>
      maskText(
        new Intl.NumberFormat(undefined, {
          maximumFractionDigits: Number.isInteger(value) ? 0 : 2,
        }).format(value)
      );
    const seriesColor = (name: string): string => {
      const index = Math.max(0, groups.indexOf(name));
      return palette.series[index % palette.series.length];
    };

    const xLabels = chartData.map((row) => String(row[chartConfig.xAxisColumn] ?? ''));
    const hasGrouping = visibleGroups.length > 1;
    const singleGroup = visibleGroups.length === 1 ? visibleGroups[0] : null;
    const readValue = (row: ChartDataEntry, group: string | null): number =>
      toNumber(group ? row[group] : row[valueKey]);

    const categoryAxis = {
      type: 'category' as const,
      data: xLabels.map((label) => maskText(label)),
      axisLine: { lineStyle: { color: chrome.axisLine } },
      axisTick: { show: false },
      axisLabel: {
        color: chrome.axisText,
        fontSize: 11,
        hideOverlap: true,
        rotate: xLabels.length > 12 ? 35 : 0,
      },
    };
    const valueAxis = {
      type: 'value' as const,
      axisLabel: {
        color: chrome.axisText,
        fontSize: 11,
        formatter: (value: number) => maskText(formatCompactNumber(value)),
      },
      splitLine: { lineStyle: { color: chrome.grid, width: 1 } },
      axisLine: { show: false },
    };
    const grid = { left: 8, right: 16, top: 16, bottom: 4, containLabel: true };

    const axisTooltip = {
      ...tooltipBase(chrome),
      trigger: 'axis' as const,
      axisPointer: { type: 'line' as const, lineStyle: { color: chrome.axisLine } },
      formatter: (params: unknown) => {
        const items = params as { dataIndex: number; seriesName: string }[];
        if (!items.length) return '';
        const index = items[0].dataIndex;
        const row = chartData[index];
        if (!row) return '';
        const rows: TooltipRow[] = (singleGroup ? [singleGroup] : visibleGroups).map((group) => ({
          color: seriesColor(group),
          name: maskText(group === 'value' ? chartConfig.yAxisColumn : group),
          value: formatNumber(readValue(row, hasGrouping || singleGroup ? group : null)),
        }));
        if (rows.length === 0) {
          rows.push({
            color: seriesColor('value'),
            name: maskText(chartConfig.yAxisColumn),
            value: formatNumber(readValue(row, null)),
          });
        }
        return tooltipHtml(maskText(xLabels[index] ?? ''), rows);
      },
    };

    switch (type) {
      case 'bar': {
        const shouldStack =
          hasGrouping &&
          (visibleGroups.length > 3 || (chartData.length > 8 && visibleGroups.length > 1));
        const seriesNames = hasGrouping ? visibleGroups : [singleGroup ?? 'value'];
        return {
          grid,
          xAxis: categoryAxis,
          yAxis: valueAxis,
          tooltip: axisTooltip,
          series: seriesNames.map((group) => ({
            name: group,
            type: 'bar' as const,
            stack: shouldStack ? 'stack' : undefined,
            data: chartData.map((row) => readValue(row, hasGrouping || singleGroup ? group : null)),
            barMaxWidth: BAR_MAX_WIDTH,
            itemStyle: shouldStack
              ? { color: seriesColor(group), borderColor: chrome.surface, borderWidth: 1 }
              : { color: seriesColor(group), borderRadius: BAR_RADIUS_TOP },
          })),
        };
      }

      case 'line':
      case 'area': {
        const stackAreas = type === 'area' && hasGrouping;
        const seriesNames = hasGrouping ? visibleGroups : [singleGroup ?? 'value'];
        return {
          grid,
          xAxis: categoryAxis,
          yAxis: valueAxis,
          tooltip: axisTooltip,
          series: seriesNames.map((group) => ({
            name: group,
            type: 'line' as const,
            stack: stackAreas ? 'stack' : undefined,
            data: chartData.map((row) => readValue(row, hasGrouping || singleGroup ? group : null)),
            lineStyle: { color: seriesColor(group), width: 2 },
            itemStyle: {
              color: seriesColor(group),
              borderColor: chrome.surface,
              borderWidth: 2,
            },
            symbol: 'circle',
            symbolSize: 8,
            showSymbol: chartData.length <= 30,
            ...(type === 'area' ? { areaStyle: { color: seriesColor(group), opacity: 0.1 } } : {}),
          })),
        };
      }

      case 'pie': {
        // Hidden "groups" for pies are slice labels; negatives render by magnitude.
        const slices = chartData
          .filter((row) => !hiddenGroups.has(String(row[chartConfig.xAxisColumn] ?? '')))
          .map((row) => ({
            label: String(row[chartConfig.xAxisColumn] ?? ''),
            value: Math.abs(toNumber(row[valueKey])),
            // Color by position in the FULL dataset so hiding slices never recolors.
            index: chartData.findIndex(
              (item) => item[chartConfig.xAxisColumn] === row[chartConfig.xAxisColumn]
            ),
          }))
          .filter((slice) => slice.value > 0);
        if (slices.length === 0) return null;
        const total = slices.reduce((sum, slice) => sum + slice.value, 0);
        return {
          tooltip: {
            ...tooltipBase(chrome),
            trigger: 'item' as const,
            formatter: (params: unknown) => {
              const item = params as { name: string; value: number; color?: string };
              const percent = total > 0 ? (item.value / total) * 100 : 0;
              return tooltipHtml(maskText(chartConfig.xAxisColumn), [
                {
                  color: typeof item.color === 'string' ? item.color : chrome.other,
                  name: `${maskText(item.name)} · ${percent.toFixed(1)}%`,
                  value: formatNumber(item.value),
                },
              ]);
            },
          },
          series: [
            {
              type: 'pie' as const,
              radius: ['48%', '76%'],
              padAngle: 1,
              data: slices.map((slice) => ({
                name: maskText(slice.label),
                value: slice.value,
                itemStyle: {
                  color: palette.series[slice.index % palette.series.length],
                  borderColor: chrome.surface,
                  borderWidth: 2,
                },
              })),
              label: {
                color: chrome.inkPrimary,
                fontSize: 11,
                formatter: (params: { name: string; percent?: number }) =>
                  (params.percent ?? 0) > 5 ? `${params.name}\n${params.percent?.toFixed(0)}%` : '',
              },
              labelLine: { lineStyle: { color: chrome.axisLine } },
              emphasis: { scaleSize: 4 },
            },
          ],
        };
      }

      case 'scatter': {
        const xIsNumeric = chartData
          .slice(0, 50)
          .every((row) => isStrictNumeric(row[chartConfig.xAxisColumn]));
        const seriesNames = hasGrouping ? visibleGroups : [singleGroup ?? 'value'];
        const buildPoints = (group: string) =>
          chartData.map((row) => {
            const x = xIsNumeric
              ? toNumber(row[chartConfig.xAxisColumn])
              : String(row[chartConfig.xAxisColumn] ?? '');
            return [x, readValue(row, hasGrouping || singleGroup ? group : null)];
          });
        return {
          grid,
          xAxis: xIsNumeric
            ? {
                type: 'value' as const,
                axisLabel: { color: chrome.axisText, fontSize: 11 },
                splitLine: { lineStyle: { color: chrome.grid, width: 1 } },
                axisLine: { show: false },
              }
            : categoryAxis,
          yAxis: valueAxis,
          tooltip: {
            ...tooltipBase(chrome),
            trigger: 'item' as const,
            formatter: (params: unknown) => {
              const item = params as { seriesName: string; value: [unknown, number] };
              return tooltipHtml(maskText(String(item.value?.[0] ?? '')), [
                {
                  color: seriesColor(item.seriesName),
                  name: maskText(
                    item.seriesName === 'value' ? chartConfig.yAxisColumn : item.seriesName
                  ),
                  value: formatNumber(toNumber(item.value?.[1])),
                },
              ]);
            },
          },
          series: seriesNames.map((group) => ({
            name: group,
            type: 'scatter' as const,
            data: buildPoints(group),
            symbolSize: 10,
            itemStyle: {
              color: seriesColor(group),
              borderColor: chrome.surface,
              borderWidth: 2,
            },
          })),
        };
      }

      default:
        return null;
    }
  }, [
    chartData,
    chartConfig,
    visibleGroups,
    hiddenGroups,
    groups,
    valueKey,
    palette,
    privacyMaskNumbers,
  ]);

  const renderStat = () => {
    const yIndex = queryResult.columns.indexOf(chartConfig.yAxisColumn);
    if (yIndex === -1) {
      return (
        <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
          Metric column "{chartConfig.yAxisColumn}" is missing in query results.
        </div>
      );
    }
    const values = queryResult.rows.map((row) => toNumber(row[yIndex]));
    if (values.length === 0) {
      return (
        <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
          No data available for stat
        </div>
      );
    }
    const statValue = aggregateValues(values, chartConfig.aggregateFunction);
    return (
      <div className="h-full flex flex-col items-center justify-center text-center px-4">
        <div className="text-3xl sm:text-5xl font-semibold">{formatNumber(statValue)}</div>
        <div className="mt-2 text-xs sm:text-sm text-muted-foreground">
          {chartConfig.aggregateFunction}({chartConfig.yAxisColumn})
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          {maskText(queryResult.rowCount.toLocaleString())} rows
        </div>
      </div>
    );
  };

  const renderTable = () => {
    const hasGrouping = visibleGroups.length > 0;
    const headers = hasGrouping
      ? [chartConfig.xAxisColumn, ...visibleGroups]
      : [chartConfig.xAxisColumn, `${chartConfig.aggregateFunction}(${chartConfig.yAxisColumn})`];
    if (chartData.length === 0) {
      return (
        <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
          No data available for table
        </div>
      );
    }
    return (
      <div className="h-full overflow-auto rounded-md border">
        <Table className="w-max min-w-full text-xs">
          <TableHeader className="sticky top-0 z-10 bg-background">
            <TableRow>
              {headers.map((header) => (
                <TableHead key={header}>{header}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {chartData.map((row, index) => (
              <TableRow key={`${row[chartConfig.xAxisColumn] ?? 'row'}-${index}`}>
                <TableCell>{maskText(String(row[chartConfig.xAxisColumn] ?? ''))}</TableCell>
                {hasGrouping ? (
                  visibleGroups.map((group) => (
                    <TableCell key={group} className="font-mono tabular-nums">
                      {formatNumber(Number(row[group] ?? 0))}
                    </TableCell>
                  ))
                ) : (
                  <TableCell className="font-mono tabular-nums">
                    {formatNumber(Number(row[valueKey] ?? 0))}
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    );
  };

  const body = (() => {
    if (chartConfig.chartType === 'stat') return renderStat();
    if (chartConfig.chartType === 'table') return renderTable();
    if (!option) {
      return (
        <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
          No data available for chart
        </div>
      );
    }
    return (
      <EChart
        option={option}
        ariaLabel={chartConfig.title || `${chartConfig.chartType} chart`}
        className="h-full w-full"
      />
    );
  })();

  return <div className={cn('w-full h-64 sm:h-96 min-w-0', className)}>{body}</div>;
}
