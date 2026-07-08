import { DropdownNavProps, DropdownProps, type Matcher } from 'react-day-picker';

import { Calendar } from '@shared/ui/calendar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@shared/ui/select';

interface MonthYearCalendarProps {
  selected?: Date | undefined;
  onSelect?: (date: Date | undefined) => void;
  className?: string;
  startMonth?: Date;
  endMonth?: Date;
  defaultMonth?: Date;
  disabled?: Matcher | Matcher[];
}

export function MonthYearCalendar({
  selected,
  onSelect,
  className = 'rounded-md border p-2',
  startMonth = new Date(new Date().getFullYear() - 50, 0),
  endMonth = new Date(new Date().getFullYear() + 50, 11),
  defaultMonth,
  disabled,
}: MonthYearCalendarProps) {
  const handleCalendarChange = (
    _value: string | number,
    _e: React.ChangeEventHandler<HTMLSelectElement>
  ) => {
    const _event = {
      target: {
        value: String(_value),
      },
    } as React.ChangeEvent<HTMLSelectElement>;
    _e(_event);
  };

  return (
    <Calendar
      mode="single"
      selected={selected}
      onSelect={onSelect}
      className={className}
      classNames={{
        month_caption: 'mx-0',
      }}
      captionLayout="dropdown"
      defaultMonth={defaultMonth || selected || new Date()}
      startMonth={startMonth}
      endMonth={endMonth}
      disabled={disabled}
      hideNavigation
      components={{
        DropdownNav: (props: DropdownNavProps) => {
          return <div className="flex w-full items-center gap-2">{props.children}</div>;
        },
        Dropdown: (props: DropdownProps) => {
          return (
            <Select
              value={String(props.value)}
              onValueChange={(value) => {
                if (props.onChange) {
                  handleCalendarChange(value, props.onChange);
                }
              }}
            >
              <SelectTrigger className="h-8 w-fit font-medium first:grow">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-[min(26rem,var(--radix-select-content-available-height))]">
                {props.options?.map((option) => (
                  <SelectItem
                    key={option.value}
                    value={String(option.value)}
                    disabled={option.disabled}
                  >
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          );
        },
      }}
    />
  );
}
