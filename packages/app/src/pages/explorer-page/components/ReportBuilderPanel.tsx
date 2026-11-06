import { Trans, useLingui } from '@lingui/react/macro';
import { useMemo, useState } from 'react';
import { BookOpen, Code2, Loader2, Plus, RefreshCw, Save, Sparkles } from 'lucide-react';
import type { UnifiedReport } from '@budgero/core/browser';
import { Button } from '@shared/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@shared/ui/card';
import { ChartViewer } from '@features/analytics/ui/chart-viewer';
import {
  BUILDER_TEMPLATES,
  type BuilderTemplateId,
  type ReportBuilderSpec,
} from '@features/reports/lib/report-builder';
import { ReportBuilderForm } from '@features/reports/ui/report-builder/ReportBuilderForm';
import { useBuilderFilterOptions } from '@features/reports/ui/report-builder/useBuilderFilterOptions';
import { useReportBuilderQuery } from '@features/reports/ui/report-builder/useReportBuilderQuery';
import { describeSpec, templateLabel } from '@features/reports/ui/report-builder/builder-labels';
import { ResultsTable } from './ResultsTable';

interface ReportBuilderPanelProps {
  budgetId: number;
  spec: ReportBuilderSpec;
  onSpecChange: (spec: ReportBuilderSpec) => void;
  /** The saved builder report being edited, if any. */
  report: UnifiedReport | null;
  onSave: () => void;
  onNew: () => void;
  onOpenReports: () => void;
  onEditAsSql: (sql: string) => void;
}

export function ReportBuilderPanel({
  budgetId,
  spec,
  onSpecChange,
  report,
  onSave,
  onNew,
  onOpenReports,
  onEditAsSql,
}: ReportBuilderPanelProps) {
  const { t } = useLingui();
  const options = useBuilderFilterOptions(budgetId);
  const [refreshKey, setRefreshKey] = useState(0);
  const title = report?.name ?? describeSpec(spec);
  const { compiled, compileError, result, error, isRunning } = useReportBuilderQuery({
    spec,
    budgetId,
    chartId: report?.charts?.[0]?.id,
    chartTitle: title,
    refreshKey,
  });

  const templates = useMemo(() => Object.keys(BUILDER_TEMPLATES) as BuilderTemplateId[], []);

  const shownError = compileError ?? error;
  const isEmpty = !shownError && result !== null && result.rows.length === 0;

  return (
    <div className="flex flex-col gap-4 p-2 sm:p-4 lg:flex-row lg:items-start">
      <Card className="w-full shrink-0 py-0 lg:sticky lg:top-0 lg:w-80">
        <CardContent className="p-4">
          <ReportBuilderForm spec={spec} onChange={onSpecChange} options={options} />
        </CardContent>
      </Card>

      <div className="min-w-0 flex-1 space-y-4 pb-20 sm:pb-4">
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium" id="builder-templates">
            <Sparkles className="h-4 w-4 text-muted-foreground" aria-hidden />
            <Trans>Start from a template</Trans>
          </div>
          <div className="flex flex-wrap gap-2" role="group" aria-labelledby="builder-templates">
            {templates.map((id) => (
              <Button
                key={id}
                variant="outline"
                size="sm"
                className="text-xs"
                onClick={() => onSpecChange(BUILDER_TEMPLATES[id])}
              >
                {templateLabel(id)}
              </Button>
            ))}
          </div>
        </div>

        <Card>
          <CardHeader className="flex flex-col gap-3 pb-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <CardTitle className="truncate text-base">{title}</CardTitle>
              {report && (
                <p className="text-xs text-muted-foreground">
                  <Trans>Editing saved report</Trans>
                </p>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={onOpenReports}>
                <BookOpen className="h-4 w-4" aria-hidden />
                <Trans>Reports</Trans>
              </Button>
              {report && (
                <Button variant="outline" size="sm" onClick={onNew}>
                  <Plus className="h-4 w-4" aria-hidden />
                  <Trans>New</Trans>
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setRefreshKey((key) => key + 1)}
                disabled={isRunning || !compiled}
                aria-label={t`Refresh`}
                title={t`Refresh`}
              >
                <RefreshCw className="h-4 w-4" aria-hidden />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => compiled && onEditAsSql(compiled.sql)}
                disabled={!compiled}
              >
                <Code2 className="h-4 w-4" aria-hidden />
                <Trans>Edit as SQL</Trans>
              </Button>
              <Button size="sm" onClick={onSave} disabled={!compiled}>
                <Save className="h-4 w-4" aria-hidden />
                {report ? t`Update report` : t`Save report`}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3" aria-live="polite" aria-busy={isRunning}>
            {shownError && (
              <div
                role="alert"
                className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive"
              >
                <p className="font-medium">
                  <Trans>This report could not be run</Trans>
                </p>
                <p className="mt-1 break-words text-xs">{shownError}</p>
              </div>
            )}

            {!result && !shownError && (
              <div className="flex h-64 items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                <Trans>Running report…</Trans>
              </div>
            )}

            {isEmpty && (
              <div className="flex h-48 flex-col items-center justify-center gap-1 text-center text-sm text-muted-foreground">
                <p className="font-medium text-foreground">
                  <Trans>No transactions match this report</Trans>
                </p>
                <p>
                  <Trans>Try a longer date range or remove some filters.</Trans>
                </p>
              </div>
            )}

            {result && compiled && !isEmpty && !shownError && (
              <div className={isRunning ? 'opacity-60 transition-opacity' : undefined}>
                <ChartViewer queryResult={result} chartConfig={compiled.chart} compactToolbar />
              </div>
            )}
          </CardContent>
        </Card>

        {result && !shownError && spec.chartType !== 'table' && <ResultsTable result={result} />}
      </div>
    </div>
  );
}
