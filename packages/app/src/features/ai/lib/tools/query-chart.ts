import { z } from 'zod';
import { getErrorMessage } from '@shared/lib/errors';
import type { ToolContext, ToolExecutionResult } from './types';
import { getSchemaHint } from './query-sql';

export const renderChartSchema = z.object({
  sql: z
    .string()
    .describe(
      'Read-only SQL (SELECT/WITH) returning the columns to plot. Same rules as run_analytics_sql.'
    ),
  chartType: z
    .enum(['bar', 'line', 'area', 'pie', 'scatter', 'table', 'stat'])
    .describe('Chart type to render.'),
  xAxisColumn: z
    .string()
    .describe('Column for the X axis / category (for pie: the slice label; for stat: ignored).'),
  yAxisColumn: z.string().describe('Numeric column for the value / Y axis.'),
  groupByColumn: z
    .string()
    .optional()
    .describe('Optional column to split into multiple series / stacks.'),
  aggregateFunction: z
    .enum(['SUM', 'COUNT', 'AVG', 'MAX', 'MIN'])
    .optional()
    .describe('How to aggregate the value column (default SUM).'),
  title: z.string().optional().describe('Chart title shown to the user.'),
});

export type RenderChartArgs = z.infer<typeof renderChartSchema>;

/** Charts aggregate to few rows; keep the embedded dataset small. */
const MAX_CHART_ROWS = 100;

export function buildChartToolDescription(budgetId: number, liveSchema = ''): string {
  const schemaBlock = liveSchema
    ? `\nLIVE SCHEMA (authoritative columns/tables): ${liveSchema}\n`
    : '';
  return `Render a CHART for the user from a read-only SQL query. Use this when a visualization is clearer than a table (trends over time, category breakdowns, comparisons). The chart appears inline in the chat.
${schemaBlock}

It runs the SQL against the same analytics database as run_analytics_sql — follow ALL the same rules (scope to budget_id = ${budgetId}; exclude transfers with COALESCE(transfer_id,'') = ''; use account_on_budget = 1 for spending; use the inflow/outflow display-currency columns). Aggregate in SQL so each X value appears once.

After fetching data you pick:
- chartType: bar | line | area | pie | scatter | table | stat
  (line/area for trends over time; bar for category comparisons; pie for share-of-total; stat for a single headline number; table for raw rows)
- xAxisColumn: the category/time column (must be one of your SELECTed column names)
- yAxisColumn: the numeric value column (must be one of your SELECTed column names)
- groupByColumn (optional): a column to split into series/stacks
- aggregateFunction (optional, default SUM)
- title

EXAMPLES
- Monthly spending as a line chart:
  sql: SELECT month, SUM(outflow) AS spent FROM transactions_analytics WHERE budget_id = ${budgetId} AND COALESCE(transfer_id,'') = '' AND account_on_budget = 1 GROUP BY month ORDER BY month
  chartType: line, xAxisColumn: month, yAxisColumn: spent, title: "Monthly spending"
- Spending share by category (pie):
  sql: SELECT category_name, SUM(outflow) AS spent FROM transactions_analytics WHERE budget_id = ${budgetId} AND COALESCE(transfer_id,'') = '' AND account_on_budget = 1 GROUP BY category_name ORDER BY spent DESC LIMIT 8
  chartType: pie, xAxisColumn: category_name, yAxisColumn: spent, title: "Spending by category"
- Income vs expense per month (grouped bars): SELECT month, SUM(inflow) AS income, SUM(outflow) AS expense ... then pick chartType: bar with xAxisColumn: month and yAxisColumn: income (use groupByColumn only if your value is in one column split by a dimension).

Still SUMMARIZE the key insight in your text reply — the chart complements your answer, it doesn't replace it.`;
}

export async function executeRenderChart(
  args: RenderChartArgs,
  context: ToolContext
): Promise<ToolExecutionResult> {
  if (!context.runReadOnlyQuery || !context.collectChart) {
    return {
      success: false,
      message: 'Charting is not available in this session.',
      error: 'runReadOnlyQuery/collectChart not provided',
    };
  }

  try {
    const queryResult = await context.runReadOnlyQuery(args.sql, { maxRows: MAX_CHART_ROWS });

    if (queryResult.rowCount === 0) {
      return {
        success: true,
        message: 'The query returned no rows, so there is nothing to chart.',
      };
    }

    // Validate the chosen columns actually exist in the result.
    const missing = [args.xAxisColumn, args.yAxisColumn].filter(
      (col) => !queryResult.columns.includes(col)
    );
    if (missing.length > 0) {
      return {
        success: false,
        message: `Column(s) not found in query result: ${missing.join(', ')}. Available columns: ${queryResult.columns.join(', ')}.`,
        error: 'invalid column mapping',
      };
    }

    context.collectChart({
      config: {
        id: `chat-chart-${args.chartType}`,
        chartType: args.chartType,
        title: args.title,
        xAxisColumn: args.xAxisColumn,
        yAxisColumn: args.yAxisColumn,
        groupByColumn: args.groupByColumn,
        aggregateFunction: args.aggregateFunction ?? 'SUM',
      },
      queryResult,
    });

    return {
      success: true,
      message: `Rendered a ${args.chartType} chart${args.title ? ` titled "${args.title}"` : ''} with ${queryResult.rowCount} data point(s). It is now visible to the user.`,
      data: { rowCount: queryResult.rowCount },
    };
  } catch (error: unknown) {
    const message = getErrorMessage(error, 'Unknown error');
    const schemaHint = await getSchemaHint(context);
    return {
      success: false,
      message: `Chart query failed: ${message}.${schemaHint}\nFix the SQL and try again.`,
      error: message,
    };
  }
}
