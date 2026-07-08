import { format, parseISO } from 'date-fns';
import { Calendar as CalendarIcon } from 'lucide-react';
import { Button } from '@shared/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@shared/ui/popover';
import { MonthYearCalendar } from '@shared/ui/MonthYearCalendar';

interface DatePickerButtonProps {
  /** ISO `yyyy-MM-dd` date string, or `''` when unset. */
  value: string;
  /** Called with an ISO `yyyy-MM-dd` string, or `''` when cleared. */
  onChange: (value: string) => void;
  placeholder?: string;
}

export function DatePickerButton({
  value,
  onChange,
  placeholder = 'Pick a date',
}: DatePickerButtonProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="w-full px-3 justify-start text-left bg-background border-input hover:bg-accent hover:text-accent-foreground"
        >
          <CalendarIcon className="mr-2 h-4 w-4 opacity-70" />
          {value ? format(parseISO(value), 'PPP') : placeholder}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start" sideOffset={8} modal>
        <MonthYearCalendar
          selected={value ? parseISO(value) : undefined}
          onSelect={(d) => onChange(d ? format(d, 'yyyy-MM-dd') : '')}
        />
      </PopoverContent>
    </Popover>
  );
}
