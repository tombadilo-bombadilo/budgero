'use client';

import { useMemo, useState } from 'react';
import {
  addDays,
  format,
  addMonths,
  endOfMonth,
  endOfYear,
  startOfMonth,
  startOfYear,
  subDays,
  subMonths,
  subYears,
} from 'date-fns';
import { DateRange } from 'react-day-picker';

import { cn } from '@shared/lib/utils';
import { Button } from '@shared/ui/button';
import { Calendar } from '@shared/ui/calendar';

type PresetKey =
  | 'last14Days'
  | 'last30Days'
  | 'last90Days'
  | 'monthToDate'
  | 'lastMonth'
  | 'yearToDate'
  | 'lastYear'
  | 'allTime'
  | 'next30Days'
  | 'next3Months';

const PRESET_LABELS: Record<PresetKey, string> = {
  last14Days: 'Last 14 days',
  last30Days: 'Last 30 days',
  last90Days: 'Last 90 days',
  monthToDate: 'Month to date',
  lastMonth: 'Last month',
  yearToDate: 'Year to date',
  lastYear: 'Last year',
  allTime: 'All time',
  next30Days: 'Next 30 days',
  next3Months: 'Next 3 months',
};

const FUTURE_PRESETS: ReadonlySet<PresetKey> = new Set(['next30Days', 'next3Months']);

export interface DateRangePickerProps {
  value?: DateRange;
  onChange?: (range: DateRange | undefined, preset?: PresetKey) => void;
  disableFuture?: boolean;
  className?: string;
}

function createPresets(today: Date) {
  return {
    last14Days: {
      from: subDays(today, 13),
      to: today,
    },
    last30Days: {
      from: subDays(today, 29),
      to: today,
    },
    last90Days: {
      from: subDays(today, 89),
      to: today,
    },
    monthToDate: {
      from: startOfMonth(today),
      to: today,
    },
    lastMonth: {
      from: startOfMonth(subMonths(today, 1)),
      to: endOfMonth(subMonths(today, 1)),
    },
    yearToDate: {
      from: startOfYear(today),
      to: today,
    },
    lastYear: {
      from: startOfYear(subYears(today, 1)),
      to: endOfYear(subYears(today, 1)),
    },
    allTime: {
      from: new Date(2000, 0, 1),
      to: today,
    },
    next30Days: {
      from: today,
      to: addDays(today, 30),
    },
    next3Months: {
      from: today,
      to: addMonths(today, 3),
    },
  } satisfies Record<PresetKey, DateRange>;
}

function coerceRange(range?: DateRange): DateRange | undefined {
  if (range?.from && range?.to && range.to < range.from) {
    return { from: range.to, to: range.from };
  }
  return range;
}

export function DateRangePicker({
  value,
  onChange,
  disableFuture = false,
  className,
}: DateRangePickerProps) {
  const today = useMemo(() => new Date(), []);
  const presets = useMemo(() => createPresets(today), [today]);

  // Derive date from controlled value prop - no sync effect needed
  const date = useMemo(() => coerceRange(value) ?? presets.last30Days, [value, presets]);

  // Month is internal UI state for the calendar view
  const initialMonth = date?.to ?? date?.from ?? today;
  const [month, setMonth] = useState(initialMonth);

  // Track previous date to detect external changes (React-approved pattern)
  // See: https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
  const [prevDate, setPrevDate] = useState(date);
  if (date !== prevDate) {
    setPrevDate(date);
    const newMonth = date?.to ?? date?.from;
    if (newMonth && newMonth.getTime() !== month.getTime()) {
      setMonth(newMonth);
    }
  }

  const handlePreset = (range: DateRange, preset: PresetKey) => {
    const coerced = coerceRange(range);
    if (coerced?.to) setMonth(coerced.to);
    onChange?.(coerced, preset);
  };

  // Explicit-field selection: Start and End are visible fields above the
  // calendar; a calendar click sets whichever field is armed, then arms the
  // other. Predictable — no restart-on-click, no nearest-edge guessing.
  const [armed, setArmed] = useState<'from' | 'to'>('from');

  const armField = (field: 'from' | 'to') => {
    setArmed(field);
    // Bring the armed edge's month into view so it can be adjusted directly.
    const target = field === 'from' ? date?.from : date?.to;
    if (target) setMonth(target);
  };

  const handleDayClick = (day: Date) => {
    if (armed === 'from') {
      const keepEnd = date?.to && date.to >= day ? date.to : undefined;
      onChange?.({ from: day, to: keepEnd });
      setArmed('to');
      return;
    }
    const from = date?.from;
    if (from && day < from) {
      // Picking an "end" before the start restarts the range from that day.
      onChange?.({ from: day, to: undefined });
      return;
    }
    onChange?.({ from: from ?? day, to: day });
  };

  const disabledRules = disableFuture ? [{ after: today }] : undefined;

  return (
    <div className={className}>
      <div className="rounded-md border">
        <div className="flex max-sm:flex-col">
          <div className="relative py-4 max-sm:order-1 max-sm:border-t sm:w-44">
            <div className="h-full sm:border-e">
              <div className="grid grid-cols-2 gap-1 px-2 sm:flex sm:flex-col sm:gap-0">
                {(Object.keys(PRESET_LABELS) as PresetKey[])
                  .filter((presetKey) => !disableFuture || !FUTURE_PRESETS.has(presetKey))
                  .map((presetKey) => {
                    const presetRange = presets[presetKey];
                    return (
                      <Button
                        key={presetKey}
                        variant="ghost"
                        size="sm"
                        className="justify-start whitespace-nowrap sm:w-full"
                        onClick={() => handlePreset(presetRange, presetKey)}
                      >
                        {PRESET_LABELS[presetKey]}
                      </Button>
                    );
                  })}
              </div>
            </div>
          </div>
          <div className="flex flex-col">
            <div className="flex items-center gap-2 border-b px-3 py-2">
              {(['from', 'to'] as const).map((field) => {
                const label = field === 'from' ? 'Start' : 'End';
                const fieldDate = field === 'from' ? date?.from : date?.to;
                const isArmed = armed === field;
                return (
                  <button
                    key={field}
                    type="button"
                    onClick={() => armField(field)}
                    aria-pressed={isArmed}
                    className={cn(
                      'flex-1 rounded-md border px-3 py-1.5 text-left text-sm transition-colors',
                      isArmed
                        ? 'border-primary bg-primary/5 font-medium'
                        : 'border-border/70 text-muted-foreground hover:bg-muted'
                    )}
                  >
                    <span className="block text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      {label}
                    </span>
                    <span className="whitespace-nowrap">
                      {fieldDate ? format(fieldDate, "MMM d, ''yy") : 'Pick a date'}
                    </span>
                  </button>
                );
              })}
            </div>
            <Calendar
              mode="range"
              selected={date}
              // Selection is fully controlled by onDayClick (armed field);
              // react-day-picker's own range proposals are ignored.
              onSelect={() => {}}
              onDayClick={handleDayClick}
              month={month}
              onMonthChange={setMonth}
              className="p-2"
              disabled={disabledRules}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export default DateRangePicker;
export type { PresetKey as DateRangePresetKey };
