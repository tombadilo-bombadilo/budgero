/**
 * Op Code Registry - Maps mutation op codes to API methods
 *
 * This registry is used by the MutationManager to apply mutations
 * using the same API methods for both local and remote mutations.
 * Each op code maps 1:1 with a mutation hook.
 */

import { t } from '@lingui/core/macro';
import { getRuntime } from '@shared/runtime/global';
import {
  asMilli,
  isEmptyJournal,
  SPLIT_MIRROR_RATE_MISSING,
  type SplitMirrorAmounts,
  type CategoryCreationMark,
  type ImportIdentity,
  type RowJournal,
  type Services,
  type MilliUnits,
  type ChartConfiguration,
  type SaveReportInput,
} from '@budgero/core/browser';

/**
 * Split transaction entry shape (normalized to PascalCase)
 */
export interface NormalizedSplit {
  CategoryID: number | null;
  TransferAccountID: number | null;
  Memo: string;
  Payee: string;
  InflowConverted: MilliUnits;
  OutflowConverted: MilliUnits;
  InflowNative: MilliUnits | null;
  OutflowNative: MilliUnits | null;
  PairID: string | null;
  OrderIndex: number;
  /** Exact amounts of a cross-currency transfer line's mirror, carried by the op (format 7). */
  Mirror?: SplitMirrorAmounts | null;
}

/**
 * Mirror amounts carried on a split line in op args (`mirror`), checked at
 * the op boundary like the line's own amounts. Null when the line has none.
 */
export function readCarriedMirror(line: Record<string, unknown>): SplitMirrorAmounts | null {
  const raw = (line.mirror ?? line.Mirror) as Record<string, unknown> | null | undefined;
  if (!raw || typeof raw !== 'object') return null;
  return {
    InflowNative: asMilli(Number(raw.InflowNative ?? 0)),
    OutflowNative: asMilli(Number(raw.OutflowNative ?? 0)),
    InflowConverted: asMilli(Number(raw.InflowConverted ?? 0)),
    OutflowConverted: asMilli(Number(raw.OutflowConverted ?? 0)),
  };
}

/** An entered received (or sent) amount on a split line in UI args, in the target's currency. */
export function readReceivedAmount(line: Record<string, unknown>): number | null {
  const value = Number(line.received_amount ?? line.receivedAmount);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

/**
 * The message for a missing rate when quoting a received amount
 * (SplitMirrorRateError), or null for any other error.
 */
export function splitMirrorRateMessage(error: unknown): string | null {
  const rate = error as { code?: unknown; fromCurrency?: string; toCurrency?: string } | null;
  if (rate?.code !== SPLIT_MIRROR_RATE_MISSING) return null;
  const from = rate.fromCurrency ?? '';
  const to = rate.toCurrency ?? '';
  return t`Add a ${from} to ${to} exchange rate to save this received amount.`;
}

/**
 * Op `prepare` step for split lines with an entered received amount: the
 * originating device turns each into the exact mirror amounts and carries
 * them on the line as `mirror`, so every device writes the same, pinned,
 * mirror row (valued at its line, see SPLIT_MIRROR_PINNED in core). The
 * UI-only field is dropped; lines without one stay as they are (and the op
 * keeps its old format). A quote that fails with a missing rate refuses the
 * UI's save; `lenient` calls (the Push API) fall back to the plain, converted
 * mirror instead. Lenient calls never carry a `mirror` of their own either:
 * only this step writes one.
 */
export async function carryReceivedAmounts<T extends Record<string, unknown>>(
  lines: T[],
  quote: (received: (number | null)[]) => Promise<(SplitMirrorAmounts | null)[]>,
  options: { lenient?: boolean } = {}
): Promise<T[]> {
  const strip = (line: T) => {
    const { received_amount: _snake, receivedAmount: _camel, ...rest } = line;
    if (!options.lenient) return rest;
    const { mirror: _mirror, Mirror: _pascal, ...plain } = rest;
    return plain;
  };
  const hasReceived = lines.some(
    (line) =>
      'received_amount' in line ||
      'receivedAmount' in line ||
      (options.lenient && ('mirror' in line || 'Mirror' in line))
  );
  if (!hasReceived) return lines;
  const received = lines.map(readReceivedAmount);
  let quotes: (SplitMirrorAmounts | null)[] = [];
  if (received.some((amount) => amount !== null)) {
    try {
      quotes = await quote(received);
    } catch (error) {
      const message = splitMirrorRateMessage(error);
      if (message === null) throw error;
      if (!options.lenient) throw new Error(message);
      quotes = [];
    }
  }
  return lines.map((line, index) => {
    const mirror = quotes[index];
    const rest = strip(line);
    return (mirror ? { ...rest, mirror } : rest) as unknown as T;
  });
}

/** Normalize split lines from an op payload (snake_case or PascalCase) to the core shape. */
export function normalizeSplitLines(splits: unknown): NormalizedSplit[] {
  // asMilli doubles as the op-boundary guard: a decimal amount in a payload
  // throws here instead of reaching an integer column.
  return ((splits as Record<string, unknown>[]) || []).map((s, idx) => {
    const inflowOriginal = s.InflowNative ?? s.InflowOriginal ?? s.inflow_original ?? null;
    const outflowOriginal = s.OutflowNative ?? s.OutflowOriginal ?? s.outflow_original ?? null;
    return {
      CategoryID: (s.CategoryID ?? s.category_id ?? null) as number | null,
      TransferAccountID: (s.TransferAccountID ?? s.transfer_account_id ?? null) as number | null,
      Memo: String(s.Memo ?? s.memo ?? ''),
      Payee: String(s.Payee ?? s.payee ?? ''),
      InflowConverted: asMilli(Number(s.InflowConverted ?? s.Inflow ?? s.inflow ?? 0)),
      OutflowConverted: asMilli(Number(s.OutflowConverted ?? s.Outflow ?? s.outflow ?? 0)),
      InflowNative: inflowOriginal == null ? null : asMilli(Number(inflowOriginal)),
      OutflowNative: outflowOriginal == null ? null : asMilli(Number(outflowOriginal)),
      PairID: (s.PairID ?? s.pair_id ?? null) as string | null,
      OrderIndex: Number(s.OrderIndex ?? s.order_index ?? idx),
      Mirror: readCarriedMirror(s),
    };
  });
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
  importIdentities?: ImportIdentity[];
  ID?: number;
  Date?: string;
  date?: string;
  /** Optional time of day ('HH:MM'). */
  Time?: string | null;
  time?: string | null;
  Memo?: string;
  memo?: string;
  Payee?: string;
  payee?: string;
  InflowConverted?: number;
  /** Legacy pre-045 payload name for InflowConverted. */
  Inflow?: number;
  inflow?: number;
  OutflowConverted?: number;
  /** Legacy pre-045 payload name for OutflowConverted. */
  Outflow?: number;
  outflow?: number;
  InflowNative?: number;
  /** Legacy pre-045 payload name for InflowNative. */
  InflowOriginal?: number;
  inflowOriginal?: number;
  OutflowNative?: number;
  /** Legacy pre-045 payload name for OutflowNative. */
  OutflowOriginal?: number;
  outflowOriginal?: number;
  ExchangeRate?: number | null;
  ExchangeRateOverride?: boolean;
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
  Cleared?: boolean | number;
  Reconciled?: boolean | number;
}

export type OpCall = { op: string; args: Record<string, unknown> };

/** Transaction row type for dynamic column access */
export interface TransactionRowWithColumns {
  ID: number;
  Date: string;
  Memo: string;
  InflowConverted: number;
  OutflowConverted: number;
  CategoryID: number;
  AccountID: number;
  InflowNative?: number;
  OutflowNative?: number;
  ExchangeRate?: number | null;
  ExchangeRateOverride?: boolean | number;
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
      id: snapshot.ID,
      importIdentities: snapshot.importIdentities,
      inflow:
        snapshot.InflowNative ??
        snapshot.InflowOriginal ??
        snapshot.inflowOriginal ??
        snapshot.InflowConverted ??
        snapshot.Inflow ??
        snapshot.inflow ??
        0,
      outflow:
        snapshot.OutflowNative ??
        snapshot.OutflowOriginal ??
        snapshot.outflowOriginal ??
        snapshot.OutflowConverted ??
        snapshot.Outflow ??
        snapshot.outflow ??
        0,
      accountId: snapshot.AccountID ?? snapshot.account_id ?? snapshot.accountId,
      categoryId: snapshot.CategoryID ?? snapshot.category_id ?? snapshot.categoryId,
      labelId: snapshot.LabelID ?? snapshot.label_id ?? snapshot.labelId ?? null,
      budgetId: snapshot.BudgetID ?? snapshot.budget_id ?? snapshot.budgetId,
      date: snapshot.Date ?? snapshot.date,
      ...((snapshot.Time ?? snapshot.time) ? { time: snapshot.Time ?? snapshot.time } : {}),
      memo: snapshot.Memo ?? snapshot.memo ?? '',
      payee: snapshot.Payee ?? snapshot.payee ?? '',
      transferId: snapshot.TransferID ?? snapshot.transfer_id ?? snapshot.transferId ?? undefined,
      exchangeRateOverride: snapshot.ExchangeRateOverride ? snapshot.ExchangeRate : null,
      // Restored rows keep their cleared status (reconciled rows were cleared).
      cleared: Boolean(snapshot.Cleared || snapshot.Reconciled),
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
  getMonthlyAssignmentValues?: (
    assignments: { categoryId: number; month: string; budgetId: number }[]
  ) => number[] | Promise<number[]>;
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

/** Every account-register projection must refresh whenever transaction rows change. */
export const ACCOUNT_TRANSACTION_INVALIDATION_KEYS: [string, ...string[]][] = [
  ['transactions', '*'],
  ['accountTransactionPages', '*'],
  ['accountTransactionRange', '*'],
  ['accountTransactionSummary', '*'],
  ['similarTransactions', '*'],
  ['futureAccountTransactions', '*'],
  ['accountBalanceHistory', '*'],
  // The Transfer rate dialog reads both sides' amounts and reconciled state.
  ['transferRateDetails', '*'],
];

export const TRANSACTION_INVALIDATION_KEYS: string[][] = [
  ...ACCOUNT_TRANSACTION_INVALIDATION_KEYS,
  ['transactionsByCategoryAndMonth', '*'],
  ['allTransactions', '*'],
  ['allTransactionsDetailed', '*'],
  ['allTransactionsAnalytics', '*'],
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
  ['payeeCategoryMemory'],
  ['payeeCategoryMemory', '*'],
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
export type ReportSaveInput = SaveReportInput;

export interface OpCodeExecutionContext {
  mutationId: string;
  isReceiver: boolean;
}

export interface OpCodeEntry {
  execute: (args: Record<string, unknown>, context?: OpCodeExecutionContext) => Promise<unknown>;
  /**
   * Runs once, on the originating device only, before the op executes; the
   * args it returns are what executes here AND what is sent to other devices.
   * Use it for anything that must be the same everywhere: generated IDs,
   * fetched exchange rates. Must not write to the database.
   */
  prepare?: (
    args: Record<string, unknown>
  ) => Record<string, unknown> | Promise<Record<string, unknown>>;
  // Query keys to invalidate (for remote mutations)
  invalidates: string[][];
  /**
   * Optional narrower set for one call's args (e.g. a memo edit cannot change
   * balances). Must be a subset of `invalidates`, which stays the full list for
   * callers that only know the op code.
   */
  invalidatesFor?: (args: Record<string, unknown>) => string[][];
  undo?: {
    // Capture any before-state needed to build inverse ops
    capture?: (args: Record<string, unknown>) => Promise<unknown>;
    // Build inverse operations to undo this mutation
    build: (args: Record<string, unknown>, result: unknown, before: unknown) => OpCall[];
  };
  /**
   * false: app state the user didn't edit as such (synced UI state, seen
   * guides); no row in the mutation history (audit log). Such ops have no undo.
   */
  history?: false;
  /**
   * For ops that change existing transactions: the IDs they change. When a
   * synced op arrives for transactions an earlier op in the log deleted (one
   * device deleted a row while another, not having seen that yet, edited
   * it), the edit is dropped instead of failing the replay: every device
   * applies the log in the same order, so the delete wins everywhere. IDs
   * this device never had are not "deleted" and still fail (the local DB
   * diverged; the replay falls back to a snapshot restore).
   */
  editsTransactions?: {
    ids: (args: Record<string, unknown>) => unknown[];
    /**
     * The args without the deleted IDs, for ops that change several rows.
     * Omitted: the op is dropped only when every ID it changes is deleted.
     */
    without?: (args: Record<string, unknown>, deleted: Set<number>) => Record<string, unknown>;
  };
  // Optional redo customization (defaults to re-applying the original op)
  redo?: {
    build: (args: Record<string, unknown>, result: unknown, before: unknown) => OpCall[];
  };
}

/** Random ID for a row created by an op (generated once, carried in the args). */
export function newOpRowId(): string {
  return globalThis.crypto.randomUUID();
}

/** `prepare` for create ops whose row ID lives in `args[key]`: fill it in when absent. */
export function withGeneratedId(key = 'id'): NonNullable<OpCodeEntry['prepare']> {
  return (args) =>
    args[key] == null || args[key] === '' ? { ...args, [key]: newOpRowId() } : args;
}

/**
 * Redo for a create: re-run the op with the ID(s) the first run produced, so undo
 * entries that reference the row stay valid. `withIds` returns null to fall back.
 */
export function redoWithIds(
  op: string,
  withIds: (
    args: Record<string, unknown>,
    result: unknown,
    before: unknown
  ) => Record<string, unknown> | null
): NonNullable<OpCodeEntry['redo']> {
  return {
    build: (args, result, before) => {
      const next = withIds(args, result, before);
      return next ? [{ op, args: next }] : [];
    },
  };
}

/**
 * Undo capture for ops that can create a system category on the fly (a
 * transfer re-creates Transfers after it was deleted): where the category
 * IDs stand before the op. See createdCategoriesUndo.
 */
export function captureCategoryMark(): CategoryCreationMark | null {
  try {
    return S().categories.creationMark();
  } catch {
    return null;
  }
}

/**
 * The undo op removing the categories / groups created since `mark` (none
 * created: no op). Runs after the op's other undo steps, once nothing uses
 * them anymore; it puts the ID counters back so a redo re-creates them under
 * the same IDs.
 */
export function createdCategoriesUndo(mark: unknown, budgetId: unknown): OpCall[] {
  if (!mark || typeof mark !== 'object') return [];
  try {
    const journal = S().categories.createdSinceJournal(mark as CategoryCreationMark);
    return journal
      ? [
          {
            op: 'categories.restoreDeleted',
            args: { ...(budgetId !== undefined ? { budgetId } : {}), journal },
          },
        ]
      : [];
  } catch {
    return [];
  }
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

/** Op code that puts back what a journaled op wrote (see executeJournaled). */
export const RESTORE_ROWS_OP = 'history.restoreRows';

/** Journal of the op run with these args object (set by execute, read by undo build). */
const opJournals = new WeakMap<Record<string, unknown>, RowJournal>();

/**
 * Runs an op's change under the row journal (core RowJournalService), so its
 * undo restores exactly the rows it wrote, whatever they are (see
 * journaledUndo). Only the originating device records: receivers apply the
 * undo op they are sent. `change` must be the op's only database work.
 * Without a journal service (unit-test mocks) it just runs the change.
 */
export async function executeJournaled<T>(
  args: Record<string, unknown>,
  context: OpCodeExecutionContext | undefined,
  change: () => T | Promise<T>
): Promise<T> {
  // Optional at runtime: unit tests mock only the services they use.
  const recorder = S().rowJournal as Partial<Services['rowJournal']> | undefined;
  if (context?.isReceiver || typeof recorder?.recordAsync !== 'function') return change();
  const { result, journal } = await recorder.recordAsync(async () => change());
  if (journal) opJournals.set(args, journal);
  return result;
}

/**
 * Undo for an op run through executeJournaled: one RESTORE_ROWS_OP with the
 * journal (nothing when the op changed nothing). Falls back to `fallback`
 * when no journal was recorded (mocked services).
 */
export function journaledUndo(
  fallback?: NonNullable<OpCodeEntry['undo']>
): NonNullable<OpCodeEntry['undo']> {
  return {
    ...(fallback?.capture ? { capture: fallback.capture } : {}),
    build: (args, result, before) => {
      const journal = opJournals.get(args);
      if (!journal) return fallback ? fallback.build(args, result, before) : [];
      if (isEmptyJournal(journal)) return [];
      return [
        {
          op: RESTORE_ROWS_OP,
          args: { ...(args.budgetId !== undefined ? { budgetId: args.budgetId } : {}), journal },
        },
      ];
    },
  };
}
