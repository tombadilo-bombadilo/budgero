import type { MessageDescriptor } from '@lingui/core';
import { msg, t, plural } from '@lingui/core/macro';
import { format } from 'date-fns';
import type { MilliUnits, RecurringSchedule } from '@budgero/core/browser';
import type { TransactionFormInitialValues } from '@features/transactions/api/useTransactionForm';

export type RecurringEndMode = 'never' | 'date' | 'count';

export interface RecurringFormSettings {
  frequency: string;
  endMode: RecurringEndMode;
  endDate: string;
  occurrenceCount: string;
  notifyDaysBefore: string;
  active: boolean;
}

export interface RecurringTransactionFormInitialValues {
  name?: string;
  memo?: string;
  amount?: MilliUnits;
  direction?: 'inflow' | 'outflow';
  accountId?: number | null;
  toAccountId?: number | null;
  /** Display name only; categoryId decides which category is meant. */
  categoryName?: string;
  categoryId?: number | null;
  schedule?: RecurringSchedule;
  notifyDaysBefore?: number;
  active?: boolean;
}

export interface RecurringTransactionFormSubmit {
  name: string;
  memo: string;
  amount: MilliUnits;
  direction: 'inflow' | 'outflow';
  accountId: number | null;
  toAccountId: number | null;
  categoryId: number | null;
  schedule: RecurringSchedule;
  notifyDaysBefore: number;
  active: boolean;
}

export const FREQUENCY_OPTIONS: { value: string; label: MessageDescriptor }[] = [
  { value: 'day:1', label: msg`Daily` },
  { value: 'week:1', label: msg`Weekly` },
  { value: 'week:2', label: msg`Every 2 weeks` },
  { value: 'month:1', label: msg`Monthly` },
  { value: 'month:2', label: msg`Every 2 months` },
  { value: 'month:3', label: msg`Quarterly` },
  { value: 'month:6', label: msg`Every 6 months` },
  { value: 'year:1', label: msg`Yearly` },
];

export function dateKeyToLocalDate(value?: string | null): Date | null {
  if (!value) return null;
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return null;
  const date = new Date(year, month - 1, day);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function scheduleToFrequency(schedule: RecurringSchedule): string {
  return `${schedule.intervalUnit}:${schedule.intervalCount ?? 1}`;
}

export function frequencyOptionsFor(value: string): { value: string; label: string }[] {
  const options = FREQUENCY_OPTIONS.map((option) => ({ ...option, label: t(option.label) }));
  if (options.some((option) => option.value === value)) return options;
  const [unit, countRaw] = value.split(':');
  const count = Math.max(1, Number(countRaw || '1'));
  const label =
    unit === 'day'
      ? plural(count, { one: 'Every # day', other: 'Every # days' })
      : unit === 'week'
        ? plural(count, { one: 'Every # week', other: 'Every # weeks' })
        : unit === 'month'
          ? plural(count, { one: 'Every # month', other: 'Every # months' })
          : plural(count, { one: 'Every # year', other: 'Every # years' });
  return [...options, { value, label }];
}

export function createRecurringFormSettings(
  initial?: RecurringTransactionFormInitialValues
): RecurringFormSettings {
  const schedule = initial?.schedule;
  return {
    frequency: schedule ? scheduleToFrequency(schedule) : 'month:1',
    endMode: schedule?.occurrenceCount ? 'count' : schedule?.endDate ? 'date' : 'never',
    endDate: schedule?.endDate ?? '',
    occurrenceCount: schedule?.occurrenceCount ? String(schedule.occurrenceCount) : '',
    notifyDaysBefore: String(initial?.notifyDaysBefore ?? 0),
    active: initial?.active ?? true,
  };
}

export function recurringInitialToTransactionValues(
  initial?: RecurringTransactionFormInitialValues
): TransactionFormInitialValues | undefined {
  if (!initial) return undefined;
  return {
    transactionType: initial.toAccountId != null ? 'transfer' : (initial.direction ?? 'outflow'),
    transactionDate: dateKeyToLocalDate(initial.schedule?.startDate) ?? new Date(),
    selectedCategory: initial.categoryName ?? '',
    selectedCategoryId: initial.categoryName ? (initial.categoryId ?? null) : null,
    memo: initial.memo ?? '',
    payee: initial.name ?? '',
    amount: initial.amount ?? null,
    selectedFromAccount: initial.accountId != null ? String(initial.accountId) : '',
    selectedToAccount: initial.toAccountId != null ? String(initial.toAccountId) : '',
    rememberLast: false,
  };
}

export function buildRecurringSchedule(
  firstOccurrence: Date | null,
  settings: RecurringFormSettings
): RecurringSchedule {
  const [unit, countRaw] = settings.frequency.split(':');
  const occurrenceCount = Math.trunc(Number(settings.occurrenceCount));
  return {
    startDate: format(firstOccurrence ?? new Date(), 'yyyy-MM-dd'),
    intervalUnit: (unit as RecurringSchedule['intervalUnit']) || 'month',
    intervalCount: Math.max(1, Number(countRaw || '1')),
    endDate: settings.endMode === 'date' && settings.endDate ? settings.endDate : null,
    occurrenceCount: settings.endMode === 'count' && occurrenceCount > 0 ? occurrenceCount : null,
  };
}

export function isRecurringEndConditionValid(settings: RecurringFormSettings): boolean {
  return (
    settings.endMode === 'never' ||
    (settings.endMode === 'date' && Boolean(settings.endDate)) ||
    (settings.endMode === 'count' && Math.trunc(Number(settings.occurrenceCount)) > 0)
  );
}
