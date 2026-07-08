import { useMemo, useState } from 'react';
import { format, parse } from 'date-fns';
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';

import { Button } from '@shared/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@shared/ui/popover';
import { cn } from '@shared/lib/utils';

interface MonthPickerPopoverProps {
  /** Selected month in YYYY-MM format. */
  value: string;
  /** Called with the newly selected month in YYYY-MM format. */
  onChange: (month: string) => void;
  /** Classes for the trigger label so it can match each layout's existing styling. */
  triggerClassName?: string;
  /** Popover alignment relative to the trigger. */
  align?: 'start' | 'center' | 'end';
  /** date-fns format for the trigger label. Defaults to the full "MMMM yyyy". */
  labelFormat?: string;
}

// Locale-aware short month labels (Jan…Dec), computed once.
const MONTH_LABELS = Array.from({ length: 12 }, (_, i) => format(new Date(2000, i, 1), 'MMM'));

function monthKey(year: number, monthIndex: number): string {
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
}

/**
 * A compact month/year picker: clicking the month label opens a popover with a
 * year stepper over a grid of months, so jumping many months is one or two
 * clicks instead of repeatedly tapping a chevron. The prev/next month chevrons
 * around it (rendered by the caller) stay for single-step navigation.
 */
export default function MonthPickerPopover({
  value,
  onChange,
  triggerClassName,
  align = 'center',
  labelFormat = 'MMMM yyyy',
}: MonthPickerPopoverProps) {
  const [open, setOpen] = useState(false);

  const selectedDate = useMemo(() => parse(`${value}-01`, 'yyyy-MM-dd', new Date()), [value]);
  const selectedYear = selectedDate.getFullYear();
  const selectedMonthIndex = selectedDate.getMonth();
  const label = format(selectedDate, labelFormat);
  const fullLabel = format(selectedDate, 'MMMM yyyy');

  const todayKey = format(new Date(), 'yyyy-MM');

  // The year currently shown in the grid. Tracks the selected year, and is
  // reset to it each time the popover opens so it never drifts after browsing.
  const [viewYear, setViewYear] = useState(selectedYear);

  const handleOpenChange = (next: boolean) => {
    if (next) setViewYear(selectedYear);
    setOpen(next);
  };

  const selectMonth = (monthIndex: number) => {
    onChange(monthKey(viewYear, monthIndex));
    setOpen(false);
  };

  const jumpToToday = () => {
    onChange(todayKey);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Change month — currently ${fullLabel}`}
          className={cn(
            'inline-flex min-w-0 items-center justify-center gap-1 rounded-md px-1.5 py-1 font-medium hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            triggerClassName
          )}
        >
          <span className="truncate">{label}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent align={align} className="w-64 p-3">
        {/* Year stepper */}
        <div className="mb-2 flex items-center justify-between">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            aria-label="Previous year"
            onClick={() => setViewYear((y) => y - 1)}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm font-semibold tabular-nums">{viewYear}</span>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            aria-label="Next year"
            onClick={() => setViewYear((y) => y + 1)}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        {/* Month grid */}
        <div className="grid grid-cols-4 gap-1">
          {MONTH_LABELS.map((monthLabel, monthIndex) => {
            const key = monthKey(viewYear, monthIndex);
            const isSelected = monthIndex === selectedMonthIndex && viewYear === selectedYear;
            const isCurrent = key === todayKey;
            return (
              <button
                key={monthLabel}
                type="button"
                onClick={() => selectMonth(monthIndex)}
                aria-current={isSelected ? 'true' : undefined}
                className={cn(
                  'rounded-md py-1.5 text-xs font-medium transition-colors',
                  'hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  isSelected && 'bg-primary text-primary-foreground hover:bg-primary/90',
                  !isSelected && isCurrent && 'ring-1 ring-inset ring-primary/60'
                )}
              >
                {monthLabel}
              </button>
            );
          })}
        </div>

        <Button variant="outline" size="sm" className="mt-3 w-full" onClick={jumpToToday}>
          Jump to today
        </Button>
      </PopoverContent>
    </Popover>
  );
}
