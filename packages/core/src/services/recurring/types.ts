import type { RawRow } from '../../database/restore-rows.js';
import type { MilliUnits } from '../../money/index.js';

export type RecurringDirection = 'inflow' | 'outflow';

export type RecurringIntervalUnit = 'day' | 'week' | 'month' | 'year';

export interface RecurringSchedule {
  startDate: string;
  intervalUnit: RecurringIntervalUnit;
  intervalCount?: number; // defaults to 1
  /** Last day an occurrence may fall on (inclusive). Null/undefined = no end date. */
  endDate?: string | null;
  /**
   * Total number of occurrences in the series, counted from startDate and
   * including posted/skipped ones. Null/undefined = unlimited. May be
   * combined with endDate; whichever ends the series first wins.
   */
  occurrenceCount?: number | null;
  metadata?: {
    anchorDay?: number;
    anchorMonth?: number;
    weekday?: number;
    weekdays?: number[];
  };
}

/**
 * One split line of a recurring template, in the template account's currency
 * (like the add form's split lines). Exactly one of categoryId and
 * transferAccountId is set; a transfer line posts a mirror row there.
 */
export interface RecurringSplitLine {
  categoryId: number | null;
  transferAccountId: number | null;
  memo: string;
  /** Empty means inherit the posted transaction's payee (the template name). */
  payee: string;
  inflow: MilliUnits;
  outflow: MilliUnits;
}

export interface RecurringTransaction {
  id: number;
  budgetId: number;
  accountId: number;
  /**
   * Destination account for recurring transfers. When set, the template is a
   * transfer: `direction` is always 'outflow' (money leaves `accountId`) and
   * marking an occurrence ready posts two paired legs sharing a TransferID.
   */
  toAccountId: number | null;
  /**
   * For transfers, `amount` converted into the destination account's currency
   * at the effective rate for the occurrence date (custom, then official;
   * 1:1 when unknown or currencies match). Only
   * populated by occurrence queries; null elsewhere and for non-transfers.
   */
  destinationAmount?: MilliUnits | null;
  /**
   * The native amount converted into the budget display currency at the
   * occurrence date's effective rate (custom, then official; latest known for
   * future dates). Only populated by occurrence queries; null elsewhere.
   */
  budgetAmount?: MilliUnits | null;
  categoryId: number | null;
  /**
   * Split lines posted with every occurrence (categoryId is then null). They
   * sum to the signed amount; never set on transfer templates.
   */
  splits: RecurringSplitLine[] | null;
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
  /** Only passed by undo/redo, to recreate a template under its original ID. */
  id?: number;
  budgetId: number;
  accountId: number;
  toAccountId?: number | null;
  categoryId?: number | null;
  /** Null or [] means no splits. */
  splits?: RecurringSplitLine[] | null;
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
  toAccountId?: number | null;
  categoryId?: number | null;
  /** Null or [] clears the splits; omitted keeps them. */
  splits?: RecurringSplitLine[] | null;
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
  /** Transfer templates: the destination leg and the transfer's TransferID. */
  destinationTransactionId?: number;
  transferId?: string;
  /** Split templates: the mirror rows of the transfer lines, in line order. */
  mirrorTransactionIds?: number[];
}

/**
 * Identifies one occurrence. Occurrence rows are materialized locally (read
 * paths insert them), so their IDs differ between devices; synced ops must
 * carry the stable (recurringTransactionId, dueDate) key, which wins over
 * occurrenceId when present. occurrenceId alone is the legacy form.
 */
export interface RecurringOccurrenceRef {
  occurrenceId?: number;
  recurringTransactionId?: number;
  dueDate?: string;
}

export interface MarkOccurrenceReadyOptions extends RecurringOccurrenceRef {
  transactionDate?: string;
  memoOverride?: string;
  /**
   * Payee of the posted row (the app sends the template's name, #127). Ops
   * carry it so every device writes the same payee and payee-list entry; ops
   * logged before it existed have none and post without a payee, as they
   * always did. Not used by transfer templates (their legs name the accounts).
   */
  payee?: string;
  /** TransferID for a transfer template's two legs. Ops carry it so every
   * device posts the same one; generated when absent (older ops). */
  transferId?: string;
  /**
   * Redo re-posts under the IDs (and TransferID) the first run produced, so
   * the undo entry that deletes them stays valid.
   */
  reuse?: {
    transactionId: number;
    destinationTransactionId?: number;
    transferId?: string;
    /** Split templates: the transfer lines' mirror rows (redo, format 5). */
    mirrorTransactionIds?: number[];
  };
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
  /** Budget-currency amounts (effective custom/official rate; latest known for future dates) */
  InflowConverted: MilliUnits;
  OutflowConverted: MilliUnits;
  /** Account-currency amounts (the template amount) */
  InflowNative: MilliUnits;
  OutflowNative: MilliUnits;
  IsProjected: true;
}

/** Verbatim rows of a template and its occurrences, for a delete undo. */
export interface RecurringTemplateSnapshot {
  template: RawRow;
  occurrences: RawRow[];
}
