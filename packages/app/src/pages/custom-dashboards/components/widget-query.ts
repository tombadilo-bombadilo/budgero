/**
 * What a dashboard widget runs: a saved notebook question (with the
 * dashboard's filters merged into its spec) or a plain SQL report as is.
 * Shared by WidgetCard and the dashboard's "Export all as CSV".
 */
import type {
  ChartConfiguration,
  CustomDashboardWidget,
  UnifiedReport,
} from '@budgero/core/browser';
import {
  CHART_TYPE,
  allowedVisualizations,
  applyDashboardFilters,
  compileQuestion,
  hasDashboardFilters,
  parseQuestionHeader,
  questionColumns,
  resolveVisualization,
  type DashboardFilterKind,
  type DashboardFilters,
  type QuestionColumn,
  type QuestionSpec,
  type ResolvedVisualization,
} from '@features/reports/lib/question';
import { getQuestionSqlLabels } from '@features/reports/ui/notebook/question-labels';
import { executeReportQuery, type SqlDatabase } from '@shared/lib/sql/report-query-executor';

export interface WidgetQuestion {
  spec: QuestionSpec;
  columns: QuestionColumn[];
  visualization: ResolvedVisualization;
  /** Dashboard filters that narrowed this question. */
  applied: DashboardFilterKind[];
  /** Compiled SQL with the dashboard filters (null when none applied). */
  sql: string | null;
}

const FROM_CHART: Partial<Record<ChartConfiguration['chartType'], ResolvedVisualization>> = {
  stat: 'number',
  line: 'line',
  bar: 'bar',
  area: 'area',
  pie: 'pie',
  table: 'table',
  scatter: 'scatter',
};

/**
 * The saved question behind a widget's chart, or null for SQL reports and
 * extra charts. The question's own chart type wins unless the chart was
 * changed to another type in the widget editor.
 */
export function widgetQuestion(
  report: UnifiedReport | null,
  chart: ChartConfiguration | null,
  filters: DashboardFilters,
  budgetId: number
): WidgetQuestion | null {
  const saved = parseQuestionHeader(report?.query);
  if (!saved || !chart || chart.id !== report?.charts?.[0]?.id) return null;
  const { spec, applied } = hasDashboardFilters(filters)
    ? applyDashboardFilters(saved, filters)
    : { spec: saved, applied: [] as DashboardFilterKind[] };
  const own = resolveVisualization(spec);
  const wanted = FROM_CHART[chart.chartType];
  const visualization =
    CHART_TYPE[own] === chart.chartType || !wanted || !allowedVisualizations(spec).includes(wanted)
      ? own
      : wanted;
  let sql: string | null = null;
  if (applied.length > 0 && budgetId > 0) {
    sql = compileQuestion(spec, { budgetId, labels: getQuestionSqlLabels() }).sql;
  }
  return { spec, columns: questionColumns(spec), visualization, applied, sql };
}

export function widgetQueryKey(
  widget: CustomDashboardWidget,
  report: UnifiedReport | null,
  question: WidgetQuestion | null
) {
  return [
    'dashboardWidgetData',
    widget.reportId,
    report?.updatedAt ?? 'missing',
    question?.sql ?? null,
  ] as const;
}

export async function runWidgetQuery(
  report: UnifiedReport | null,
  question: WidgetQuestion | null,
  database: SqlDatabase | null
) {
  return await executeReportQuery(question?.sql ?? report?.query ?? '', database);
}
