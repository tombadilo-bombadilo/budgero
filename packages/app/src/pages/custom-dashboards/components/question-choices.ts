import { t } from '@lingui/core/macro';
import { Code2, type LucideIcon } from 'lucide-react';
import type {
  ChartConfiguration,
  NewChartConfiguration,
  UnifiedReport,
} from '@budgero/core/browser';
import { parseQuestionHeader, resolveVisualization } from '@features/reports/lib/question';
import {
  describeQuestion,
  visualizationLabel,
} from '@features/reports/ui/notebook/question-labels';
import { VIZ_ICONS } from '@features/reports/ui/notebook/viz/viz-meta';

/** A saved question as the "Add to dashboard" picker lists it. */
export interface QuestionChoice {
  report: UnifiedReport;
  /** One line under the name (the question in words, or "SQL query"). */
  summary: string;
  icon: LucideIcon;
  /** Charts to choose from: a notebook question's own chart, or every chart of an SQL question. */
  charts: ChartConfiguration[];
  /** An SQL question saved without a chart: adding it gives it a plain table (its rows). */
  needsChart: boolean;
}

/** Saved questions, newest first (like the Reports home). */
export function questionChoices(reports: readonly UnifiedReport[]): QuestionChoice[] {
  return [...reports]
    .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
    .map((report) => {
      const spec = parseQuestionHeader(report.query);
      const charts = report.charts ?? [];
      return {
        report,
        summary: report.description || (spec ? describeQuestion(spec) : t`SQL query`),
        icon: spec ? VIZ_ICONS[resolveVisualization(spec)] : Code2,
        // A notebook question is one chart; older extra charts aren't offered.
        charts: spec ? charts.slice(0, 1) : charts,
        needsChart: charts.length === 0,
      };
    });
}

const LEGACY_TYPES: Record<
  ChartConfiguration['chartType'],
  Parameters<typeof visualizationLabel>[0]
> = {
  bar: 'bar',
  line: 'line',
  area: 'area',
  pie: 'pie',
  scatter: 'scatter',
  table: 'table',
  stat: 'number',
};

/** Name of one of an SQL question's charts: its title, or its type and columns. */
export function chartChoiceLabel(chart: ChartConfiguration): string {
  if (chart.title?.trim()) return chart.title.trim();
  const type = visualizationLabel(LEGACY_TYPES[chart.chartType]);
  if (!chart.xAxisColumn && !chart.yAxisColumn) return type;
  return chart.chartType === 'stat'
    ? `${type} · ${chart.yAxisColumn}`
    : `${type} · ${chart.xAxisColumn}`;
}

/** The chart an SQL question without one gets when it's added: its rows as a table. */
export function rowsTableChart(): NewChartConfiguration {
  return { chartType: 'table', xAxisColumn: '', yAxisColumn: '', aggregateFunction: 'SUM' };
}
