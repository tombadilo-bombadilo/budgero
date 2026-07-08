import { HelpCircle } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@shared/ui/popover';
import { cn } from '@shared/lib/utils';

interface ReadyToAssignHelpPopoverProps {
  /** Trigger-button sizing/tone classes (varies per layout). */
  triggerClassName?: string;
  side?: 'top' | 'bottom';
  align?: 'start' | 'center';
}

/** The "What does Ready to Assign mean?" help popover. */
export function ReadyToAssignHelpPopover({
  triggerClassName,
  side = 'bottom',
  align = 'start',
}: ReadyToAssignHelpPopoverProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'inline-flex items-center justify-center rounded-full transition hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            triggerClassName
          )}
          aria-label="What does Ready to Assign mean?"
        >
          <HelpCircle className="h-3 w-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 text-xs" side={side} align={align}>
        <p>
          Money available to assign to budget categories. This equals your total income minus all
          budget assignments. Positive means funds to allocate; negative means you have
          over-budgeted.
        </p>
      </PopoverContent>
    </Popover>
  );
}
