import { useLingui } from '@lingui/react/macro';
import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import {
  visualizationBlocker,
  type QuestionSpec,
  type ResolvedVisualization,
} from '@features/reports/lib/question';
import { Button } from '@shared/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@shared/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@shared/ui/tooltip';
import { cn } from '@shared/lib/utils';
import { visualizationBlockerLabel, visualizationLabel } from '../question-labels';
import { VIZ_GROUPS, VIZ_ICONS } from './viz-meta';

interface ChartTypePickerProps {
  spec: QuestionSpec;
  current: ResolvedVisualization;
  onPick: (visualization: ResolvedVisualization) => void;
}

/**
 * Chart type button + grouped grid of every type. Types that can't show this
 * question stay visible but disabled, with the reason on hover / focus.
 */
export function ChartTypePicker({ spec, current, onPick }: ChartTypePickerProps) {
  const { t, i18n } = useLingui();
  const [open, setOpen] = useState(false);
  // Why the last tapped type is unavailable (touch has no hover tooltip).
  const [notice, setNotice] = useState<string | null>(null);
  const reasonId = useId();
  const gridRef = useRef<HTMLDivElement | null>(null);
  const CurrentIcon = VIZ_ICONS[current];
  const allItems = VIZ_GROUPS.flatMap((group) => group.items);
  // One tab stop for the whole picker (the current type); arrows move between tiles.
  const tabStop = allItems.includes(current)
    ? current
    : (allItems.find((item) => visualizationBlocker(spec, item) === null) ?? allItems[0]);

  const onTileKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const tiles = Array.from(
      gridRef.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]') ?? []
    );
    const index = tiles.indexOf(event.currentTarget);
    if (index === -1) return;
    const step =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? -1
          : 0;
    let next = -1;
    if (step !== 0) next = (index + step + tiles.length) % tiles.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tiles.length - 1;
    if (next === -1) return;
    event.preventDefault();
    tiles[next]?.focus();
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setNotice(null);
      }}
    >
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
        className="w-[min(22rem,calc(100vw-1rem))] space-y-3 p-3"
        onOpenAutoFocus={(event) => {
          // Focus the current type, not the first tile (which may be disabled and
          // would pop its "why not" tooltip on open).
          event.preventDefault();
          (event.currentTarget as HTMLElement | null)
            ?.querySelector<HTMLElement>('[aria-checked="true"]')
            ?.focus();
        }}
      >
        <div ref={gridRef} className="space-y-3">
          {VIZ_GROUPS.map((group) => (
            <section key={group.id} aria-label={i18n._(group.label)}>
              <h3 className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {i18n._(group.label)}
              </h3>
              <div
                className="grid grid-cols-4 gap-1.5"
                role="radiogroup"
                aria-label={i18n._(group.label)}
              >
                {group.items.map((item) => {
                  const Icon = VIZ_ICONS[item];
                  const blocker = visualizationBlocker(spec, item);
                  const selected = item === current;
                  const label = visualizationLabel(item);
                  const reason = blocker ? visualizationBlockerLabel(blocker) : null;
                  const tile = (
                    <button
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      aria-disabled={blocker !== null}
                      aria-label={label}
                      aria-describedby={reason ? `${reasonId}-${item}` : undefined}
                      tabIndex={item === tabStop ? 0 : -1}
                      onKeyDown={onTileKeyDown}
                      onClick={() => {
                        if (reason) {
                          setNotice(t`${label}: ${reason}`);
                          return;
                        }
                        onPick(item);
                        setOpen(false);
                      }}
                      className={cn(
                        'relative flex h-16 w-full flex-col items-center justify-center gap-1 rounded-md border px-1 text-center text-[11px] leading-tight transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        selected
                          ? 'border-primary bg-primary/10 text-foreground'
                          : 'border-transparent hover:border-border hover:bg-muted',
                        blocker &&
                          'cursor-not-allowed opacity-40 hover:border-transparent hover:bg-transparent'
                      )}
                    >
                      {selected && (
                        <Check
                          className="absolute right-1 top-1 h-3 w-3 text-primary"
                          aria-hidden
                        />
                      )}
                      <Icon className="h-5 w-5" aria-hidden />
                      <span className="line-clamp-2">{label}</span>
                      {reason && (
                        <span id={`${reasonId}-${item}`} className="sr-only">
                          {reason}
                        </span>
                      )}
                    </button>
                  );
                  return blocker ? (
                    <Tooltip key={item}>
                      <TooltipTrigger asChild>{tile}</TooltipTrigger>
                      <TooltipContent side="bottom" className="max-w-56">
                        {reason}
                      </TooltipContent>
                    </Tooltip>
                  ) : (
                    <div key={item}>{tile}</div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
        <p aria-live="polite" className="min-h-4 text-xs text-muted-foreground">
          {notice}
        </p>
      </PopoverContent>
    </Popover>
  );
}
