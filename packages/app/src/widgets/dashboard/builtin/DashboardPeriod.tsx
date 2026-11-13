import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { DateRange } from 'react-day-picker';
import { subDays } from 'date-fns';
import { useUiStore } from '@shared/store/useUiStore';
import type { Platform } from './builtin-cards';
import { DashboardPeriodContext } from './useDashboardPeriod';

/** The old home's starting range: the last 30 days (29 on the phone). */
function initialRange(platform: Platform): DateRange {
  return { from: subDays(new Date(), platform === 'mobile' ? 29 : 30), to: new Date() };
}

/**
 * The period the built-in cards of one dashboard view follow (the 1W / 1M /
 * 3M / YTD tabs). Owned by the view so other pages can't overwrite it; it is
 * pushed one way into the shared store, which the spending cards read.
 */
export function DashboardPeriodProvider({
  platform,
  children,
}: {
  platform: Platform;
  children: ReactNode;
}) {
  const [dateRange, setDateRange] = useState<DateRange | undefined>(() => initialRange(platform));
  const setGlobalDateRange = useUiStore((state) => state.setDateRange);
  useEffect(() => {
    setGlobalDateRange(dateRange);
  }, [dateRange, setGlobalDateRange]);

  const value = useMemo(() => ({ dateRange, setDateRange, platform }), [dateRange, platform]);
  return (
    <DashboardPeriodContext.Provider value={value}>{children}</DashboardPeriodContext.Provider>
  );
}
