'use client';

import { useLingui } from '@lingui/react/macro';

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
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { formatDate as format } from '@shared/lib/date-format';
import { DateRange } from 'react-day-picker';

import { cn } from '@shared/lib/utils';
import { Button } from '@shared/ui/button';
import { Calendar } from '@shared/ui/calendar';
import { PRESET_LABELS, type PresetKey } from '@shared/ui/date-range-presets';

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
  const { t } = useLingui();
  const monthLabels = Array.from({ length: 12 }, (_, i) => format(new Date(2000, i, 1), 'MMM'));

  const today = useMemo(() => new Date(), []);
  const presets = useMemo(() => createPresets(today), [today]);

  // Derive date from controlled value prop - no sync effect needed
  const date = useMemo(() => coerceRange(value) ?? presets.last30Days, [value, presets]);

  // Month is internal UI state for the calendar view
  const initialMonth = date?.to ?? date?.from ?? today;
  const [month, setMonth] = useState(initialMonth);

  // Calendar view mode: 'day' shows the DayPicker, 'month' shows the MonthPickerPopover-style grid
  const [calendarView, setCalendarView] = useState<'day' | 'month'>('day');
  const [viewYear, setViewYear] = useState(initialMonth.getFullYear());

  // Track previous date to detect external changes (React-approved pattern)
  // See: https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
  const [prevDate, setPrevDate] = useState(date);
  if (date !== prevDate) {
    setPrevDate(date);
    const newMonth = date?.to ?? date?.from;
    if (newMonth && newMonth.getTime() !== month.getTime()) {
      setMonth(newMonth);
      setViewYear(newMonth.getFullYear());
    }
  }

  const handlePreset = (range: DateRange, preset: PresetKey) => {
    const coerced = coerceRange(range);
    if (coerced?.to) {
      setMonth(coerced.to);
      setViewYear(coerced.to.getFullYear());
    }
    setCalendarView('day');
    onChange?.(coerced, preset);
  };

  // Explicit-field selection: Start and End are visible fields above the
  // calendar; a calendar click sets whichever field is armed, then arms the
  // other. Predictable — no restart-on-click, no nearest-edge guessing.
  const [armed, setArmed] = useState<'from' | 'to'>('from');

  const armField = (field: 'from' | 'to') => {
    setArmed(field);
    setCalendarView('day');
    // Bring the armed edge's month into view so it can be adjusted directly.
    const target = field === 'from' ? date?.from : date?.to;
    if (target) {
      setMonth(target);
      setViewYear(target.getFullYear());
    }
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

  const fullMonthLabel = format(month, 'MMMM yyyy');
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
                        type="button"
                        key={presetKey}
                        variant="ghost"
                        size="sm"
                        className="justify-start whitespace-nowrap sm:w-full"
                        onClick={() => handlePreset(presetRange, presetKey)}
                      >
                        {t(PRESET_LABELS[presetKey])}
                      </Button>
                    );
                  })}
              </div>
            </div>
          </div>
          <div className="flex flex-col">
            <div className="flex items-center gap-2 border-b px-3 py-2">
              {(['from', 'to'] as const).map((field) => {
                const label = field === 'from' ? t`Start` : t`End`;
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
                      {fieldDate ? format(fieldDate, "MMM d, ''yy") : t`Pick a date`}
                    </span>
                  </button>
                );
              })}
            </div>

            {calendarView === 'month' ? (
              <div className="flex w-[268px] min-h-[304px] flex-col justify-between p-3">
                <div>
                  {/* Year stepper */}
                  <div className="mb-3 flex items-center justify-between">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      aria-label={t`Previous year`}
                      onClick={() => setViewYear((y) => y - 1)}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <span className="text-sm font-semibold tabular-nums">{viewYear}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      aria-label={t`Next year`}
                      disabled={disableFuture && viewYear >= today.getFullYear()}
                      onClick={() => setViewYear((y) => y + 1)}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>

                  {/* Month grid */}
                  <div className="grid grid-cols-4 gap-1.5">
                    {monthLabels.map((monthLabel, monthIndex) => {
                      const isSelected =
                        monthIndex === month.getMonth() && viewYear === month.getFullYear();
                      const isCurrent =
                        monthIndex === today.getMonth() && viewYear === today.getFullYear();
                      const isDisabled =
                        disableFuture &&
                        (viewYear > today.getFullYear() ||
                          (viewYear === today.getFullYear() && monthIndex > today.getMonth()));

                      return (
                        <button
                          key={monthIndex}
                          type="button"
                          disabled={isDisabled}
                          onClick={() => {
                            const newMonth = new Date(viewYear, monthIndex, 1);
                            setMonth(newMonth);
                            setCalendarView('day');
                          }}
                          aria-current={isSelected ? 'true' : undefined}
                          className={cn(
                            'rounded-md py-2 text-xs font-medium transition-colors',
                            'hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                            isSelected && 'bg-primary text-primary-foreground hover:bg-primary/90',
                            !isSelected && isCurrent && 'ring-1 ring-inset ring-primary/60',
                            isDisabled && 'pointer-events-none opacity-30 line-through'
                          )}
                        >
                          {monthLabel}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Footer buttons */}
                <div className="mt-3 flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="flex-1 text-xs"
                    onClick={() => {
                      setMonth(today);
                      setViewYear(today.getFullYear());
                      setCalendarView('day');
                    }}
                  >
                    {t`Jump to today`}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-xs"
                    onClick={() => setCalendarView('day')}
                  >
                    {t`Choose a day`}
                  </Button>
                </div>
              </div>
            ) : (
              <Calendar
                mode="range"
                selected={date}
                // Selection is fully controlled by onDayClick (armed field);
                // react-day-picker's own range proposals are ignored.
                onSelect={() => {}}
                onDayClick={handleDayClick}
                month={month}
                onMonthChange={(newMonth) => {
                  setMonth(newMonth);
                  setViewYear(newMonth.getFullYear());
                }}
                className="p-2"
                disabled={disabledRules}
                components={{
                  CaptionLabel: ({ children }) => (
                    <button
                      type="button"
                      onClick={() => {
                        setViewYear(month.getFullYear());
                        setCalendarView('month');
                      }}
                      className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-sm font-medium hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors"
                      aria-label={t`Change month and year — currently ${fullMonthLabel}`}
                    >
                      <span>{children}</span>
                      <ChevronDown className="h-3.5 w-3.5 opacity-60" />
                    </button>
                  ),
                }}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default DateRangePicker;
export type { PresetKey as DateRangePresetKey };
