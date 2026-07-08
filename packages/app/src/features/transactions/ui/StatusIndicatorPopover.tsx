import { CalendarClock, CheckCircle2, type LucideIcon } from 'lucide-react';
import { Button } from '@shared/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@shared/ui/popover';
import { cn } from '@shared/lib/utils';

type StatusKind = 'reconciled' | 'future' | 'projected';

const STATUS_CONFIG: Record<
  StatusKind,
  { icon: LucideIcon; buttonColor: string; label: string; srText: string; text: string }
> = {
  reconciled: {
    icon: CheckCircle2,
    buttonColor: 'text-success hover:bg-success/10',
    label: 'Reconciled transaction',
    srText: 'Reconciled transaction details',
    text: 'This transaction has been reconciled.',
  },
  future: {
    icon: CalendarClock,
    buttonColor: 'bg-primary/10 text-primary hover:bg-primary/20',
    label: 'Future transaction',
    srText: 'Future transaction',
    text: 'This transaction is scheduled for a future date.',
  },
  projected: {
    icon: CalendarClock,
    buttonColor: 'bg-primary/10 text-primary hover:bg-primary/20',
    label: 'Projected recurring transaction',
    srText: 'Projected recurring transaction',
    text:
      "Projected from a recurring transaction that hasn't been marked ready yet. " +
      'Mark it ready or skip it from the upcoming panel or the automations page.',
  },
};

interface StatusIndicatorPopoverProps {
  status: StatusKind;
  /** Trigger button size, e.g. 'h-7 w-7' (desktop table) or 'h-6 w-6' (mobile card). */
  buttonSize?: string;
  /** Icon size, e.g. 'h-4 w-4' or 'h-3.5 w-3.5'. */
  iconSize?: string;
  /** PopoverContent width, e.g. 'w-56' / 'w-60' / 'w-64'. */
  contentWidth?: string;
}

/** Round status icon (reconciled / future / projected) with an explanatory popover. */
export function StatusIndicatorPopover({
  status,
  buttonSize = 'h-7 w-7',
  iconSize = 'h-4 w-4',
  contentWidth = 'w-56',
}: StatusIndicatorPopoverProps) {
  const { icon: Icon, buttonColor, label, srText, text } = STATUS_CONFIG[status];
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn(buttonSize, 'rounded-full', buttonColor)}
          aria-label={label}
        >
          <Icon className={iconSize} />
          <span className="sr-only">{srText}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className={cn(contentWidth, 'text-sm')}>
        <p>{text}</p>
      </PopoverContent>
    </Popover>
  );
}
