import { createContext, useContext } from 'react';
import type { DateRange } from 'react-day-picker';
import type { Platform } from './builtin-cards';

export interface DashboardPeriodValue {
  dateRange: DateRange | undefined;
  setDateRange: (range: DateRange | undefined) => void;
  platform: Platform;
}

export const DashboardPeriodContext = createContext<DashboardPeriodValue | null>(null);

export function useDashboardPeriod(): DashboardPeriodValue {
  const value = useContext(DashboardPeriodContext);
  if (!value) throw new Error('useDashboardPeriod must be used inside DashboardPeriodProvider');
  return value;
}
