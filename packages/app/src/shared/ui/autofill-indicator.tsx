import * as React from 'react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@shared/ui/tooltip';
import { cn } from '@shared/lib/utils';

interface AutofillIndicatorProps {
  show: boolean;
  className?: string;
}

export function AutofillIndicator({ show, className }: AutofillIndicatorProps) {
  if (!show) return null;

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={cn(
              'inline-flex h-2 w-2 rounded-full bg-primary/80 animate-in fade-in-0 zoom-in-50 duration-200',
              className
            )}
            aria-label="Auto-filled by rule"
          />
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          Auto-filled by rule
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
