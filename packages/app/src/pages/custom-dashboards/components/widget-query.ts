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
  dashboardFilterConflicts,
  hasDashboardFilters,
  parseQuestionHeader,
  questionColumns,
  resolveVisualization,
  todayIso,
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
  /** Dashboard filters the SQL that runs really applies (empty when the stored SQL runs). */
  applied: DashboardFilterKind[];
  /** Dashboard filters that leave nothing with the question's own filter on the same field. */
  noOverlap: DashboardFilterKind[];
  /**
   * SQL compiled now from the saved spec, with the dashboard's filters and
   * the user's local "today". Null when it can't be compiled (no budget, a
   * spec this build can't compile): the stored SQL runs instead, unfiltered.
   */
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
  budgetId: number,
  /** The user's local day (widgets pass one that turns over at midnight). */
  today: string = todayIso()
): WidgetQuestion | null {
  const saved = parseQuestionHeader(report?.query);
  if (!saved || !chart || chart.id !== report?.charts?.[0]?.id) return null;
  const merged = hasDashboardFilters(filters)
    ? applyDashboardFilters(saved, filters)
    : { spec: saved, applied: [] as DashboardFilterKind[] };
  // Always compile from the spec: relative dates follow the user's local day
  // (the stored SQL uses the engine's UTC CURRENT_DATE) and old saved SQL
  // picks up compiler fixes.
  let sql: string | null = null;
  if (Number.isSafeInteger(budgetId) && budgetId > 0) {
    try {
      sql = compileQuestion(merged.spec, {
        budgetId,
        labels: getQuestionSqlLabels(),
        today,
      }).sql;
    } catch {
      sql = null;
    }
  }
  // Without compiled SQL the stored query runs as saved: show the saved
  // question and claim no dashboard filter.
  const spec = sql === null ? saved : merged.spec;
  const applied = sql === null ? [] : merged.applied;
  const own = resolveVisualization(spec);
  const wanted = FROM_CHART[chart.chartType];
  const visualization =
    CHART_TYPE[own] === chart.chartType || !wanted || !allowedVisualizations(spec).includes(wanted)
      ? own
      : wanted;
  const noOverlap = applied.length > 0 ? dashboardFilterConflicts(saved, filters) : [];
  return { spec, columns: questionColumns(spec), visualization, applied, noOverlap, sql };
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
