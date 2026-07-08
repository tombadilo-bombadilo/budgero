import type { MilliUnits } from '../../money/index.js';

export type RecurringDirection = 'inflow' | 'outflow';

export type RecurringIntervalUnit = 'day' | 'week' | 'month' | 'year';

export interface RecurringSchedule {
  startDate: string;
  intervalUnit: RecurringIntervalUnit;
  intervalCount?: number; // defaults to 1
  endDate?: string | null;
  metadata?: {
    anchorDay?: number;
    anchorMonth?: number;
    weekday?: number;
    weekdays?: number[];
  };
}

export interface RecurringTransaction {
  id: number;
  budgetId: number;
  accountId: number;
  categoryId: number | null;
  name: string;
  memo: string;
  amount: MilliUnits;
  direction: RecurringDirection;
  schedule: RecurringSchedule;
  notifyDaysBefore: number;
  lastOccurrenceDate: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateRecurringTransactionInput {
  budgetId: number;
  accountId: number;
  categoryId?: number | null;
  name: string;
  memo?: string;
  amount: MilliUnits;
  direction: RecurringDirection;
  schedule: RecurringSchedule;
  notifyDaysBefore?: number;
  active?: boolean;
}

export interface UpdateRecurringTransactionInput {
  accountId?: number;
  categoryId?: number | null;
  name?: string;
  memo?: string;
  amount?: MilliUnits;
  direction?: RecurringDirection;
  schedule?: RecurringSchedule;
  notifyDaysBefore?: number;
  active?: boolean;
}

export type RecurringOccurrenceStatus = 'scheduled' | 'ready' | 'skipped';

export interface RecurringOccurrence {
  id: number;
  recurringTransactionId: number;
  budgetId: number;
  dueDate: string;
  status: RecurringOccurrenceStatus;
  transactionId: number | null;
  notifiedAt: string | null;
  readyAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RecurringOccurrenceWithTemplate extends RecurringOccurrence {
  template: RecurringTransaction;
}

export interface MarkOccurrenceReadyResult {
  occurrence: RecurringOccurrenceWithTemplate;
  transactionId: number;
}

export interface MarkOccurrenceReadyOptions {
  occurrenceId: number;
  transactionDate?: string;
  memoOverride?: string;
}

export interface ListOccurrencesOptions {
  status?: RecurringOccurrenceStatus | RecurringOccurrenceStatus[];
  fromDate?: string;
  toDate?: string;
  accountId?: number;
}

export interface ListProjectedTransactionsOptions {
  fromDate?: string;
  toDate?: string;
  accountId?: number;
}

/**
 * A scheduled (not yet ready) recurring occurrence projected into a
 * transaction-like shape so read surfaces (account register, reporting)
 * can treat it as if it were already posted. Synthetic ID is the negated
 * occurrence ID so it can never collide with a real transaction.
 */
export interface ProjectedTransactionRow {
  ID: number;
  OccurrenceID: number;
  RecurringTransactionID: number;
  AccountID: number;
  Account: string;
  BudgetID: number;
  CategoryID: number | null;
  Category: string | null;
  Date: string;
  Memo: string;
  Payee: string;
  /** Budget-currency amounts (converted with the latest known rate) */
  Inflow: MilliUnits;
  Outflow: MilliUnits;
  /** Account-currency amounts (the template amount) */
  InflowOriginal: MilliUnits;
  OutflowOriginal: MilliUnits;
  IsProjected: true;
}
