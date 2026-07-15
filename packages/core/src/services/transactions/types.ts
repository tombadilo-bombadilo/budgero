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
  Inflow: MilliUnits;
  Outflow: MilliUnits;
  InflowOriginal?: MilliUnits;
  OutflowOriginal?: MilliUnits;
  ExchangeRate?: number | null;
  ExchangeRateOverride?: boolean;
  RunningBalance: MilliUnits;
  RunningBalanceOriginal?: MilliUnits;
  BudgetID: number;
  // Additional fields from Wails version
  Amount?: MilliUnits;
  Cleared?: string;
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
  Inflow: MilliUnits;
  Outflow: MilliUnits;
  InflowOriginal?: MilliUnits;
  OutflowOriginal?: MilliUnits;
  ExchangeRate?: number | null;
  ExchangeRateOverride?: boolean;
  RunningBalance: MilliUnits | null;
  RunningBalanceOriginal?: MilliUnits | null;
  TransferID?: string;
  /** Only populated by budget-wide queries (getAllTransactionsDetailed) */
  AccountID?: number;
  Account?: string;
  Payee?: string;
  /** True for scheduled recurring occurrences shown as non-editable projected rows */
  IsProjected?: boolean;
  /** True when the running balance includes projected rows and is an estimate */
  RunningBalanceProjected?: boolean;
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
  Inflow: MilliUnits;
  Outflow: MilliUnits;
  InflowOriginal?: MilliUnits;
  OutflowOriginal?: MilliUnits;
  ExchangeRate?: number | null;
  ExchangeRateOverride?: boolean;
  RunningBalance: MilliUnits | null;
  RunningBalanceOriginal?: MilliUnits | null;
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
  Inflow: MilliUnits;
  Outflow: MilliUnits;
  RunningBalance: MilliUnits;
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
  Inflow: MilliUnits;
  Outflow: MilliUnits;
  RunningBalance: MilliUnits | null;
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
  Inflow: MilliUnits;
  Outflow: MilliUnits;
  InflowOriginal?: MilliUnits | null;
  OutflowOriginal?: MilliUnits | null;
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

export interface LabelListItem {
  ID: number;
  Name: string;
  Color: string;
  UsageCount: number;
}
