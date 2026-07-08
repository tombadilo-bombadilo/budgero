import {
  BarChart,
  Bar,
  LineChart,
  Line,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
} from 'recharts';
import { ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from '@shared/ui/chart';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@shared/ui/table';
import { cn } from '@shared/lib/utils';
import type { ChartConfiguration } from '@budgero/core/browser';
import type { ExtendedChartType } from '@shared/lib/analytics/visualization-labels';
import { maskFormattedIfEnabled } from '@shared/lib/privacy/mask-numbers';
import { useUiStore } from '@shared/store/useUiStore';
import {
  aggregateValues,
  formatCompactNumber,
  toNumber,
  CHART_COLORS,
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
  shadcnChartConfig: ChartConfig;
  groups: string[];
  visibleGroups: string[];
  hiddenGroups: Set<string>;
  valueKey: string;
  className?: string;
}

export function ChartCanvas({
  queryResult,
  chartData,
  chartConfig,
  shadcnChartConfig,
  groups,
  visibleGroups,
  hiddenGroups,
  valueKey,
  className,
}: ChartCanvasProps) {
  const privacyMaskNumbers = useUiStore((state) => state.privacyMaskNumbers);

  const maskText = (value: string): string => {
    return maskFormattedIfEnabled(value, privacyMaskNumbers);
  };

  const formatAxisText = (value: unknown): string => {
    return maskText(String(value ?? ''));
  };

  const formatCompactValue = (value: number): string => {
    return maskText(formatCompactNumber(value));
  };

  const formatStatNumber = (value: number): string => {
    const formatted = new Intl.NumberFormat(undefined, {
      maximumFractionDigits: Number.isInteger(value) ? 0 : 2,
    }).format(value);
    return maskText(formatted);
  };

  const isStrictNumeric = (value: unknown): boolean => {
    if (typeof value === 'number') {
      return Number.isFinite(value);
    }
    if (typeof value !== 'string') {
      return false;
    }
    const trimmed = value.trim();
    return /^[-+]?(?:\d+\.?\d*|\.\d+)$/.test(trimmed);
  };

  const toStrictNumber = (value: unknown): number => {
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : NaN;
    }
    if (typeof value !== 'string') {
      return NaN;
    }
    const trimmed = value.trim();
    if (!/^[-+]?(?:\d+\.?\d*|\.\d+)$/.test(trimmed)) {
      return NaN;
    }
    return Number(trimmed);
  };

  // Shared axis styling for the bar/line/area charts; per-chart overrides
  // (dataKey, interval, tickFormatter) are passed after the spread.
  const xAxisProps = {
    tick: { fontSize: 9 },
    tickLine: false,
    axisLine: false,
    angle: -45,
    textAnchor: 'end',
    height: 52,
    tickFormatter: formatAxisText,
  };
  const yAxisProps = {
    tick: { fontSize: 9 },
    tickLine: false,
    axisLine: false,
    width: 40,
    tickFormatter: formatCompactValue,
  };

  // Support categorical/date X axes by mapping distinct labels to numeric indices.
  // Shared by the area and scatter cases below.
  const buildCategoryXMap = (renderData: ChartDataEntry[], xColumn: string) => {
    const sampleRows = renderData.slice(0, Math.min(renderData.length, 50));
    const xIsNumeric = sampleRows.every((row) => isStrictNumeric(row[xColumn]));

    const categoryToIndex: Record<string, number> = {};
    const indexToCategory: Record<number, string> = {};
    if (!xIsNumeric) {
      let i = 0;
      renderData.forEach((row) => {
        const label = String(row[xColumn]);
        if (categoryToIndex[label] === undefined) {
          categoryToIndex[label] = i;
          indexToCategory[i] = label;
          i += 1;
        }
      });
    }

    const xTickFormatter = (val: unknown): string => {
      const formatted = xIsNumeric
        ? String(val ?? '')
        : String(indexToCategory[Number(val)] ?? val ?? '');
      return maskText(formatted);
    };

    return { xIsNumeric, categoryToIndex, indexToCategory, xTickFormatter };
  };

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
        <div className="text-3xl sm:text-5xl font-semibold tabular-nums">
          {formatStatNumber(statValue)}
        </div>
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
                      {formatStatNumber(Number(row[group] ?? 0))}
                    </TableCell>
                  ))
                ) : (
                  <TableCell className="font-mono tabular-nums">
                    {formatStatNumber(Number(row[valueKey] ?? 0))}
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    );
  };

  const renderChart = () => {
    if (chartConfig.chartType !== 'stat' && chartData.length === 0) {
      return (
        <div className="flex items-center justify-center h-64 text-muted-foreground">
          No data available for chart
        </div>
      );
    }

    const commonProps = {
      data: chartData,
      margin: { top: 10, right: 10, left: 4, bottom: 48 },
    };

    const singleVisibleGroup = visibleGroups.length === 1 ? visibleGroups[0] : null;
    const hasGrouping = visibleGroups.length > 1;
    const normalizedDataForSingleSeries = singleVisibleGroup
      ? chartData.map((row) => ({
          ...row,
          [valueKey]: Number(row[singleVisibleGroup] ?? 0),
        }))
      : chartData;
    const renderData = hasGrouping ? chartData : normalizedDataForSingleSeries;

    switch (chartConfig.chartType) {
      case 'table': {
        return renderTable();
      }

      case 'stat': {
        return renderStat();
      }

      case 'bar': {
        const dataPointCount = renderData.length;
        const visibleGroupCount = visibleGroups.length;

        // Stack when:
        // - More than 3 visible groups OR
        // - When we have too many data points for clean unstacked display
        const shouldStack =
          hasGrouping && (visibleGroupCount > 3 || (dataPointCount > 8 && visibleGroupCount > 1));

        // Calculate bar settings based on data density
        let barCategoryGap = '20%';
        let maxBarSize: number | undefined;
        let forcedBarSize: number | undefined;

        if (!shouldStack && hasGrouping) {
          // For unstacked grouped bars, use aggressive sizing
          if (dataPointCount > 30) {
            // Many data points - force minimum bar size
            barCategoryGap = '50%';
            maxBarSize = Math.max(15, Math.floor(800 / (dataPointCount * visibleGroupCount)));
          } else if (dataPointCount > 20) {
            barCategoryGap = '40%';
            maxBarSize = Math.max(25, Math.floor(600 / (dataPointCount * visibleGroupCount)));
          } else if (dataPointCount > 10) {
            barCategoryGap = '30%';
            maxBarSize = 35;
          } else {
            // Few data points - normal sizing
            barCategoryGap = '20%';
            maxBarSize = 50;
          }
        } else if (!hasGrouping) {
          // Single series - be generous with bar width
          const approxWidth = 1000; // heuristic; actual container width varies
          // Wider bars: cap at 36px, min 10px
          forcedBarSize = Math.min(
            36,
            Math.max(10, Math.floor(approxWidth / Math.max(1, dataPointCount * 1.4)))
          );
          // Reduce gaps to make bars appear wider
          barCategoryGap = '15%';
          maxBarSize = undefined;
        } else {
          // Stacked bars can be wider
          if (dataPointCount > 30) {
            maxBarSize = 30;
          } else if (dataPointCount > 15) {
            maxBarSize = 50;
          } else {
            maxBarSize = 80;
          }
        }

        return (
          <BarChart {...commonProps} barCategoryGap={barCategoryGap} barGap={2} data={renderData}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.4} />
            <XAxis
              dataKey={chartConfig.xAxisColumn}
              {...xAxisProps}
              interval={Math.floor(chartData.length / 20)} // Show max 20 labels
            />
            <YAxis {...yAxisProps} />
            <ChartTooltip content={<ChartTooltipContent />} />
            {/* Render an invisible baseline bar to force bar layer to display even for
                very small values on high-resolution canvases */}
            {!hasGrouping && <Bar dataKey={() => 0} opacity={0} isAnimationActive={false} />}
            {hasGrouping ? (
              visibleGroups.map((group) => {
                const originalIndex = groups.indexOf(group);
                return (
                  <Bar
                    key={group}
                    dataKey={group}
                    fill={CHART_COLORS[originalIndex % CHART_COLORS.length]}
                    radius={shouldStack ? [0, 0, 0, 0] : [2, 2, 0, 0]}
                    stackId={shouldStack ? 'stack' : undefined}
                    maxBarSize={maxBarSize}
                  />
                );
              })
            ) : (
              <Bar
                dataKey={valueKey}
                fill={CHART_COLORS[0]}
                fillOpacity={0.95}
                stroke={CHART_COLORS[0]}
                radius={[2, 2, 0, 0]}
                maxBarSize={maxBarSize}
                barSize={forcedBarSize}
              />
            )}
          </BarChart>
        );
      }

      case 'line': {
        return (
          <LineChart {...commonProps} data={renderData}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.4} />
            <XAxis dataKey={chartConfig.xAxisColumn} {...xAxisProps} interval="preserveStartEnd" />
            <YAxis {...yAxisProps} />
            <ChartTooltip content={<ChartTooltipContent />} />
            {hasGrouping ? (
              visibleGroups.map((group) => {
                const originalIndex = groups.indexOf(group);
                return (
                  <Line
                    key={group}
                    type="monotone"
                    dataKey={group}
                    stroke={CHART_COLORS[originalIndex % CHART_COLORS.length]}
                    strokeWidth={2}
                    dot={{ r: 3 }}
                  />
                );
              })
            ) : (
              <Line
                type="monotone"
                dataKey={valueKey}
                stroke={CHART_COLORS[0]}
                strokeWidth={2}
                dot={{ r: 3 }}
              />
            )}
          </LineChart>
        );
      }

      case 'area': {
        // Support categorical/date X by mapping to numeric indices for robust rendering
        const { xIsNumeric, categoryToIndex, xTickFormatter } = buildCategoryXMap(
          renderData,
          chartConfig.xAxisColumn
        );

        const xKey = xIsNumeric ? chartConfig.xAxisColumn : '__xIndex';

        // Normalize Y values and prepare data for rendering
        const singleSeriesData = renderData.map((d) => ({
          ...d,
          [valueKey]: toNumber(d[valueKey]),
          ...(xIsNumeric ? {} : { __xIndex: categoryToIndex[String(d[chartConfig.xAxisColumn])] }),
        }));

        return (
          <AreaChart {...commonProps} data={hasGrouping ? chartData : singleSeriesData}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.4} />
            <XAxis
              dataKey={hasGrouping ? chartConfig.xAxisColumn : xKey}
              {...xAxisProps}
              interval="preserveStartEnd"
              tickFormatter={hasGrouping ? formatAxisText : xTickFormatter}
            />
            <YAxis {...yAxisProps} />
            <ChartTooltip content={<ChartTooltipContent />} />
            {hasGrouping ? (
              visibleGroups.map((group) => {
                const originalIndex = groups.indexOf(group);
                const color = CHART_COLORS[originalIndex % CHART_COLORS.length];
                return (
                  <Area
                    key={group}
                    type="monotone"
                    dataKey={group}
                    stroke={color}
                    strokeWidth={2}
                    fill={color}
                    fillOpacity={0.3}
                    // Stack grouped areas by default for readability
                    stackId="stack"
                  />
                );
              })
            ) : (
              <>
                <defs>
                  <linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={CHART_COLORS[0]} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={CHART_COLORS[0]} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <Area
                  type="monotone"
                  dataKey={valueKey}
                  stroke={CHART_COLORS[0]}
                  strokeWidth={2}
                  fill="url(#areaGradient)"
                  isAnimationActive={false}
                  connectNulls
                />
              </>
            )}
          </AreaChart>
        );
      }

      case 'pie': {
        // Filter pie data based on hidden groups (slices)
        const visiblePieData = chartData
          .filter((item) => !hiddenGroups.has(String(item[chartConfig.xAxisColumn] ?? '')))
          .map((item) => ({
            ...item,
            // Pie charts cannot render negative values; use magnitude to keep slices visible.
            [valueKey]: Math.abs(toNumber(item[valueKey])),
          }))
          .filter((item) => Number(item[valueKey] ?? 0) > 0);

        if (visiblePieData.length === 0) {
          return (
            <div className="flex items-center justify-center h-64 text-muted-foreground">
              No non-zero values available for pie chart
            </div>
          );
        }

        return (
          <PieChart>
            <Pie
              data={visiblePieData}
              dataKey={valueKey}
              nameKey={chartConfig.xAxisColumn}
              cx="50%"
              cy="50%"
              innerRadius="42%"
              outerRadius="78%"
              paddingAngle={1}
              labelLine={false}
              label={({ percent }) => {
                if (!percent || percent <= 0.05) return '';
                return maskText(`${(percent * 100).toFixed(0)}%`);
              }}
            >
              {visiblePieData.map((entry, index) => {
                const labelKey = String(entry[chartConfig.xAxisColumn] ?? '');
                // Find original index for consistent colors
                const originalIndex = chartData.findIndex(
                  (item) => item[chartConfig.xAxisColumn] === entry[chartConfig.xAxisColumn]
                );
                return (
                  <Cell
                    key={`cell-${index}`}
                    fill={
                      shadcnChartConfig[labelKey]?.color ||
                      CHART_COLORS[originalIndex % CHART_COLORS.length]
                    }
                  />
                );
              })}
            </Pie>
            <ChartTooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const data = payload[0];
                return (
                  <div className="rounded-lg border border-border/50 bg-background px-2 py-1 text-xs shadow-xl">
                    <div className="flex items-center gap-1">
                      <div
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: data.color }}
                      />
                      <span className="font-medium text-xs">{data.name}</span>
                    </div>
                    <div className="mt-1 font-mono text-xs">
                      {formatStatNumber(toNumber(data.value))}
                    </div>
                  </div>
                );
              }}
            />
          </PieChart>
        );
      }

      case 'scatter': {
        // Support categorical X-axis by mapping categories to numeric indices; produce {x,y} points
        const { xIsNumeric, categoryToIndex, xTickFormatter } = buildCategoryXMap(
          renderData,
          chartConfig.xAxisColumn
        );

        const getX = (row: ChartDataEntry): number =>
          xIsNumeric
            ? toStrictNumber(row[chartConfig.xAxisColumn])
            : categoryToIndex[String(row[chartConfig.xAxisColumn])];

        const buildUngrouped = () =>
          renderData.map((row) => ({ x: getX(row), y: Number(row[valueKey]) || 0 }));
        const buildGrouped = (group: string) =>
          chartData.map((row) => ({ x: getX(row), y: Number(row[group] || 0) }));

        return (
          <ScatterChart {...commonProps}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.4} />
            <XAxis
              dataKey="x"
              tick={{ fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              type="number"
              tickFormatter={xTickFormatter}
            />
            <YAxis
              dataKey="y"
              tick={{ fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              type="number"
              tickFormatter={formatCompactValue}
            />
            <ChartTooltip content={<ChartTooltipContent />} />
            {hasGrouping ? (
              visibleGroups.map((group) => {
                const originalIndex = groups.indexOf(group);
                return (
                  <Scatter
                    key={group}
                    name={group}
                    data={buildGrouped(group)}
                    fill={CHART_COLORS[originalIndex % CHART_COLORS.length]}
                  />
                );
              })
            ) : (
              <Scatter data={buildUngrouped()} fill={CHART_COLORS[0]} />
            )}
          </ScatterChart>
        );
      }

      default:
        return <div>Unsupported chart type: {chartConfig.chartType}</div>;
    }
  };

  const isDataView = chartConfig.chartType === 'table' || chartConfig.chartType === 'stat';

  if (isDataView) {
    return <div className={cn('w-full h-64 sm:h-96 min-w-0', className)}>{renderChart()}</div>;
  }

  return (
    <div className={cn('w-full h-64 sm:h-96 min-w-0', className)}>
      <ChartContainer config={shadcnChartConfig} className="h-full w-full min-w-0">
        {renderChart()}
      </ChartContainer>
    </div>
  );
}
