import { msg } from '@lingui/core/macro';
import type { MessageDescriptor } from '@lingui/core';
import { useCallback, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { isValidIsoDate } from '@features/reports/lib/question';
import { getTodayISO } from '@shared/lib/date-utils';
import { useUiStore } from '@shared/store/useUiStore';
import { monthKeysInRange, shiftMonthKey, type AnalyticsFilters } from './analytics-model';

export type ReportKey =
  'wealth' | 'spending' | 'in-out' | 'money-map' | 'plan' | 'scenario' | 'ledger';

export type PeriodKey = 'mtd' | '3m' | '6m' | '12m' | '24m' | 'ytd' | 'all' | 'custom';

export const PERIOD_LABELS: Record<PeriodKey, MessageDescriptor> = {
  mtd: msg`Month to date`,
  '3m': msg`Last 3 months`,
  '6m': msg`Last 6 months`,
  '12m': msg`Last 12 months`,
  '24m': msg`Last 24 months`,
  ytd: msg`Year to date`,
  all: msg`All time`,
  custom: msg`Custom range`,
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
    case 'mtd':
      startDate = `${currentMonth}-01`;
      endDate = todayISO;
      break;
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

/**
 * Query-string names of the selections. Short on purpose: the URL is what a
 * reload (or a shared link) restores the filters from.
 */
export const SELECTION_PARAMS = {
  period: 'p',
  customStart: 's',
  customEnd: 'e',
  accountIds: 'a',
  categoryIds: 'c',
  payees: 'py',
  labelIds: 'l',
} as const satisfies Record<keyof AnalyticsSelections, string>;

const MAX_IDS = 500;
const MAX_PAYEES = 200;

const PERIOD_KEYS = Object.keys(PERIOD_LABELS) as PeriodKey[];

const isPeriodKey = (value: string | null): value is PeriodKey =>
  value !== null && (PERIOD_KEYS as readonly string[]).includes(value);

function parseIds(raw: string | null): number[] {
  if (!raw) return [];
  const ids = new Set<number>();
  for (const part of raw.split(',')) {
    if (!/^\d{1,15}$/.test(part)) continue;
    const id = Number(part);
    if (id > 0) ids.add(id);
    if (ids.size >= MAX_IDS) break;
  }
  return Array.from(ids);
}

const parseDate = (raw: string | null): string => (isValidIsoDate(raw) ? raw : '');

/** True when the query string carries any report filter. */
export function hasSelectionParams(params: URLSearchParams): boolean {
  return Object.values(SELECTION_PARAMS).some((name) => params.has(name));
}

/** Selections from a query string; anything missing or malformed is the default. */
export function parseSelections(params: URLSearchParams): AnalyticsSelections {
  const period = params.get(SELECTION_PARAMS.period);
  let customStart = parseDate(params.get(SELECTION_PARAMS.customStart));
  let customEnd = parseDate(params.get(SELECTION_PARAMS.customEnd));
  if (customStart && customEnd && customStart > customEnd) {
    [customStart, customEnd] = [customEnd, customStart];
  }
  const payees = Array.from(
    new Set(params.getAll(SELECTION_PARAMS.payees).filter((name) => name.trim() !== ''))
  ).slice(0, MAX_PAYEES);
  return {
    period: isPeriodKey(period) ? period : DEFAULT_SELECTIONS.period,
    customStart,
    customEnd,
    accountIds: parseIds(params.get(SELECTION_PARAMS.accountIds)),
    categoryIds: parseIds(params.get(SELECTION_PARAMS.categoryIds)),
    payees,
    labelIds: parseIds(params.get(SELECTION_PARAMS.labelIds)),
  };
}

/**
 * The query string for these selections: defaults are left out, and params
 * of `base` that are not report filters are kept.
 */
export function serializeSelections(
  selections: AnalyticsSelections,
  base?: URLSearchParams
): URLSearchParams {
  const params = new URLSearchParams(base);
  for (const name of Object.values(SELECTION_PARAMS)) params.delete(name);
  if (selections.period !== DEFAULT_SELECTIONS.period) {
    params.set(SELECTION_PARAMS.period, selections.period);
  }
  if (selections.customStart) params.set(SELECTION_PARAMS.customStart, selections.customStart);
  if (selections.customEnd) params.set(SELECTION_PARAMS.customEnd, selections.customEnd);
  const setIds = (name: string, ids: number[]) => {
    if (ids.length > 0) params.set(name, ids.join(','));
  };
  setIds(SELECTION_PARAMS.accountIds, selections.accountIds);
  setIds(SELECTION_PARAMS.categoryIds, selections.categoryIds);
  // Payee names can hold commas, so each one is its own param.
  for (const payee of selections.payees) params.append(SELECTION_PARAMS.payees, payee);
  setIds(SELECTION_PARAMS.labelIds, selections.labelIds);
  return params;
}

/**
 * The last selections of this tab, per budget. Links between prebuilt reports
 * carry no query string, so a report opened without one starts from these.
 */
let remembered: { budgetId: number; selections: AnalyticsSelections } | null = null;

function rememberSelections(budgetId: number, selections: AnalyticsSelections): void {
  const isDefault = serializeSelections(selections).toString() === '';
  remembered = isDefault ? null : { budgetId, selections };
}

function recallSelections(budgetId: number): AnalyticsSelections | null {
  return remembered?.budgetId === budgetId ? remembered.selections : null;
}

/** For tests. */
export function forgetRememberedSelections(): void {
  remembered = null;
}

export interface AnalyticsPageState {
  selections: AnalyticsSelections;
  update: (patch: Partial<AnalyticsSelections>) => void;
  filters: AnalyticsFilters;
  /** Month axis for the resolved period; needs the earliest data month for 'all'. */
  monthsFor: (earliestMonthKey: string | null) => string[];
}

/**
 * Filter state of a prebuilt report. It lives in the query string (so it
 * survives a reload) and is remembered for the tab (so it follows the user
 * from one prebuilt report to the next). Needs a router above it.
 */
export function useAnalyticsPageState(): AnalyticsPageState {
  const [searchParams, setSearchParams] = useSearchParams();
  const budgetId = useUiStore((state) => state.selectedBudget?.ID ?? 0);
  const todayISO = getTodayISO();

  const query = serializeSelections(parseSelections(searchParams)).toString();
  const inUrl = hasSelectionParams(searchParams);
  const selections = useMemo<AnalyticsSelections>(
    () =>
      inUrl
        ? parseSelections(new URLSearchParams(query))
        : (recallSelections(budgetId) ?? DEFAULT_SELECTIONS),
    [inUrl, query, budgetId]
  );

  useEffect(() => {
    if (inUrl) {
      rememberSelections(budgetId, selections);
      return;
    }
    // Opened without filters in the URL: put the remembered ones there.
    if (serializeSelections(selections).toString() !== '') {
      setSearchParams((current) => serializeSelections(selections, current), { replace: true });
    }
  }, [inUrl, selections, budgetId, setSearchParams]);

  const update = useCallback(
    (patch: Partial<AnalyticsSelections>) => {
      setSearchParams(
        (current) => {
          const previous = hasSelectionParams(current)
            ? parseSelections(current)
            : (recallSelections(budgetId) ?? DEFAULT_SELECTIONS);
          const next = { ...previous, ...patch };
          rememberSelections(budgetId, next);
          return serializeSelections(next, current);
        },
        { replace: true }
      );
    },
    [budgetId, setSearchParams]
  );

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
