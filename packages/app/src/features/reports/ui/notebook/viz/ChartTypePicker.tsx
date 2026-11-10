import { Trans, useLingui } from '@lingui/react/macro';
import { useRef, useState, type KeyboardEvent } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import {
  VISUALIZATION_ORDER,
  visualizationBlocker,
  type QuestionSpec,
  type ResolvedVisualization,
} from '@features/reports/lib/question';
import { Button } from '@shared/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@shared/ui/popover';
import { cn } from '@shared/lib/utils';
import { visualizationBlockerLabel, visualizationLabel } from '../question-labels';
import { VIZ_ICONS, recommendedVisualizations } from './viz-meta';

interface ChartTypePickerProps {
  spec: QuestionSpec;
  current: ResolvedVisualization;
  onPick: (visualization: ResolvedVisualization) => void;
}

/**
 * Chart type button + picker: the types that suit this question best first,
 * then the other ones that work, then the ones that don't with the reason
 * written next to them (no hover needed on a phone).
 */
export function ChartTypePicker({ spec, current, onPick }: ChartTypePickerProps) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const CurrentIcon = VIZ_ICONS[current];
  const recommended = recommendedVisualizations(spec);
  const available = VISUALIZATION_ORDER.filter(
    (item) => visualizationBlocker(spec, item) === null && !recommended.includes(item)
  );
  const unavailable = VISUALIZATION_ORDER.filter((item) => visualizationBlocker(spec, item));
  const tiles = [...recommended, ...available];
  // One tab stop for the whole picker (the current type); arrows move between tiles.
  const tabStop = tiles.includes(current) ? current : tiles[0];

  const onTileKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const buttons = Array.from(
      gridRef.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]') ?? []
    );
    const index = buttons.indexOf(event.currentTarget);
    if (index === -1) return;
    const step =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? -1
          : 0;
    let next = -1;
    if (step !== 0) next = (index + step + buttons.length) % buttons.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = buttons.length - 1;
    if (next === -1) return;
    event.preventDefault();
    buttons[next]?.focus();
  };

  const tile = (item: ResolvedVisualization, large: boolean) => {
    const Icon = VIZ_ICONS[item];
    const selected = item === current;
    const label = visualizationLabel(item);
    return (
      <button
        key={item}
        type="button"
        role="radio"
        aria-checked={selected}
        aria-label={label}
        tabIndex={item === tabStop ? 0 : -1}
        onKeyDown={onTileKeyDown}
        onClick={() => {
          onPick(item);
          setOpen(false);
        }}
        className={cn(
          'relative flex w-full flex-col items-center justify-center gap-1 rounded-md border px-1 text-center leading-tight transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          large ? 'h-[4.5rem] text-xs' : 'h-14 text-[11px]',
          selected
            ? 'border-primary bg-primary/10 text-foreground'
            : large
              ? 'border-border hover:bg-muted'
              : 'border-transparent hover:border-border hover:bg-muted'
        )}
      >
        {selected && <Check className="absolute right-1 top-1 h-3 w-3 text-primary" aria-hidden />}
        <Icon className={large ? 'h-6 w-6' : 'h-5 w-5'} aria-hidden />
        <span className="line-clamp-2">{label}</span>
      </button>
    );
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 px-2.5"
          aria-label={t`Chart type`}
        >
          <CurrentIcon className="h-4 w-4" aria-hidden />
          <span>{visualizationLabel(current)}</span>
          <ChevronDown className="h-3.5 w-3.5 opacity-60" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        // Clear of the phone's bottom bar; scrolls when it can't fit.
        collisionPadding={{ top: 8, bottom: 80, left: 8, right: 8 }}
        className="max-h-(--radix-popover-content-available-height) w-[min(22rem,calc(100vw-1rem))] space-y-3 overflow-y-auto p-3"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          (event.currentTarget as HTMLElement | null)
            ?.querySelector<HTMLElement>('[aria-checked="true"]')
            ?.focus();
        }}
      >
        <div ref={gridRef} className="space-y-3" role="radiogroup" aria-label={t`Chart type`}>
          {recommended.length > 0 && (
            <section aria-label={t`Recommended`}>
              <h3 className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                <Trans>Recommended</Trans>
              </h3>
              <div className="grid grid-cols-4 gap-1.5">
                {recommended.map((item) => tile(item, true))}
              </div>
            </section>
          )}
          {available.length > 0 && (
            <section aria-label={t`More chart types`}>
              <h3 className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                <Trans>More</Trans>
              </h3>
              <div className="grid grid-cols-4 gap-1.5">
                {available.map((item) => tile(item, false))}
              </div>
            </section>
          )}
        </div>
        {unavailable.length > 0 && (
          <section aria-label={t`Not available for this question`}>
            <h3 className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              <Trans>Not available for this question</Trans>
            </h3>
            <ul className="space-y-1">
              {unavailable.map((item) => {
                const Icon = VIZ_ICONS[item];
                const blocker = visualizationBlocker(spec, item);
                return (
                  <li key={item} className="flex items-start gap-2 text-xs text-muted-foreground">
                    <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-60" aria-hidden />
                    <span>
                      <span className="font-medium text-foreground/70">
                        {visualizationLabel(item)}
                      </span>
                      {blocker && <> · {visualizationBlockerLabel(blocker)}</>}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </PopoverContent>
    </Popover>
  );
}
