import type { ComponentProps, ReactNode } from 'react';
import { HelpCircle } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@shared/ui/tooltip';
import { cn } from '@shared/lib/utils';

type TooltipContentProps = ComponentProps<typeof TooltipContent>;

interface HelpTooltipProps {
  /** Tooltip content shown on hover. */
  children: ReactNode;
  /** Extra classes for the tooltip content (e.g. `max-w-xs`). */
  contentClassName?: string;
  /** Classes for the trigger HelpCircle icon. Defaults to `h-3.5 w-3.5`. */
  iconClassName?: string;
  /** Preferred side of the trigger to render against. */
  side?: TooltipContentProps['side'];
  /** Preferred alignment against the trigger. */
  align?: TooltipContentProps['align'];
}

/**
 * A small help affordance: a `HelpCircle` icon button that reveals explanatory
 * content in a tooltip on hover. Replaces the hand-rolled
 * Tooltip/Trigger/Content + HelpCircle markup duplicated across forms.
 */
export function HelpTooltip({
  children,
  contentClassName,
  iconClassName,
  side,
  align,
}: HelpTooltipProps) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button type="button" className="text-muted-foreground">
            <HelpCircle className={cn('h-3.5 w-3.5', iconClassName)} />
          </button>
        </TooltipTrigger>
        <TooltipContent className={contentClassName} side={side} align={align}>
          {children}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
