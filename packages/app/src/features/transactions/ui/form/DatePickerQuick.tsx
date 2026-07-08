/**
 * Date Picker with Quick Buttons Component
 *
 * Date picker with Today, -1 day, and +1 day quick action buttons.
 */

import { useCallback } from 'react';
import { format } from 'date-fns';
import { Calendar as CalendarIcon } from 'lucide-react';
import { Button } from '@shared/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@shared/ui/popover';
import { MonthYearCalendar } from '@shared/ui/MonthYearCalendar';

interface DatePickerQuickProps {
  value: Date | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (date: Date | null) => void;
}

export function DatePickerQuick({ value, open, onOpenChange, onChange }: DatePickerQuickProps) {
  const handleDateSelect = useCallback(
    (date: Date | undefined) => {
      onChange(date || null);
      onOpenChange(false);
    },
    [onChange, onOpenChange]
  );

  const setDateRelative = useCallback(
    (days: number) => {
      const base = value ? new Date(value) : new Date();
      const next = new Date(base);
      next.setDate(base.getDate() + days);
      onChange(next);
      onOpenChange(false);
    },
    [value, onChange, onOpenChange]
  );

  const setDateToday = useCallback(() => {
    onChange(new Date());
    onOpenChange(false);
  }, [onChange, onOpenChange]);

  return (
    <>
      <div className="space-y-1.5 sm:space-y-2">
        <div className="flex items-center gap-2">
          <CalendarIcon className="h-4 w-4 text-muted-foreground" />
          <div className="flex-1">
            <Popover open={open} onOpenChange={onOpenChange}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className="w-full justify-start text-left h-8 sm:h-10 px-3 sm:px-4 bg-background border-input hover:bg-accent hover:text-accent-foreground transition-colors"
                >
                  {value ? format(value, 'PPP') : 'Select date'}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start" modal>
                <MonthYearCalendar selected={value || undefined} onSelect={handleDateSelect} />
              </PopoverContent>
            </Popover>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 w-full max-w-full px-6">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="h-8 sm:h-9 w-full justify-center"
          onClick={setDateToday}
        >
          Today
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 sm:h-9 w-full justify-center"
          onClick={() => setDateRelative(-1)}
        >
          -1 day
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 sm:h-9 w-full justify-center"
          onClick={() => setDateRelative(1)}
        >
          +1 day
        </Button>
      </div>
    </>
  );
}
