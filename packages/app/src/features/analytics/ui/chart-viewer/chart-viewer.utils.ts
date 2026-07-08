import type { ChartConfiguration } from '@budgero/core/browser';
import { downloadBlob } from '@shared/lib/download';
import type { QueryResult } from '@shared/lib/sql/report-query-executor';
import { resultsToCsv } from '@shared/lib/sql/csv';
import { toast } from 'sonner';

/** Chart data entry with dynamic column-based keys */
export type ChartDataValue = string | number | null | undefined;
export type ChartDataEntry = Record<string, ChartDataValue>;

export type { QueryResult };

export interface ProcessedChartData {
  chartData: ChartDataEntry[];
  groups: string[];
}

export const CHART_COLORS = [
  'var(--color-chart-1)',
  'var(--color-chart-2)',
  'var(--color-chart-3)',
  'var(--color-chart-4)',
  'var(--color-chart-5)',
];

/**
 * Format large numbers with K, M, B suffixes
 */
export function formatCompactNumber(value: number): string {
  if (value >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toFixed(1)}B`;
  }
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}K`;
  }
  return value.toFixed(0);
}

/**
 * Convert any value to a number safely
 */
export function toNumber(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (value === null || value === undefined) return 0;
  const cleaned = String(value).replace(/[^0-9+\-.]/g, '');
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}

type AggregateFunction = ChartConfiguration['aggregateFunction'];

/**
 * Aggregate a list of numbers with one of the supported SQL-style functions.
 */
export function aggregateValues(values: number[], aggregateFunction: AggregateFunction): number {
  switch (aggregateFunction) {
    case 'SUM':
      return values.reduce((sum, value) => sum + value, 0);
    case 'COUNT':
      return values.length;
    case 'AVG':
      return values.reduce((sum, value) => sum + value, 0) / values.length;
    case 'MAX':
      return Math.max(...values);
    case 'MIN':
      return Math.min(...values);
  }
}

/**
 * Fold one sample into a running aggregate. `count` is the number of samples
 * seen so far, including this one.
 */
function applyAggregateStep(
  aggregateFunction: AggregateFunction,
  previous: ChartDataValue,
  count: number,
  value: number
): number {
  switch (aggregateFunction) {
    case 'SUM':
      return Number(previous ?? 0) + value;
    case 'COUNT':
      return count;
    case 'AVG':
      return count === 1 ? value : (Number(previous ?? 0) * (count - 1) + value) / count;
    case 'MAX':
      return count === 1 ? value : Math.max(Number(previous ?? -Infinity), value);
    case 'MIN':
      return count === 1 ? value : Math.min(Number(previous ?? Infinity), value);
  }
}

/**
 * Process query result data into chart-friendly format with grouping support
 */
export function processChartData(
  queryResult: QueryResult,
  chartConfig: ChartConfiguration,
  valueKey: string,
  isSmallScreen: boolean
): ProcessedChartData {
  if (!queryResult.rows || queryResult.rows.length === 0) {
    return { chartData: [], groups: [] };
  }

  const xIndex = queryResult.columns.indexOf(chartConfig.xAxisColumn);
  const yIndex = queryResult.columns.indexOf(chartConfig.yAxisColumn);
  const groupIndex =
    chartConfig.groupByColumn && chartConfig.groupByColumn !== '__none__'
      ? queryResult.columns.indexOf(chartConfig.groupByColumn)
      : -1;

  if (xIndex === -1 || yIndex === -1) {
    return { chartData: [], groups: [] };
  }

  const supportsGrouping = chartConfig.chartType !== 'pie';
  const hasGrouping = supportsGrouping && groupIndex >= 0;
  const uniqueGroups = new Set<string>();

  const dataMap = new Map<string, ChartDataEntry>();

  queryResult.rows.forEach((row) => {
    const xValue = row[xIndex] as ChartDataValue;
    const yValue = toNumber(row[yIndex]);
    const groupValue = hasGrouping ? String(row[groupIndex] ?? '') : 'value';

    if (hasGrouping) {
      uniqueGroups.add(groupValue);
    }

    const key = String(xValue ?? ''); // For grouped data, we group by X value

    if (!dataMap.has(key)) {
      const entry: ChartDataEntry = {
        [chartConfig.xAxisColumn]: xValue ?? '',
      };
      if (hasGrouping) {
        uniqueGroups.forEach((g) => {
          entry[g] = 0;
          entry[`${g}_count`] = 0;
        });
      } else {
        entry[valueKey] = 0;
        entry.count = 0;
      }
      dataMap.set(key, entry);
    }

    const existing = dataMap.get(key);
    if (!existing) {
      return;
    }

    if (hasGrouping) {
      const countKey = `${groupValue}_count`;
      const count = Number(existing[countKey] ?? 0) + 1;
      existing[countKey] = count;
      existing[groupValue] = applyAggregateStep(
        chartConfig.aggregateFunction,
        existing[groupValue],
        count,
        yValue
      );
    } else {
      const count = Number(existing.count ?? 0) + 1;
      existing.count = count;
      existing[valueKey] = applyAggregateStep(
        chartConfig.aggregateFunction,
        existing[valueKey],
        count,
        yValue
      );
    }
  });

  let finalData = Array.from(dataMap.values()).map((item) => {
    const cleaned = { ...item };
    Object.keys(cleaned).forEach((key) => {
      if (key.endsWith('_count')) {
        delete cleaned[key];
      }
    });
    return cleaned;
  });

  // Ensure grouped series always have explicit numeric values for every category key.
  if (hasGrouping && uniqueGroups.size > 0) {
    const allGroups = Array.from(uniqueGroups);
    finalData = finalData.map((item) => {
      const normalized: ChartDataEntry = { ...item };
      allGroups.forEach((group) => {
        const current = normalized[group];
        normalized[group] = current === null || current === undefined ? 0 : toNumber(current);
      });
      return normalized;
    });
  }

  // Prepare display transforms without altering original results
  // Optionally synthesize a single group "All" for charts that render better in grouped mode (e.g., Area)
  let baseData: ChartDataEntry[] = finalData;
  let baseGroups: string[] = Array.from(uniqueGroups).sort();
  if (baseGroups.length === 0 && chartConfig.chartType === 'area') {
    baseData = finalData.map((row) => ({
      [chartConfig.xAxisColumn]: row[chartConfig.xAxisColumn],
      All: Number(row[valueKey] || 0),
    }));
    baseGroups = ['All'];
  }

  let chartDataOut: ChartDataEntry[] = baseData;
  let groupsOut: string[] = baseGroups;

  if (isSmallScreen) {
    // Mobile only: limit grouped series to first 12 groups (by total value). No "Others" aggregation.
    const MAX_GROUPS_MOBILE = 12;
    // Limit pie slices (categories) to top 12 by value
    if (chartConfig.chartType === 'pie') {
      const sortedSlices = [...finalData].sort(
        (a, b) => (Number(b[valueKey]) || 0) - (Number(a[valueKey]) || 0)
      );
      chartDataOut = sortedSlices.slice(0, MAX_GROUPS_MOBILE);
    }

    if (groupIndex >= 0 && groupsOut.length > MAX_GROUPS_MOBILE) {
      const groupTotals: Record<string, number> = {};
      groupsOut.forEach((g) => (groupTotals[g] = 0));
      finalData.forEach((row) => {
        groupsOut.forEach((g) => {
          groupTotals[g] += Number(row[g] || 0);
        });
      });
      const sortedGroups = [...groupsOut].sort(
        (a, b) => (groupTotals[b] || 0) - (groupTotals[a] || 0)
      );
      const topGroups = sortedGroups.slice(0, MAX_GROUPS_MOBILE);
      groupsOut = [...topGroups];
      chartDataOut = finalData.map((row) => {
        const newRow: ChartDataEntry = { [chartConfig.xAxisColumn]: row[chartConfig.xAxisColumn] };
        topGroups.forEach((g) => {
          newRow[g] = Number(row[g] || 0);
        });
        return newRow;
      });
    }

    // Keep all bar-chart X-axis points on mobile; only pie/group limits apply.
  }

  return {
    chartData: chartDataOut,
    groups: groupsOut,
  };
}

/**
 * Export chart data to CSV file
 */
export function exportChartData(
  chartData: ChartDataEntry[],
  groups: string[],
  visibleGroups: string[],
  chartConfig: ChartConfiguration,
  valueKey: string
): void {
  try {
    const grouped = groups.length > 0;
    const headers = grouped
      ? // For grouped data, export in a format that shows all groups
        [chartConfig.xAxisColumn, ...visibleGroups]
      : // For non-grouped data, export simple X/Y columns
        [chartConfig.xAxisColumn, `${chartConfig.aggregateFunction}(${chartConfig.yAxisColumn})`];

    const rows = chartData.map((row) =>
      grouped
        ? [
            row[chartConfig.xAxisColumn],
            ...visibleGroups.map((group) => (row[group] !== undefined ? row[group] : 0)),
          ]
        : [row[chartConfig.xAxisColumn], row[valueKey]]
    );

    // `|| ''` (not `?? ''`) is deliberate: zero-valued cells have always exported as empty.
    const csvContent = resultsToCsv(headers, rows, { emptyValue: (cell) => String(cell || '') });

    downloadBlob(csvContent, `${chartConfig.title || 'chart'}_data.csv`, 'text/csv;charset=utf-8;');

    toast.success('Chart data exported to CSV');
  } catch (error) {
    toast.error('Failed to export chart data');
    console.error('CSV export error:', error);
  }
}

/**
 * Get the value key for chart data based on chart type
 */
export function getValueKey(chartType: string, yAxisColumn: string): string {
  return chartType === 'pie' ? '__value__' : yAxisColumn;
}
