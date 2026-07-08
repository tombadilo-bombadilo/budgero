import { useState, useEffect, useRef, useCallback } from 'react';
import { subDays, subMonths, startOfYear, endOfDay } from 'date-fns';
import { DateRange } from 'react-day-picker';
import { Tabs, TabsList, TabsTrigger } from '@shared/ui/tabs';
import { cn } from '@shared/lib/utils';

type PeriodType = '1W' | '1M' | '3M' | 'YTD';

interface PeriodTabsProps {
  value?: DateRange;
  onChange?: (range: DateRange | undefined) => void;
  defaultPeriod?: PeriodType;
  className?: string;
}

export function PeriodTabs({ value, onChange, defaultPeriod = '1M', className }: PeriodTabsProps) {
  const [selectedPeriod, setSelectedPeriod] = useState<PeriodType>(defaultPeriod);
  const hasInitializedRef = useRef(false);

  const getPeriodDateRange = useCallback((period: PeriodType): DateRange => {
    const today = endOfDay(new Date());

    switch (period) {
      case '1W':
        return {
          from: subDays(today, 7),
          to: today,
        };
      case '1M':
        return {
          from: subMonths(today, 1),
          to: today,
        };
      case '3M':
        return {
          from: subMonths(today, 3),
          to: today,
        };
      case 'YTD':
        return {
          from: startOfYear(today),
          to: today,
        };
      default:
        return {
          from: subMonths(today, 1),
          to: today,
        };
    }
  }, []);

  const handlePeriodChange = (period: PeriodType) => {
    setSelectedPeriod(period);
    const newRange = getPeriodDateRange(period);
    onChange?.(newRange);
  };

  // Initialize with default period on mount
  useEffect(() => {
    if (hasInitializedRef.current) return;
    hasInitializedRef.current = true;

    if (!value) {
      const initialRange = getPeriodDateRange(defaultPeriod);
      onChange?.(initialRange);
    }
  }, [value, defaultPeriod, onChange, getPeriodDateRange]);

  const TRIGGER_CLASS =
    'data-[state=active]:bg-primary data-[state=active]:text-primary-foreground rounded-full data-[state=active]:shadow-none';

  return (
    <Tabs
      value={selectedPeriod}
      onValueChange={(value) => handlePeriodChange(value as PeriodType)}
      className={cn('items-center', className)}
    >
      <TabsList className="gap-1 bg-transparent">
        <TabsTrigger value="1W" className={TRIGGER_CLASS}>
          1W
        </TabsTrigger>
        <TabsTrigger value="1M" className={TRIGGER_CLASS}>
          1M
        </TabsTrigger>
        <TabsTrigger value="3M" className={TRIGGER_CLASS}>
          3M
        </TabsTrigger>
        <TabsTrigger value="YTD" className={TRIGGER_CLASS}>
          YTD
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
}
