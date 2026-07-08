import React from 'react';
import { Button } from '@shared/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@shared/ui/popover';
import DateRangePicker from '@shared/ui/date-range-picker';
import { CalendarDays } from 'lucide-react';
import type { DateRange } from 'react-day-picker';

export interface AccountDateRangeControlsProps {
  dateRange: DateRange | undefined;
  periodLabel: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDateRangeChange: (range: DateRange | undefined) => void;
  variant: 'mobile' | 'desktop';
}

/**
 * Date range picker control for filtering transactions.
 * Supports both mobile and desktop variants.
 */
export const AccountDateRangeControls = React.memo(function AccountDateRangeControls({
  dateRange,
  periodLabel,
  open,
  onOpenChange,
  onDateRangeChange,
  variant,
}: AccountDateRangeControlsProps) {
  if (variant === 'mobile') {
    return (
      <Popover open={open} onOpenChange={onOpenChange}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            className="w-full justify-between gap-2 text-sm font-medium"
            size="sm"
          >
            <span className="flex items-center gap-2">
              <CalendarDays className="h-4 w-4" />
              <span className="truncate">{periodLabel}</span>
            </span>
            <span className="text-muted-foreground text-xs">Adjust</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-full p-4" align="start">
          <DateRangePicker value={dateRange} onChange={onDateRangeChange} className="w-full" />
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button variant="outline" className="w-auto justify-between gap-2 text-sm font-medium">
          <span className="flex items-center gap-2">
            <CalendarDays className="h-4 w-4" />
            <span className="hidden lg:inline">{periodLabel}</span>
            <span className="lg:hidden">Date Range</span>
          </span>
          <span className="text-muted-foreground text-xs">Adjust</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-full p-4" align="end">
        <DateRangePicker value={dateRange} onChange={onDateRangeChange} className="w-full" />
      </PopoverContent>
    </Popover>
  );
});
