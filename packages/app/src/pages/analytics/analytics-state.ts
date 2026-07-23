import { useCallback, useMemo, useState } from 'react';
import { getTodayISO } from '@shared/lib/date-utils';
import { monthKeysInRange, shiftMonthKey, type AnalyticsFilters } from './analytics-model';

export type ReportKey =
  | 'wealth'
  | 'spending'
  | 'in-out'
  | 'money-map'
  | 'plan'
  | 'scenario'
  | 'ledger';

export type PeriodKey = '3m' | '6m' | '12m' | '24m' | 'ytd' | 'all' | 'custom';

export const PERIOD_LABELS: Record<PeriodKey, string> = {
  '3m': 'Last 3 months',
  '6m': 'Last 6 months',
  '12m': 'Last 12 months',
  '24m': 'Last 24 months',
  ytd: 'Year to date',
  all: 'All time',
  custom: 'Custom range',
};

export interface AnalyticsSelections {
  period: PeriodKey;
  customStart: string;
  customEnd: string;
  accountIds: number[];
  categoryIds: number[];
  payees: string[];
  labelIds: number[];
}

export const DEFAULT_SELECTIONS: AnalyticsSelections = {
  period: '12m',
  customStart: '',
  customEnd: '',
  accountIds: [],
  categoryIds: [],
  payees: [],
  labelIds: [],
};

export function lastDayOfMonth(monthKey: string): string {
  const [year, month] = monthKey.split('-').map(Number);
  const days = new Date(year, month, 0).getDate();
  return `${monthKey}-${String(days).padStart(2, '0')}`;
}

export interface ResolvedPeriod {
  /** '' means unbounded (all time) — clamp to data when building a month axis. */
  startDate: string;
  endDate: string;
}

export function resolvePeriod(selections: AnalyticsSelections, todayISO: string): ResolvedPeriod {
  const currentMonth = todayISO.slice(0, 7);
  let startDate: string;
  let endDate = lastDayOfMonth(currentMonth);
  switch (selections.period) {
    case '3m':
    case '6m':
    case '12m':
    case '24m': {
      const monthCount = Number(selections.period.replace('m', ''));
      startDate = `${shiftMonthKey(currentMonth, -(monthCount - 1))}-01`;
      break;
    }
    case 'ytd':
      startDate = `${todayISO.slice(0, 4)}-01-01`;
      break;
    case 'all':
      startDate = '';
      break;
    case 'custom':
      startDate = selections.customStart;
      endDate = selections.customEnd || endDate;
      break;
  }
  return { startDate, endDate };
}

export interface AnalyticsPageState {
  selections: AnalyticsSelections;
  update: (patch: Partial<AnalyticsSelections>) => void;
  filters: AnalyticsFilters;
  /** Month axis for the resolved period; needs the earliest data month for 'all'. */
  monthsFor: (earliestMonthKey: string | null) => string[];
}

export function useAnalyticsPageState(): AnalyticsPageState {
  const [selections, setSelections] = useState<AnalyticsSelections>(DEFAULT_SELECTIONS);
  const todayISO = getTodayISO();

  const update = useCallback((patch: Partial<AnalyticsSelections>) => {
    setSelections((current) => ({ ...current, ...patch }));
  }, []);

  const { startDate, endDate } = resolvePeriod(selections, todayISO);

  const filters = useMemo<AnalyticsFilters>(
    () => ({
      startDate,
      endDate,
      accountIds: selections.accountIds,
      categoryIds: selections.categoryIds,
      payees: selections.payees,
      labelIds: selections.labelIds,
    }),
    [
      startDate,
      endDate,
      selections.accountIds,
      selections.categoryIds,
      selections.payees,
      selections.labelIds,
    ]
  );

  const monthsFor = useCallback(
    (earliestMonthKey: string | null) => {
      const effectiveStart = startDate || (earliestMonthKey ? `${earliestMonthKey}-01` : endDate);
      return monthKeysInRange(effectiveStart, endDate);
    },
    [startDate, endDate]
  );

  return { selections, update, filters, monthsFor };
}
