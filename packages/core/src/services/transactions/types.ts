/**
 * Transactions service type definitions
 * These types use PascalCase for API consistency
 */

import type { MilliUnits } from '../../money/index.js';

/**
 * Transaction type - represents a financial transaction
 */
export interface Transaction {
  ID: number;
  CategoryID: number;
  AccountID: number;
  LabelID?: number | null;
  TransferID?: string;
  Date: string;
  Month: string;
  Memo: string;
  Reconciled: boolean;
  /** Seen in the bank; always true when Reconciled. Absent when the source query omits status. */
  Cleared?: boolean;
  InflowConverted: MilliUnits;
  OutflowConverted: MilliUnits;
  InflowNative?: MilliUnits;
  OutflowNative?: MilliUnits;
  ExchangeRate?: number | null;
  ExchangeRateOverride?: boolean;
  AccountOnBudget?: boolean;
  TransferAccountOnBudget?: boolean | null;
  /** The other leg's account, for transfers. */
  TransferAccountName?: string | null;
  RunningBalanceConverted: MilliUnits;
  RunningBalanceNative?: MilliUnits;
  BudgetID: number;
  // Additional fields from Wails version
  Amount?: MilliUnits;
  Payee?: string;
  TransferAccountID?: string;
  Label?: string | null;
  LabelColor?: string | null;
  AccountName?: string;
  CategoryName?: string;
  Subtransactions?: TransactionSplit[];
}

/**
 * Transaction view types for different queries
 */
export interface GetTransactionsByAccountRow {
  ID: number;
  Date: string;
  CategoryID: number;
  Category: string;
  LabelID?: number | null;
  Label?: string | null;
  LabelColor?: string | null;
  Memo: string;
  Reconciled: boolean;
  /** Seen in the bank; always true when Reconciled. Absent when the source query omits status. */
  Cleared?: boolean;
  InflowConverted: MilliUnits;
  OutflowConverted: MilliUnits;
  InflowNative?: MilliUnits;
  OutflowNative?: MilliUnits;
  ExchangeRate?: number | null;
  ExchangeRateOverride?: boolean;
  AccountOnBudget?: boolean;
  TransferAccountOnBudget?: boolean | null;
  /** The other leg's account, for transfers. */
  TransferAccountName?: string | null;
  RunningBalanceConverted: MilliUnits | null;
  RunningBalanceNative?: MilliUnits | null;
  TransferID?: string;
  /** Only populated by budget-wide queries (getAllTransactionsDetailed) */
  AccountID?: number;
  Account?: string;
  Payee?: string;
  /** True for scheduled recurring occurrences shown as non-editable projected rows */
  IsProjected?: boolean;
  /** Projected rows: the recurring occurrence to mark ready or skip */
  OccurrenceID?: number;
  /** Projected rows, or posted rows created from a recurring template */
  RecurringTransactionID?: number;
  /** True when the running balance includes projected rows and is an estimate */
  RunningBalanceProjected?: boolean;
}

/** Stable keyset used to continue an account register ordered by Date/ID descending. */
export interface AccountTransactionCursor {
  Date: string;
  ID: number;
}

export interface AccountTransactionPageOptions {
  limit?: number;
  cursor?: AccountTransactionCursor | null;
  fromDate?: string;
  toDate?: string;
}

export interface AccountTransactionPage {
  rows: GetTransactionsByAccountRow[];
  nextCursor: AccountTransactionCursor | null;
}

/** An existing transaction that may be the same real-world payment as a new entry. */
export interface SimilarTransaction {
  ID: number;
  Date: string;
  Payee: string;
  Memo: string;
  /** Signed native amount (inflow - outflow), in the account currency's scale. */
  AmountNative: number;
}

/** Settings for the possible-duplicate hint shown while adding transactions. */
export interface DuplicateHintSettings {
  enabled: boolean;
  /** Amount tolerance in basis points (100 = 1%); never tighter than 0.01. */
  toleranceBps: number;
  /** Days either side of the entered date to search. */
  dayWindow: number;
}

export interface SimilarTransactionQuery {
  accountId: number;
  /** yyyy-MM-dd */
  date: string;
  /** Signed native amount (inflow - outflow) of the transaction being entered. */
  amountNative: number;
  /** Days either side of `date` to search. Defaults to 7. */
  dayWindow?: number;
  /** Amount tolerance in basis points (100 = 1%). Defaults to 100. */
  toleranceBps?: number;
  limit?: number;
}

/** Aggregate values needed by the account register without materializing every row. */
export interface AccountTransactionSummary {
  TransactionCount: number;
  TransferTransactionCount: number;
  UncategorizedCount: number;
  UnclearedCount: number;
  UnsafeTransactionCount: number;
  TotalInflowConverted: MilliUnits;
  TotalOutflowConverted: MilliUnits;
  TotalInflowNative: MilliUnits;
  TotalOutflowNative: MilliUnits;
}

/** Per-account totals of future-dated rows (Date after a cutoff). */
export interface AccountFutureBalanceAdjustment {
  AccountID: number;
  /** Account-currency delta: inflow - outflow, native amounts falling back to converted. */
  Original: MilliUnits;
  /** Budget-currency delta: converted inflow - converted outflow. */
  Converted: MilliUnits;
}

/** Uncategorized (non-split) transaction count for one account. */
export interface AccountUncategorizedCount {
  AccountID: number;
  Count: number;
}

export interface AccountBalanceHistoryTransaction {
  Date: string;
  InflowConverted: MilliUnits;
  OutflowConverted: MilliUnits;
}

export interface GetTransactionsByAccountAndMonthRow {
  ID: number;
  Date: string;
  CategoryID?: number;
  Category: string;
  LabelID?: number | null;
  Label?: string | null;
  LabelColor?: string | null;
  Memo: string;
  Reconciled: boolean;
  /** Seen in the bank; always true when Reconciled. Absent when the source query omits status. */
  Cleared?: boolean;
  InflowConverted: MilliUnits;
  OutflowConverted: MilliUnits;
  InflowNative?: MilliUnits;
  OutflowNative?: MilliUnits;
  ExchangeRate?: number | null;
  ExchangeRateOverride?: boolean;
  AccountOnBudget?: boolean;
  TransferAccountOnBudget?: boolean | null;
  /** The other leg's account, for transfers. */
  TransferAccountName?: string | null;
  RunningBalanceConverted: MilliUnits | null;
  RunningBalanceNative?: MilliUnits | null;
  TransferID?: string;
  Account?: string;
  Payee?: string;
}

export interface GetAllTransactions {
  ID: number;
  AccountId: number;
  AccountName: string;
  Date: string;
  CategoryID: number;
  Category: string;
  LabelID?: number | null;
  Label?: string | null;
  LabelColor?: string | null;
  Memo: string;
  InflowConverted: MilliUnits;
  OutflowConverted: MilliUnits;
  RunningBalanceConverted: MilliUnits;
  TransferID?: string;
  Payee?: string;
}

export interface GetTransactionsByCategoryAndMonthRow {
  ID: number;
  Date: string;
  Memo: string;
  LabelID?: number | null;
  Label?: string | null;
  LabelColor?: string | null;
  InflowConverted: MilliUnits;
  OutflowConverted: MilliUnits;
  RunningBalanceConverted: MilliUnits | null;
  AccountID: number;
  Account: string;
  Category: string;
  CategoryID: number | null;
  Payee?: string;
  ExchangeRate?: number | null;
  ExchangeRateOverride?: boolean;
}

/**
 * TransactionSplit type - represents a split transaction line
 * Updated to use PascalCase to match database schema
 */
export interface TransactionSplit {
  ID: number;
  TransactionID: number;
  CategoryID?: number | null;
  TransferAccountID?: number | null;
  Memo: string;
  /** Empty means inherit the parent transaction payee. */
  Payee?: string;
  InflowConverted: MilliUnits;
  OutflowConverted: MilliUnits;
  InflowNative?: MilliUnits | null;
  OutflowNative?: MilliUnits | null;
  PairID?: string | null;
  OrderIndex: number;
  CategoryName?: string;
  TransferAccountName?: string;
}

export interface PayeeListItem {
  Name: string;
  UsageCount: number;
  Source: 'saved' | 'transaction' | 'both';
}

/** The category a payee was last filed under, with the date it came from. */
export interface PayeeCategoryMemory {
  CategoryID: number;
  CategoryName: string;
  Date: string;
}

export interface LabelListItem {
  ID: number;
  Name: string;
  Color: string;
  UsageCount: number;
}

/** How transactions that share a date are ordered in the register. */
export type SameDayTransactionOrder = 'newest' | 'amount';

/**
 * One aggregated ledger row for balance-history charts: the net
 * (inflow - outflow, budget currency) of every transaction in the group.
 * Rows before the window collapse to one row per account dated at its first
 * transaction; rows in the window are grouped per day or per month.
 */
export interface BalanceHistoryRow {
  AccountId: number;
  Date: string;
  Net: MilliUnits;
}

/** How {@link BalanceHistoryRow}s inside the window are grouped. */
export type BalanceHistoryBucket = 'day' | 'month';
