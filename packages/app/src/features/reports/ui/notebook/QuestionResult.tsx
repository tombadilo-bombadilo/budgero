import { Trans, useLingui } from '@lingui/react/macro';
import {
  AreaChart,
  BarChart3,
  Hash,
  LineChart,
  Loader2,
  PieChart,
  RefreshCw,
  Table2,
  type LucideIcon,
} from 'lucide-react';
import {
  allowedVisualizations,
  autoVisualization,
  type QuestionSpec,
  type ResolvedVisualization,
  type Visualization,
} from '@features/reports/lib/question';
import { Button } from '@shared/ui/button';
import { ToggleGroup, ToggleGroupItem } from '@shared/ui/toggle-group';
import { cn } from '@shared/lib/utils';
import { QuestionVisualization } from './QuestionVisualization';
import { QuestionTable } from './QuestionTable';
import { visualizationLabel } from './question-labels';
import type { QuestionQueryState } from './useQuestionQuery';

const VIZ_ICONS: Record<ResolvedVisualization, LucideIcon> = {
  number: Hash,
  line: LineChart,
  bar: BarChart3,
  area: AreaChart,
  pie: PieChart,
  table: Table2,
};

interface QuestionResultProps {
  spec: QuestionSpec;
  query: QuestionQueryState;
  /** 'table' shows the table; anything else charts (the Table toggle saves as 'table'). */
  onVisualizationChange: (visualization: Visualization) => void;
  onRefresh: () => void;
}

/** Result area: Table ⇄ Visualization toggle, chart picker, states. */
export function QuestionResult({
  spec,
  query,
  onVisualizationChange,
  onRefresh,
}: QuestionResultProps) {
  const { t } = useLingui();
  const { result, resultCompiled, compileError, error, isRunning } = query;
  const shownError = compileError ?? error;
  const allowed = allowedVisualizations(spec);
  const chartable = allowed.some((item) => item !== 'table');
  const auto = autoVisualization(spec);
  const current: ResolvedVisualization =
    spec.visualization !== 'auto' && allowed.includes(spec.visualization)
      ? spec.visualization
      : auto;
  const showTable = spec.visualization === 'table' || !chartable;
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
          <div className="flex flex-wrap gap-1" role="radiogroup" aria-label={t`Chart type`}>
            {allowed
              .filter((item) => item !== 'table')
              .map((item) => {
                const Icon = VIZ_ICONS[item];
                const selected = current === item;
                const label = visualizationLabel(item);
                return (
                  <Button
                    key={item}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    variant={selected ? 'secondary' : 'ghost'}
                    size="sm"
                    className={cn('h-8 px-2', selected && 'ring-1 ring-border')}
                    onClick={() => onVisualizationChange(item === auto ? 'auto' : item)}
                    title={label}
                  >
                    <Icon className="h-4 w-4" aria-hidden />
                    <span className="hidden sm:inline">{label}</span>
                  </Button>
                );
              })}
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
          <div className={cn('transition-opacity', isRunning && 'opacity-60')}>
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
              />
            ) : (
              <QuestionVisualization
                result={result}
                columns={resultCompiled.columns}
                source={resultCompiled.spec.source}
                visualization={
                  allowedVisualizations(resultCompiled.spec).includes(current)
                    ? current
                    : resultCompiled.visualization
                }
              />
            )}
          </div>
        )}
      </div>
    </section>
  );
}
