import { useLingui } from '@lingui/react/macro';
import { useState } from 'react';
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
  const CurrentIcon = VIZ_ICONS[current];

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
      <PopoverContent align="start" className="w-[22rem] space-y-3 p-3">
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
                const tile = (
                  <button
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    aria-disabled={blocker !== null}
                    aria-label={label}
                    onClick={() => {
                      if (blocker) return;
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
                      <Check className="absolute right-1 top-1 h-3 w-3 text-primary" aria-hidden />
                    )}
                    <Icon className="h-5 w-5" aria-hidden />
                    <span className="line-clamp-2">{label}</span>
                    {blocker && (
                      <span className="sr-only">{visualizationBlockerLabel(blocker)}</span>
                    )}
                  </button>
                );
                return blocker ? (
                  <Tooltip key={item}>
                    <TooltipTrigger asChild>{tile}</TooltipTrigger>
                    <TooltipContent side="bottom" className="max-w-56">
                      {visualizationBlockerLabel(blocker)}
                    </TooltipContent>
                  </Tooltip>
                ) : (
                  <div key={item}>{tile}</div>
                );
              })}
            </div>
          </section>
        ))}
      </PopoverContent>
    </Popover>
  );
}
