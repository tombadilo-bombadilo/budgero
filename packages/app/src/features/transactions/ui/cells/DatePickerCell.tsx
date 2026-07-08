import * as React from 'react';
import { format, parseISO } from 'date-fns';

import { Button } from '@shared/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@shared/ui/popover';
import { MonthYearCalendar } from '@shared/ui/MonthYearCalendar';

interface DatePickerCellProps {
  value: string | null | undefined;
  onCommit: (newVal: string) => void;
}

/**
 * DatePickerCell
 * -------------
 * A read/write cell UI using shadcn/ui's Popover + Calendar.
 * - Shows current date in a Button
 * - When clicked, opens a calendar
 * - On select, calls onCommit() with the new date in "yyyy-MM-dd" format
 */
export function DatePickerCell({ value, onCommit }: DatePickerCellProps) {
  const [date, setDate] = React.useState<Date | null>(() => {
    return value ? parseISO(value) : null;
  });
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    if (value) {
      setDate(parseISO(value));
    } else {
      setDate(null);
    }
  }, [value]);

  function handleSelect(selectedDate: Date | undefined) {
    setDate(selectedDate ?? null);
    setOpen(false);

    if (selectedDate) {
      const formatted = format(selectedDate, 'yyyy-MM-dd');
      onCommit(formatted);
    } else {
      onCommit('');
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" className="p-2 h-8">
          {date ? format(date, 'yyyy-MM-dd') : 'Pick a date'}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start" modal>
        <MonthYearCalendar
          selected={date ?? undefined}
          onSelect={handleSelect}
          defaultMonth={date ? new Date(date.getFullYear(), date.getMonth()) : new Date()}
        />
      </PopoverContent>
    </Popover>
  );
}
