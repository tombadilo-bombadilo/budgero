import { useCallback, useMemo, useState } from 'react';
import type { DateRange } from 'react-day-picker';
import { subDays, startOfDay, endOfDay } from 'date-fns';
import { formatPeriodLabel } from '../account-page.utils';

/**
 * Register date-range wiring shared by AccountPage and AllTransactionsPage:
 * range state defaulting to the last 180 days, a change handler that closes
 * both pickers once a complete range is picked, the mobile/desktop picker
 * open-state pair, and the human-readable period label.
 */
export function useAccountDateRange() {
  const [dateRange, setDateRange] = useState<DateRange | undefined>(() => {
    const today = endOfDay(new Date());
    const start = startOfDay(subDays(today, 180));
    return { from: start, to: today };
  });
  const [isMobileDatePickerOpen, setIsMobileDatePickerOpen] = useState(false);
  const [isDesktopDatePickerOpen, setIsDesktopDatePickerOpen] = useState(false);

  const handleDateRangeChange = useCallback((range: DateRange | undefined) => {
    setDateRange(range);
    if (range?.from && range?.to) {
      setIsMobileDatePickerOpen(false);
      setIsDesktopDatePickerOpen(false);
    }
  }, []);

  const periodLabel = useMemo(() => formatPeriodLabel(dateRange), [dateRange]);

  return {
    dateRange,
    handleDateRangeChange,
    periodLabel,
    isMobileDatePickerOpen,
    setIsMobileDatePickerOpen,
    isDesktopDatePickerOpen,
    setIsDesktopDatePickerOpen,
  };
}
