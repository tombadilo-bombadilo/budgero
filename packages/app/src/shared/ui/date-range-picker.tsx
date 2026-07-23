'use client';

import { useMemo, useState } from 'react';
import {
  addDays,
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

  // Nearest-edge selection: an existing range is ADJUSTED, never restarted.
  // Clicking before the range moves the start, after it moves the end, and
  // inside it moves whichever edge is closer (tie → end). This replaces the
  // react-day-picker default where any click on a complete range throws the
  // whole selection away and starts over from a new start date.
  const handleDayClick = (day: Date) => {
    const from = date?.from;
    const to = date?.to;
    let next: DateRange;
    if (from && to) {
      const distanceToStart = Math.abs(day.getTime() - from.getTime());
      const distanceToEnd = Math.abs(day.getTime() - to.getTime());
      next = distanceToStart < distanceToEnd ? { from: day, to } : { from, to: day };
    } else if (from) {
      next = day < from ? { from: day, to: from } : { from, to: day };
    } else {
      next = { from: day, to: day };
    }
    // Keep the calendar on the month the user is looking at — no view jump.
    onChange?.(coerceRange(next));
  };

  const disabledRules = disableFuture ? [{ after: today }] : undefined;

  return (
    <div className={className}>
      <div className="rounded-md border">
        <div className="flex max-sm:flex-col">
          <div className="relative py-4 max-sm:order-1 max-sm:border-t sm:w-32">
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
                        className="justify-start sm:w-full"
                        onClick={() => handlePreset(presetRange, presetKey)}
                      >
                        {PRESET_LABELS[presetKey]}
                      </Button>
                    );
                  })}
              </div>
            </div>
          </div>
          <Calendar
            mode="range"
            selected={date}
            // Selection is fully controlled by onDayClick (nearest-edge);
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
  );
}

export default DateRangePicker;
export type { PresetKey as DateRangePresetKey };
