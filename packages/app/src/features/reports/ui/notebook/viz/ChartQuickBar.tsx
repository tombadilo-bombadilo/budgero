import { Trans, useLingui } from '@lingui/react/macro';
import { ArrowDownWideNarrow, ArrowUpNarrowWide, ArrowDownUp, History } from 'lucide-react';
import {
  normalizeDisplay,
  type QuestionDisplay,
  type QuestionSpec,
  type ResolvedStacking,
  type ResolvedVisualization,
  type Stacking,
} from '@features/reports/lib/question';
import { Button } from '@shared/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@shared/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@shared/ui/toggle-group';
import { cn } from '@shared/lib/utils';
import { displayOptionsFor } from './viz-meta';
import { canCompareLastYear, comparesLastYear, withLastYear } from './last-year';

const TOP_N_CHOICES = [5, 10, 20] as const;

/**
 * Controls on the chart itself: how series combine (grouped / stacked /
 * 100%), sort and top N for category charts, and a one-tap comparison with
 * last year for time series.
 */
export function ChartQuickBar({
  spec,
  visualization,
  categoryAxis,
  stackable,
  stacking,
  onStackingChange,
  onDisplayChange,
  onSpecChange,
}: {
  spec: QuestionSpec;
  visualization: ResolvedVisualization;
  categoryAxis: boolean;
  stackable: boolean;
  stacking: ResolvedStacking;
  onStackingChange: (stacking: Stacking) => void;
  onDisplayChange?: (display: QuestionDisplay | undefined) => void;
  onSpecChange?: (spec: QuestionSpec) => void;
}) {
  const { t } = useLingui();
  const options = displayOptionsFor(visualization, categoryAxis);
  const { display } = spec;
  const showSort = Boolean(onDisplayChange) && options.sort;
  const showTopN = Boolean(onDisplayChange) && options.topN;
  const lastYear = Boolean(onSpecChange) && canCompareLastYear(spec);
  if (!stackable && !showSort && !showTopN && !lastYear) return null;

  const setDisplay = (patch: Partial<QuestionDisplay>) => {
    const next: Record<string, unknown> = { ...display, ...patch };
    for (const key of Object.keys(next)) if (next[key] === undefined) delete next[key];
    onDisplayChange?.(normalizeDisplay(next));
  };
  const sort = display?.sort;
  const SortIcon =
    sort === 'desc' ? ArrowDownWideNarrow : sort === 'asc' ? ArrowUpNarrowWide : ArrowDownUp;
  const sortLabel =
    sort === 'desc' ? t`Largest first` : sort === 'asc' ? t`Smallest first` : t`Sort`;
  const comparing = comparesLastYear(spec);
  const customTopN = display?.topN ?? 0;

  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t`Chart options`}>
      {stackable && (
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
          <ToggleGroupItem value="none" className="h-8 w-auto flex-none whitespace-nowrap px-2.5">
            <Trans>Grouped</Trans>
          </ToggleGroupItem>
          <ToggleGroupItem
            value="stacked"
            className="h-8 w-auto flex-none whitespace-nowrap px-2.5"
          >
            <Trans>Stacked</Trans>
          </ToggleGroupItem>
          <ToggleGroupItem
            value="percent"
            className="h-8 w-auto flex-none whitespace-nowrap px-2.5"
          >
            100%
          </ToggleGroupItem>
        </ToggleGroup>
      )}
      {showSort && (
        <Button
          variant={sort ? 'secondary' : 'outline'}
          size="sm"
          className="h-8 gap-1.5 px-2.5"
          onClick={() =>
            setDisplay({ sort: sort === undefined ? 'desc' : sort === 'desc' ? 'asc' : undefined })
          }
          aria-label={t`Sort bars: ${sortLabel}`}
          title={t`Sort bars by value`}
        >
          <SortIcon className="h-4 w-4" aria-hidden />
          {sortLabel}
        </Button>
      )}
      {showTopN && (
        <Select
          value={display?.topN ? String(display.topN) : 'all'}
          onValueChange={(value) =>
            setDisplay({ topN: value === 'all' ? undefined : Number(value) })
          }
        >
          <SelectTrigger
            aria-label={t`How many to show`}
            className={cn('h-8 w-auto gap-1.5 px-2.5 text-sm', display?.topN && 'bg-secondary')}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">
              <Trans>Show all</Trans>
            </SelectItem>
            {TOP_N_CHOICES.map((count) => (
              <SelectItem key={count} value={String(count)}>
                {t`Top ${count}`}
              </SelectItem>
            ))}
            {display?.topN && !(TOP_N_CHOICES as readonly number[]).includes(display.topN) && (
              <SelectItem value={String(display.topN)}>{t`Top ${customTopN}`}</SelectItem>
            )}
          </SelectContent>
        </Select>
      )}
      {lastYear && (
        <Button
          variant={comparing ? 'secondary' : 'outline'}
          size="sm"
          className="h-8 gap-1.5 px-2.5"
          aria-pressed={comparing}
          onClick={() => onSpecChange?.(withLastYear(spec, !comparing))}
        >
          <History className="h-4 w-4" aria-hidden />
          <Trans>vs last year</Trans>
        </Button>
      )}
    </div>
  );
}
