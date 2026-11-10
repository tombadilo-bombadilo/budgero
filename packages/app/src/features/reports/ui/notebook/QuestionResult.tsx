import { Trans, useLingui } from '@lingui/react/macro';
import { useRef, useState } from 'react';
import { ArrowLeft, BarChart3, Loader2, RefreshCw, Table2 } from 'lucide-react';
import {
  allowedVisualizations,
  autoVisualization,
  canStack,
  getField,
  resolveStacking,
  type QuestionDisplay,
  type QuestionSpec,
  type ResolvedVisualization,
  type Stacking,
  type Visualization,
} from '@features/reports/lib/question';
import { Button } from '@shared/ui/button';
import { ToggleGroup, ToggleGroupItem } from '@shared/ui/toggle-group';
import { cn } from '@shared/lib/utils';
import { QuestionVisualization } from './QuestionVisualization';
import { QuestionTable } from './QuestionTable';
import { DrillMenu, type DrillRequest } from './DrillMenu';
import { withReturnFocus } from './drill-focus';
import type { QuestionQueryState } from './useQuestionQuery';
import { ChartSettings } from './viz/ChartSettings';
import { ChartTypePicker } from './viz/ChartTypePicker';
import { ExportMenu } from './viz/ExportMenu';
import { refineAutoVisualization } from './viz/transforms';

interface QuestionResultProps {
  spec: QuestionSpec;
  query: QuestionQueryState;
  /** 'table' shows the table; anything else charts (the Table toggle saves as 'table'). */
  onVisualizationChange: (visualization: Visualization) => void;
  onStackingChange: (stacking: Stacking) => void;
  /** Chart settings (values, goal, sort, top N, axes); omit to hide the Settings button. */
  onDisplayChange?: (display: QuestionDisplay | undefined) => void;
  onRefresh: () => void;
  /** Drill-through: replaces the question with the explored one. */
  onDrill?: (spec: QuestionSpec) => void;
  /** Back to the question before the last drill; omit when there is none. */
  onBack?: () => void;
  /** Download file name / PNG heading. */
  title?: string;
}

/** Result area: Table ⇄ Visualization toggle, chart picker, states. */
export function QuestionResult({
  spec,
  query,
  onVisualizationChange,
  onStackingChange,
  onDisplayChange,
  onRefresh,
  onDrill,
  onBack,
  title,
}: QuestionResultProps) {
  const { t } = useLingui();
  const [drillRequest, setDrillRequest] = useState<DrillRequest | null>(null);
  const handleDrill = onDrill
    ? (request: DrillRequest) => setDrillRequest(withReturnFocus(request))
    : undefined;
  const chartRef = useRef<HTMLDivElement | null>(null);
  const { result, resultCompiled, compileError, error, isRunning } = query;
  const shownError = compileError ?? error;
  const allowed = allowedVisualizations(spec);
  const chartable = allowed.some((item) => item !== 'table');
  const auto = autoVisualization(spec);
  const picked: ResolvedVisualization =
    spec.visualization !== 'auto' && allowed.includes(spec.visualization)
      ? spec.visualization
      : auto;
  // Auto bars turn into a row chart once the rows show many / long categories.
  const current =
    result && resultCompiled
      ? refineAutoVisualization(spec, picked, result, resultCompiled.columns)
      : picked;
  const showTable = spec.visualization === 'table' || !chartable;
  // Row charts stack like bars.
  const stackAs = current === 'row' ? 'bar' : current;
  const stackable = !showTable && canStack(spec, stackAs);
  const stacking = resolveStacking(spec, stackAs);
  const firstGrouping = spec.breakouts[0];
  const categoryAxis =
    !!firstGrouping && getField(spec.source, firstGrouping.field)?.type !== 'date';
  const shownVisualization =
    resultCompiled && allowedVisualizations(resultCompiled.spec).includes(current)
      ? current
      : (resultCompiled?.visualization ?? current);
  const rowCount = result?.rows.length ?? 0;
  const rowCountText = rowCount.toLocaleString();
  const totalText = (result?.rowCount ?? 0).toLocaleString();
  const truncated = (result?.rowCount ?? 0) > rowCount;

  return (
    <section
      aria-label={t`Result`}
      className="flex min-w-0 flex-col gap-3 rounded-lg border bg-card p-3 text-card-foreground sm:p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        {onBack && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2"
            onClick={onBack}
            title={t`Back to the previous question`}
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            <Trans>Back</Trans>
          </Button>
        )}
        {chartable && (
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={showTable ? 'table' : 'visualization'}
            onValueChange={(value) => {
              if (value === 'table') onVisualizationChange('table');
              else if (value === 'visualization') onVisualizationChange('auto');
            }}
            aria-label={t`Show as`}
          >
            <ToggleGroupItem value="table" className="px-3">
              <Table2 className="h-4 w-4" aria-hidden />
              <Trans>Table</Trans>
            </ToggleGroupItem>
            <ToggleGroupItem value="visualization" className="px-3">
              <BarChart3 className="h-4 w-4" aria-hidden />
              <Trans>Visualization</Trans>
            </ToggleGroupItem>
          </ToggleGroup>
        )}

        {chartable && !showTable && (
          <ChartTypePicker
            spec={spec}
            current={current}
            onPick={(item) =>
              // Auto may have turned bars into rows: picking Bar then is an explicit choice.
              onVisualizationChange(item === auto && current === auto ? 'auto' : item)
            }
          />
        )}

        {chartable && !showTable && onDisplayChange && (
          <ChartSettings
            key={current}
            visualization={current}
            categoryAxis={categoryAxis}
            display={spec.display}
            onChange={onDisplayChange}
          />
        )}

        {stackable && (
          <div className="flex items-center gap-2 border-l pl-3">
            <span className="text-xs text-muted-foreground" aria-hidden>
              <Trans>Series</Trans>
            </span>
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              value={stacking}
              onValueChange={(value) => {
                if (value) onStackingChange(value as Stacking);
              }}
              aria-label={t`Series`}
            >
              <ToggleGroupItem value="none" className="w-auto flex-none whitespace-nowrap px-2.5">
                <Trans>Side by side</Trans>
              </ToggleGroupItem>
              <ToggleGroupItem
                value="stacked"
                className="w-auto flex-none whitespace-nowrap px-2.5"
              >
                <Trans>Stacked</Trans>
              </ToggleGroupItem>
              <ToggleGroupItem
                value="percent"
                className="w-auto flex-none whitespace-nowrap px-2.5"
              >
                100%
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
        )}

        <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          {isRunning && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          {result && !shownError && (
            <span aria-live="polite">
              {truncated ? (
                <Trans>
                  First {rowCountText} of {totalText} rows
                </Trans>
              ) : rowCount === 1 ? (
                <Trans>1 row</Trans>
              ) : (
                <Trans>{rowCountText} rows</Trans>
              )}
            </span>
          )}
          <ExportMenu
            name={title ?? ''}
            result={result && !shownError ? result : null}
            columns={resultCompiled?.columns}
            source={resultCompiled?.spec.source}
            chartRef={chartRef}
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={onRefresh}
            disabled={isRunning || !query.compiled}
            aria-label={t`Refresh`}
            title={t`Refresh`}
          >
            <RefreshCw className="h-4 w-4" aria-hidden />
          </Button>
        </div>
      </div>

      <div aria-busy={isRunning} className="min-w-0">
        {shownError && (
          <div
            role="alert"
            className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive"
          >
            <p className="font-medium">
              <Trans>This question could not be run</Trans>
            </p>
            <p className="mt-1 break-words text-xs">{shownError}</p>
          </div>
        )}

        {!result && !shownError && (
          <div className="flex h-64 items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            <Trans>Running question…</Trans>
          </div>
        )}

        {result && resultCompiled && !shownError && (
          <div ref={chartRef} className={cn('transition-opacity', isRunning && 'opacity-60')}>
            {result.rows.length === 0 ? (
              <div className="flex h-48 flex-col items-center justify-center gap-1 text-center text-sm text-muted-foreground">
                <p className="font-medium text-foreground">
                  <Trans>No rows match this question</Trans>
                </p>
                <p>
                  <Trans>Try a longer date range or remove a filter.</Trans>
                </p>
              </div>
            ) : showTable ? (
              <QuestionTable
                result={result}
                columns={resultCompiled.columns}
                source={resultCompiled.spec.source}
                onDrill={handleDrill}
              />
            ) : (
              <QuestionVisualization
                result={result}
                columns={resultCompiled.columns}
                source={resultCompiled.spec.source}
                visualization={shownVisualization}
                stacking={resolveStacking(
                  { ...resultCompiled.spec, stacking: spec.stacking },
                  shownVisualization === 'row' ? 'bar' : shownVisualization
                )}
                onDrill={handleDrill}
                display={spec.display}
                spec={resultCompiled.spec}
                exportName={title}
              />
            )}
          </div>
        )}
      </div>
      {resultCompiled && onDrill && (
        <DrillMenu
          spec={resultCompiled.spec}
          request={drillRequest}
          onClose={() => setDrillRequest(null)}
          onDrill={onDrill}
        />
      )}
    </section>
  );
}
