import { Trans } from '@lingui/react/macro';
import { useMemo } from 'react';
import type { ChartConfiguration } from '@budgero/core/browser';
import type { QueryResult } from '@shared/lib/sql/report-query-executor';
import { cn } from '@shared/lib/utils';
import { QuestionVisualization } from './QuestionVisualization';
import { sqlChartView, sqlRowsView } from './viz/sql-chart';

/**
 * An SQL question's result drawn like every other question: its stored
 * chart settings (or, without a chart, its rows as a table) through the
 * notebook's visualization.
 */
export function SqlChartVisualization({
  result,
  chart,
  fitHeight = false,
  className,
  exportName,
}: {
  result: QueryResult;
  chart: ChartConfiguration | null;
  fitHeight?: boolean;
  className?: string;
  exportName?: string;
}) {
  const view = useMemo(
    () =>
      chart && chart.xAxisColumn + chart.yAxisColumn !== '' ? sqlChartView(result, chart) : null,
    [result, chart]
  );
  const shown = view ?? sqlRowsView(result);
  const missingColumns = Boolean(chart && !view && chart.xAxisColumn + chart.yAxisColumn !== '');
  return (
    <div className={cn('flex min-h-0 flex-col gap-2', fitHeight && 'h-full', className)}>
      {missingColumns && (
        <p className="text-xs text-muted-foreground">
          <Trans>The chart’s columns aren’t in this result, so its rows are shown instead.</Trans>
        </p>
      )}
      <QuestionVisualization
        result={shown.result}
        columns={shown.columns}
        source="transactions"
        visualization={shown.visualization}
        stacking={shown.stacking}
        fitHeight={fitHeight}
        className={fitHeight ? 'min-h-0 flex-1' : undefined}
        exportName={exportName}
      />
    </div>
  );
}
