/**
 * Op Code Registry - Maps mutation op codes to API methods
 *
 * This registry is used by the MutationManager to apply mutations
 * using the same API methods for both local and remote mutations.
 * Each op code maps 1:1 with a mutation hook.
 */

import { getRuntime } from '@shared/runtime/global';
import { type MilliUnits, ChartConfiguration } from '@budgero/core/browser';

/**
 * Split transaction entry shape (normalized to PascalCase)
 */
export interface NormalizedSplit {
  CategoryID: number | null;
  TransferAccountID: number | null;
  Memo: string;
  Inflow: MilliUnits;
  Outflow: MilliUnits;
  InflowOriginal: MilliUnits | null;
  OutflowOriginal: MilliUnits | null;
  PairID: string | null;
  OrderIndex: number;
}

/** Category type for local type safety (mirrors core Category) */
export interface CategoryRow {
  ID: number;
  Name: string;
  Note: string;
  CategoryGroupID: number;
  BudgetID: number;
  ExcludeFromBudgetPace?: boolean;
}

/** Transaction snapshot captured for undo/redo operations (supports multiple naming conventions) */
export interface TransactionSnapshot {
  ID?: number;
  Date?: string;
  date?: string;
  Memo?: string;
  memo?: string;
  Payee?: string;
  payee?: string;
  Inflow?: number;
  inflow?: number;
  Outflow?: number;
  outflow?: number;
  InflowOriginal?: number;
  inflowOriginal?: number;
  OutflowOriginal?: number;
  outflowOriginal?: number;
  CategoryID?: number;
  LabelID?: number | null;
  category_id?: number;
  categoryId?: number;
  label_id?: number | null;
  labelId?: number | null;
  AccountID?: number;
  account_id?: number;
  accountId?: number;
  BudgetID?: number;
  budget_id?: number;
  budgetId?: number;
  TransferID?: string;
  transfer_id?: string;
  transferId?: string;
  ReconciledAt?: string | null;
}

export type OpCall = { op: string; args: Record<string, unknown> };

/** Transaction row type for dynamic column access */
export interface TransactionRowWithColumns {
  ID: number;
  Date: string;
  Memo: string;
  Inflow: number;
  Outflow: number;
  CategoryID: number;
  AccountID: number;
  InflowOriginal?: number;
  OutflowOriginal?: number;
  TransferID?: string;
  ReconciledAt?: string | null;
  LabelID?: number | null;
  payee?: string;
  [key: string]: unknown;
}

export function sortTransactionSnapshots(snapshots: TransactionSnapshot[]): TransactionSnapshot[] {
  return [...snapshots].sort((a, b) => {
    const d = (a.Date || '').localeCompare(b.Date || '');
    return d !== 0 ? d : (a.ID || 0) - (b.ID || 0);
  });
}

export function transactionSnapshotToAddOp(snapshot: TransactionSnapshot): OpCall {
  return {
    op: 'transactions.add',
    args: {
      inflow:
        snapshot.InflowOriginal ??
        snapshot.inflowOriginal ??
        snapshot.Inflow ??
        snapshot.inflow ??
        0,
      outflow:
        snapshot.OutflowOriginal ??
        snapshot.outflowOriginal ??
        snapshot.Outflow ??
        snapshot.outflow ??
        0,
      accountId: snapshot.AccountID ?? snapshot.account_id ?? snapshot.accountId,
      categoryId: snapshot.CategoryID ?? snapshot.category_id ?? snapshot.categoryId,
      labelId: snapshot.LabelID ?? snapshot.label_id ?? snapshot.labelId ?? null,
      budgetId: snapshot.BudgetID ?? snapshot.budget_id ?? snapshot.budgetId,
      date: snapshot.Date ?? snapshot.date,
      memo: snapshot.Memo ?? snapshot.memo ?? '',
      payee: snapshot.Payee ?? snapshot.payee ?? '',
      transferId: snapshot.TransferID ?? snapshot.transfer_id ?? snapshot.transferId ?? undefined,
    },
  };
}

// Local service accessors to avoid db-ops indirection

export const S = () => getRuntime()!.services();

/** Extended monthly budget service interface for optional methods */
export interface ExtendedMonthlyBudgetService {
  reassignAssignment?: (newCategoryId: number, oldCategoryId: number) => void | Promise<void>;
  getMonthlyAssignmentValue?: (
    categoryId: number,
    month: string,
    budgetId: number
  ) => number | Promise<number>;
  batchUpsertMonthlyAssignments?: (
    assignments: { categoryId: number; amount: number; month: string; budgetId: number }[]
  ) => void | Promise<void>;
}

/** Monthly budget row shape for fallback parsing */
export interface MonthlyBudgetRow {
  CategoryID?: number;
  category_id?: number;
  categoryId?: number;
  Assigned?: number;
  assigned?: number;
  assigned_amount?: number;
}

export const RULE_INVALIDATION_KEYS: string[][] = [
  ['rules'],
  ['rules', '*'],
  ['ruleRuns'],
  ['ruleRuns', '*'],
  ['ruleRunChanges'],
  ['ruleRunChanges', '*'],
];

export const TRANSACTION_INVALIDATION_KEYS: string[][] = [
  ['transactions', '*'],
  ['transactionsByCategoryAndMonth', '*'],
  ['allTransactions', '*'],
  ['allTransactionsDetailed', '*'],
  ['uncategorizedTransactions', '*'],
  ['allAccountsMonthlyTransactions', '*'],
  ['monthlyTransactions', '*'],
  ['accounts', '*'],
  ['monthlyBudget', '*'],
  ['readyToAssign', '*'],
  ['monthlySpending', '*'],
  ['monthlyBalance', '*'],
  ['spendingByDates', '*'],
  ['spendingByDatesByCategories', '*'],
  ['spendingByCategoriesInGroup', '*'],
  ['balanceByDates', '*'],
  ['analyticsPeriodSummary', '*'],
  ['topSpendingCategories', '*'],
  ['incomeExpenseByPeriod', '*'],
  ['onBudgetBalance'],
  ['onBudgetBalanceByDates'],
  ['payees'],
  ['payees', '*'],
  ['payeeDirectory'],
  ['payeeDirectory', '*'],
  ['labels'],
  ['labels', '*'],
  ['labelDirectory'],
  ['labelDirectory', '*'],
  ['spendingByLabels', '*'],
];

export const RULE_EXECUTE_TX_INVALIDATIONS: string[][] = [
  ['transactions'],
  ...TRANSACTION_INVALIDATION_KEYS,
  ['analyticsPeriodSummary'],
  ['topSpendingCategories'],
  ['incomeExpenseByPeriod'],
];

export const RECURRING_TEMPLATE_INVALIDATIONS: string[][] = [
  ['recurringTemplates'],
  ['recurringTemplates', '*'],
];

export const RECURRING_OCCURRENCE_INVALIDATIONS: string[][] = [
  ['recurringOccurrences'],
  ['recurringOccurrences', '*'],
];

export type ReportChart = ChartConfiguration;
export type NewReportChart = Omit<ChartConfiguration, 'id'>;

export interface OpCodeEntry {
  execute: (args: Record<string, unknown>) => Promise<unknown>;
  // Query keys to invalidate (for remote mutations)
  invalidates: string[][];
  undo?: {
    // Capture any before-state needed to build inverse ops
    capture?: (args: Record<string, unknown>) => Promise<unknown>;
    // Build inverse operations to undo this mutation
    build: (args: Record<string, unknown>, result: unknown, before: unknown) => OpCall[];
  };
  // Optional redo customization (defaults to re-applying the original op)
  redo?: {
    build: (args: Record<string, unknown>, result: unknown, before: unknown) => OpCall[];
  };
}

/** Run an undo-capture snapshot, returning null when it throws. */
export async function safeCapture<T>(fn: () => T | Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch {
    return null;
  }
}

/**
 * Undo config for self-restoring ops: snapshot the current values, bail when
 * the snapshot is missing or any captured field is falsy, and re-issue the
 * same op with the old values. Only for truthy-bail self-restore ops — ops
 * whose snapshots may legitimately hold falsy values (e.g. booleans, zero
 * amounts) need bespoke undo blocks.
 */
export function makeRestoreUndo<S extends Record<string, unknown>>(
  op: string,
  captureFn: (args: Record<string, unknown>) => S | Promise<S>,
  restoreArgs: (args: Record<string, unknown>, snapshot: S) => Record<string, unknown>
): NonNullable<OpCodeEntry['undo']> {
  return {
    capture: async (args) => safeCapture(() => captureFn(args)),
    build: (args, _result, before) => {
      const snapshot = before as S | null | undefined;
      if (!snapshot || Object.values(snapshot).some((value) => !value)) return [];
      return [{ op, args: restoreArgs(args, snapshot) }];
    },
  };
}
