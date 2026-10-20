import {
  type AccountService,
  type ImportIdentity,
  type ReconcileResult,
  type TransactionAmountsSnapshot,
  type SplitParentAmounts,
  type TransactionBatchEdit,
  type TransactionRestoreSnapshot,
  type TransactionService,
  type TransactionSplit,
  type TransactionWriteBatch,
  asMilli,
} from '@budgero/core/browser';
import {
  S,
  captureCategoryMark,
  createdCategoriesUndo,
  sortTransactionSnapshots,
  transactionSnapshotToAddOp,
  TRANSACTION_INVALIDATION_KEYS,
  ACCOUNT_TRANSACTION_INVALIDATION_KEYS,
  RECURRING_OCCURRENCE_INVALIDATIONS,
  RECURRING_TEMPLATE_INVALIDATIONS,
  safeCapture,
  type NormalizedSplit,
  type OpCall,
  type OpCodeEntry,
  type TransactionRowWithColumns,
  type TransactionSnapshot,
} from '../shared';

const SPLIT_INVALIDATION_KEYS: [string, ...string[]][] = [
  ...ACCOUNT_TRANSACTION_INVALIDATION_KEYS,
  ['allTransactions', '*'],
  ['allTransactionsDetailed', '*'],
  ['allTransactionsAnalytics', '*'],
  ['monthlyBudget', '*'],
  ['transactionsByCategoryAndMonth', '*'],
  ['monthlySpending', '*'],
  ['spendingByDates', '*'],
  ['spendingByDatesByCategories', '*'],
  ['spendingByCategoriesInGroup', '*'],
  ['spendingByLabels', '*'],
  ['analyticsPeriodSummary', '*'],
  ['topSpendingCategories', '*'],
  ['incomeExpenseByPeriod', '*'],
  ['transactionSplits', '*'],
  ['labels', '*'],
  ['labelDirectory', '*'],
  // Transfer lines move money into other accounts and category lines move
  // money in and out of Uncategorized / Ready to Assign: the sidebar balances,
  // RTA and balance charts must refresh too.
  ['accounts'],
  ['accounts', '*'],
  ['uncategorizedTransactions', '*'],
  ['allAccountsMonthlyTransactions', '*'],
  ['readyToAssign'],
  ['readyToAssign', '*'],
  ['monthlyBalance', '*'],
  ['balanceByDates', '*'],
  ['onBudgetBalance'],
  ['onBudgetBalanceByDates'],
];

function restoreSnapshotsUndo(before: unknown): OpCall[] {
  const snaps = (before as { snapshots?: TransactionSnapshot[] } | undefined)?.snapshots || [];
  return snaps.length ? sortTransactionSnapshots(snaps).map(transactionSnapshotToAddOp) : [];
}

/**
 * A write batch from the core services: the op's rows commit in ONE DB
 * transaction (no compensating deletes). Service doubles without batches
 * (older unit tests) take the sequential path.
 */
function writeBatch(): TransactionWriteBatch | null {
  const transactions = S().transactions as Partial<TransactionService> | undefined;
  return typeof transactions?.createWriteBatch === 'function'
    ? transactions.createWriteBatch()
    : null;
}

/**
 * Exact before-state of the rows a delete or edit touches (with transfer
 * partners, split lines and mirrors, provenance and links). Null when the
 * services cannot capture one; callers then fall back to row snapshots.
 */
function captureRestore(ids: number[]): TransactionRestoreSnapshot | null {
  const transactions = S().transactions as Partial<TransactionService> | undefined;
  if (typeof transactions?.captureRestoreSnapshot !== 'function') return null;
  try {
    const snapshot = transactions.captureRestoreSnapshot(ids);
    return snapshot.transactions.length ? snapshot : null;
  } catch {
    return null;
  }
}

/** Undo that puts captured rows back exactly, in one op (and one DB transaction). */
function restoreUndo(before: unknown, replace = false): OpCall[] | null {
  const snapshot = (before as { restore?: TransactionRestoreSnapshot } | null)?.restore;
  if (!snapshot) return null;
  return [{ op: 'transactions.restore', args: { snapshot, ...(replace ? { replace } : {}) } }];
}

/** Normalize split lines from an op payload (snake_case or PascalCase) to the core shape. */
function normalizeSplitLines(splits: unknown): NormalizedSplit[] {
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
    };
  });
}

/** Undo for split edits: put back the previous lines, or clear if there were none. */
const splitsUndo: NonNullable<OpCodeEntry['undo']> = {
  // Exact when the services can capture the parent (lines under their IDs,
  // mirrors, the parent's category); otherwise the previous lines are re-upserted.
  capture: async (args) => {
    const restore = captureRestore([args.transactionId as number]);
    if (restore) return { restore };
    return safeCapture(() => S().splits.getSplits(args.transactionId as number));
  },
  build: (args, _result, before) => {
    const exact = restoreUndo(before, true);
    if (exact) return exact;
    const previous = before as TransactionSplit[] | null;
    if (!previous) return [];
    return previous.length
      ? [
          {
            op: 'transactions.upsertSplits',
            args: { transactionId: args.transactionId, splits: previous },
          },
        ]
      : [{ op: 'transactions.clearSplits', args: { transactionId: args.transactionId } }];
  },
};

type ReconcileWithAdjustment = ReconcileResult & { adjustmentId?: number };

function reconcileUndo(accountId: unknown, result: unknown): OpCall[] {
  const reconcile = result as ReconcileWithAdjustment | undefined;
  if (!reconcile) return [];
  const { adjustmentId, ...locked } = reconcile;
  // Unlock first: the adjustment was locked by this reconcile.
  return [
    { op: 'transactions.unreconcile', args: { accountId, ...locked } },
    ...(adjustmentId === undefined
      ? []
      : [{ op: 'transactions.delete', args: { id: adjustmentId } }]),
  ];
}

// Shared by transactions.delete (exact) and transactions.updateColumn (which also
// invalidates payees). Invalidation order is irrelevant — these are set operations.
const TX_WRITE_INVALIDATION_KEYS: string[][] = [
  ...ACCOUNT_TRANSACTION_INVALIDATION_KEYS,
  ['transactionsByCategoryAndMonth', '*'],
  ['allTransactions', '*'],
  ['allTransactionsDetailed', '*'],
  ['allTransactionsAnalytics', '*'],
  ['uncategorizedTransactions', '*'],
  ['allAccountsMonthlyTransactions', '*'],
  ['accounts'],
  ['monthlyBudget', '*'],
  ['readyToAssign'],
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

const TX_COLUMN_PAYEE_KEYS: string[][] = [
  ['payees'],
  ['payees', '*'],
  ['payeeDirectory'],
  ['payeeDirectory', '*'],
];

const TX_COLUMN_LABEL_KEYS: string[][] = [
  ['labels'],
  ['labels', '*'],
  ['labelDirectory'],
  ['labelDirectory', '*'],
  ['spendingByLabels', '*'],
];

// Full set for a column edit the op cannot classify (and for callers that only
// know the op code): every write key plus payees, as before.
const TX_UPDATE_COLUMN_INVALIDATION_KEYS: string[][] = [
  ...TX_WRITE_INVALIDATION_KEYS,
  ['payees'],
  ['payees', '*'],
];

/**
 * Every query that lists transaction rows (and so shows memo, payee and label),
 * but none of the balance, budget or analytics aggregates.
 */
const TX_ROW_LIST_INVALIDATION_KEYS: string[][] = [
  ...ACCOUNT_TRANSACTION_INVALIDATION_KEYS,
  ['transactionsByCategoryAndMonth', '*'],
  ['allTransactions', '*'],
  ['allTransactionsDetailed', '*'],
  ['allTransactionsAnalytics', '*'],
  ['uncategorizedTransactions', '*'],
  ['allAccountsMonthlyTransactions', '*'],
];

/**
 * Amount, date, category, account and rate edits move balances, budgets and
 * analytics, but cannot change the payee or label directories (names and
 * usage counts depend only on which rows exist and their payee/label).
 */
const TX_VALUE_UPDATE_INVALIDATION_KEYS: string[][] = TX_WRITE_INVALIDATION_KEYS.filter(
  ([root]) => !['payees', 'payeeDirectory', 'labels', 'labelDirectory'].includes(root)
);

const TX_VALUE_COLUMNS = new Set([
  'inflowconverted',
  'outflowconverted',
  'inflownative',
  'outflownative',
  // legacy pre-045 names, still accepted by updateTransactionColumn
  'inflow',
  'outflow',
  'infloworiginal',
  'outfloworiginal',
  'date',
  'categoryid',
  'accountid',
  'exchangerate',
]);

/**
 * What a `transactions.updateColumn` call can change, by column (normalized the
 * same way as TransactionService.updateTransactionColumn):
 * - memo: only the rows themselves;
 * - payee: the rows and the payee directory;
 * - label: the rows and the label directory / label analytics;
 * - amounts, date, category, account, rate: everything except the payee and
 *   label directories;
 * - anything else: the full list.
 */
export function updateColumnInvalidations(args: Record<string, unknown>): string[][] {
  const column =
    typeof args.columnName === 'string' ? args.columnName.toLowerCase().replace(/_/g, '') : '';
  if (column === 'memo') return TX_ROW_LIST_INVALIDATION_KEYS;
  if (column === 'payee') return [...TX_ROW_LIST_INVALIDATION_KEYS, ...TX_COLUMN_PAYEE_KEYS];
  if (column === 'labelid') return [...TX_ROW_LIST_INVALIDATION_KEYS, ...TX_COLUMN_LABEL_KEYS];
  if (TX_VALUE_COLUMNS.has(column)) return TX_VALUE_UPDATE_INVALIDATION_KEYS;
  return TX_UPDATE_COLUMN_INVALIDATION_KEYS;
}

// Shared by transactions.moveToNewCategory and transactions.reassign (exact), and
// transactions.moveToNewAccount (which also invalidates accounts).
const TX_MOVE_INVALIDATION_KEYS: string[][] = [
  ...ACCOUNT_TRANSACTION_INVALIDATION_KEYS,
  ['allTransactions', '*'],
  ['allTransactionsDetailed', '*'],
  ['allTransactionsAnalytics', '*'],
  ['uncategorizedTransactions', '*'],
  ['allAccountsMonthlyTransactions', '*'],
  ['monthlyBudget', '*'],
  ['analyticsPeriodSummary', '*'],
  ['topSpendingCategories', '*'],
  ['incomeExpenseByPeriod', '*'],
  ['onBudgetBalance'],
  ['onBudgetBalanceByDates'],
  ['spendingByLabels', '*'],
  ['labels', '*'],
  ['labelDirectory', '*'],
];

const AMOUNT_COLUMNS = new Set([
  'inflowconverted',
  'outflowconverted',
  'inflownative',
  'outflownative',
  'inflow',
  'outflow',
  'infloworiginal',
  'outfloworiginal',
]);

const LEGACY_COLUMNS: Record<string, string> = {
  inflow: 'inflowconverted',
  outflow: 'outflowconverted',
  infloworiginal: 'inflownative',
  outfloworiginal: 'outflownative',
};

/**
 * The row's value for an updateColumn column name, matched the way
 * updateTransactionColumn matches it (any case, underscores, legacy names).
 */
function readColumn(tx: TransactionRowWithColumns, columnName: string): unknown {
  if (columnName in tx) return tx[columnName];
  const normalized = columnName.toLowerCase().replace(/_/g, '');
  const target = LEGACY_COLUMNS[normalized] ?? normalized;
  const key = Object.keys(tx).find((name) => name.toLowerCase() === target);
  return key === undefined ? undefined : tx[key];
}

function amountsSnapshot(tx: TransactionRowWithColumns): TransactionAmountsSnapshot {
  return {
    InflowNative: asMilli(Number(tx.InflowNative ?? tx.InflowConverted ?? 0)),
    OutflowNative: asMilli(Number(tx.OutflowNative ?? tx.OutflowConverted ?? 0)),
    InflowConverted: asMilli(Number(tx.InflowConverted ?? 0)),
    OutflowConverted: asMilli(Number(tx.OutflowConverted ?? 0)),
    ExchangeRate: tx.ExchangeRate ?? null,
    ExchangeRateOverride: Boolean(tx.ExchangeRateOverride),
  };
}

/** True when the two accounts exist and hold different currencies. */
function crossCurrencyMove(fromAccountId: unknown, toAccountId: unknown): boolean {
  const accounts = S().accounts as Partial<Pick<AccountService, 'getAccount'>> | undefined;
  if (typeof accounts?.getAccount !== 'function') return false;
  try {
    return (
      accounts.getAccount(Number(fromAccountId)).Currency !==
      accounts.getAccount(Number(toAccountId)).Currency
    );
  } catch {
    return false;
  }
}

/**
 * Before-state for column edits whose inverse edit would not land exactly on
 * it, so undo puts the captured rows back instead (transactions.restore):
 * - an amount or rate edit on a split parent re-proportions the lines (and
 *   moves split-transfer mirrors); editing the amount back re-proportions the
 *   new lines again instead of restoring them;
 * - a rate edit on a row with no stored rate (there is no rate to write back);
 * - a move between accounts of different currencies converts the native
 *   amount, and converting it back does not round-trip;
 * - a date edit on a foreign row re-converts it at the new date's rate;
 * - a payee edit on a row whose payee was '' (the edit back writes NULL).
 */
function exactColumnRestore(
  tx: TransactionRowWithColumns,
  column: string,
  oldValue: unknown,
  newValue: unknown
): TransactionRestoreSnapshot | null {
  if (column === 'accountid') {
    return crossCurrencyMove(tx.AccountID, newValue) ? captureRestore([tx.ID]) : null;
  }
  // A date edit on a foreign row re-converts it at the new date's rate;
  // editing the date back converts again instead of restoring the amounts.
  if (column === 'date') {
    return tx.ExchangeRate != null || Boolean(tx.ConversionPending)
      ? captureRestore([tx.ID])
      : null;
  }
  // A payee edit stores '' as NULL, so the edit back would not restore ''.
  if (column === 'payee') return oldValue === '' ? captureRestore([tx.ID]) : null;
  const amount = AMOUNT_COLUMNS.has(column);
  if (!amount && column !== 'exchangerate') return null;
  const restore = captureRestore([tx.ID]);
  if (!restore) return null;
  if (restore.dependents.some((dependent) => dependent.table === 'transaction_splits')) {
    return restore;
  }
  if (column === 'exchangerate') return oldValue == null ? restore : null;
  // An amount edit re-resolves the rate of a foreign row (whose stored rate
  // may be a fallback or stale) and re-derives a transfer partner: editing the
  // amount back would not restore either.
  return restore.transactions.length > 1 ||
    restore.transactions.some((row) => row.ExchangeRate != null)
    ? restore
    : null;
}

/** Payee names an op is about to use that the budget's directory does not have yet. */
export interface MissingPayees {
  budgetId: number;
  names: string[];
}

type PayeeDirectory = Pick<
  ReturnType<typeof S>['payees'],
  'hasSavedPayee' | 'getSavedPayeeId' | 'removeUnusedPayees'
>;

function payeeDirectory(): PayeeDirectory | null {
  const payees = S().payees as Partial<PayeeDirectory> | undefined;
  return typeof payees?.hasSavedPayee === 'function' &&
    typeof payees.getSavedPayeeId === 'function' &&
    typeof payees.removeUnusedPayees === 'function'
    ? (payees as PayeeDirectory)
    : null;
}

/** Capture side of removeAddedPayees: which typed names are new to the directory. */
export function missingPayees(budgetId: unknown, names: unknown[]): MissingPayees | undefined {
  const directory = payeeDirectory();
  if (!directory || typeof budgetId !== 'number') return undefined;
  const missing = [
    ...new Set(
      names
        .filter((name): name is string => typeof name === 'string')
        .map((name) => name.trim())
        .filter(Boolean)
    ),
  ].filter((name) => !directory.hasSavedPayee(budgetId, name));
  return missing.length ? { budgetId, names: missing } : undefined;
}

/**
 * Undo step for directory entries the op added (a new payee typed on an add or
 * an edit): runs after the rows are undone and drops the entries nothing uses.
 */
export function removeAddedPayees(missing: MissingPayees | undefined): OpCall[] {
  if (!missing) return [];
  const directory = payeeDirectory();
  if (!directory) return [];
  const ids = missing.names
    .map((name) => directory.getSavedPayeeId(missing.budgetId, name))
    .filter((id): id is number => id !== undefined);
  return ids.length
    ? [{ op: 'payees.removeUnused', args: { budgetId: missing.budgetId, ids } }]
    : [];
}

/** Payee names on an add / import payload: the row's and its split lines'. */
function payloadPayees(args: Record<string, unknown>): unknown[] {
  const lines = Array.isArray(args.splits) ? (args.splits as Record<string, unknown>[]) : [];
  return [args.payee, ...lines.map((line) => line?.payee)];
}

/** Undo/redo pass the row's original ID so history entries that reference it stay valid. */
function explicitId(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

async function addTransactionFromArgs(
  args: Record<string, unknown>,
  batch?: TransactionWriteBatch
): Promise<number> {
  const parameters = [
    asMilli(Number(args.inflow ?? 0)),
    asMilli(Number(args.outflow ?? 0)),
    args.accountId as number,
    (args.categoryId as number | null | undefined) ?? 0,
    args.budgetId as number,
    args.date as string,
    (args.memo as string | undefined) ?? '',
    (args.transferId as string | undefined) || '',
    (args.payee as string | undefined) ?? '',
    (args.labelId as number | null | undefined) ?? null,
    typeof args.exchangeRateOverride === 'number' ? (args.exchangeRateOverride as number) : null,
  ] as const;
  // Omitted `cleared` means uncleared (manual entry, Push API default).
  return S().transactions!.addTransaction(
    ...parameters,
    false,
    (args.importIdentities as ImportIdentity[] | undefined) ?? [],
    args.cleared === true,
    explicitId(args.id),
    // With a batch the result is the queued step's index (see TransactionWriteBatch).
    ...(batch ? [batch] : [])
  );
}

/**
 * Normalize a Push API v2 `splits` array (camelCase args, integer milliunits,
 * categoryId or transferAccountId per line) to the core split shape.
 * Returns undefined when the caller sent no splits (plain single-category add).
 */
function normalizePushSplits(raw: unknown): NormalizedSplit[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw)) {
    throw new Error('"splits" must be an array of split lines.');
  }
  if (raw.length === 0) {
    throw new Error('"splits" must contain at least one line.');
  }
  return raw.map((line: unknown, idx) => {
    if (!line || typeof line !== 'object' || Array.isArray(line)) {
      throw new Error('Each split line must be an object.');
    }
    const entry = line as Record<string, unknown>;
    const inflow = asMilli(Number(entry.inflow ?? 0));
    const outflow = asMilli(Number(entry.outflow ?? 0));
    if (inflow < 0 || outflow < 0 || (inflow > 0 && outflow > 0)) {
      throw new Error('Split amounts must be non-negative with only one direction.');
    }
    const categoryId = entry.categoryId ?? null;
    const transferAccountId = entry.transferAccountId ?? null;
    if ((categoryId === null) === (transferAccountId === null)) {
      throw new Error('Each split must have either categoryId or transferAccountId exclusively.');
    }
    const targetId = categoryId ?? transferAccountId;
    if (typeof targetId !== 'number' || !Number.isSafeInteger(targetId) || targetId <= 0) {
      throw new Error('Split categoryId or transferAccountId must be a positive integer.');
    }
    return {
      CategoryID: categoryId as number | null,
      TransferAccountID: transferAccountId as number | null,
      Memo: String(entry.memo ?? ''),
      Payee: String(entry.payee ?? ''),
      // Push amounts use account currency, like the parent. The split service
      // projects native amounts onto the parent's exact converted total.
      InflowConverted: inflow,
      OutflowConverted: outflow,
      InflowNative: inflow,
      OutflowNative: outflow,
      PairID: null,
      OrderIndex: idx,
    };
  });
}

function withImportIdentities(tx: TransactionSnapshot): TransactionSnapshot {
  return {
    ...tx,
    importIdentities: tx.ID ? (S().importHistory?.duplicates.identities(tx.ID) ?? []) : [],
  };
}

export const transactionOps = {
  'transactions.import': {
    execute: async (args) => {
      const identity = (args.importIdentities as ImportIdentity[] | undefined)?.[0];
      if (!identity) throw new Error('Import identity is required');
      const existing = S().importHistory!.duplicates.findOperation(identity.operationId);
      if (existing !== undefined) return { transactionId: existing, created: false };
      // Bank-statement rows have already cleared unless the file says otherwise.
      return {
        transactionId: await addTransactionFromArgs({ ...args, cleared: args.cleared !== false }),
        created: true,
      };
    },
    invalidates: [...TRANSACTION_INVALIDATION_KEYS],
    undo: {
      capture: async (args) => ({ payees: missingPayees(args.budgetId, payloadPayees(args)) }),
      build: (_args, result, before) => {
        const imported = result as { transactionId: number; created: boolean };
        return imported.created
          ? [
              { op: 'transactions.delete', args: { id: imported.transactionId } },
              ...removeAddedPayees((before as { payees?: MissingPayees } | undefined)?.payees),
            ]
          : [];
      },
    },
    redo: {
      build: (args, result) => {
        const imported = result as { transactionId: number; created: boolean };
        return imported.created
          ? [{ op: 'transactions.import', args: { ...args, id: imported.transactionId } }]
          : [];
      },
    },
  },
  'transactions.add': {
    execute: async (args) => {
      const identity = (args.importIdentities as ImportIdentity[] | undefined)?.[0];
      if (identity) {
        const existing = S().importHistory!.duplicates.findOperation(identity.operationId);
        if (existing !== undefined) return existing;
      }
      const splits = normalizePushSplits(args.splits);
      if (splits) {
        if (args.transferId) throw new Error('Transfer transactions cannot be split.');
        const parentNet = asMilli(Number(args.inflow ?? 0)) - asMilli(Number(args.outflow ?? 0));
        const splitNet = splits.reduce(
          (sum, line) => sum + Number(line.InflowNative) - Number(line.OutflowNative),
          0
        );
        if (splitNet !== parentNet) throw new Error('Split amounts must sum to parent total.');
      }
      const batch = splits ? writeBatch() : null;
      if (splits && batch) {
        // Parent and lines commit together.
        const parent = await addTransactionFromArgs({ ...args, categoryId: null }, batch);
        await S().splits!.upsertSplits({ batchIndex: parent }, splits, batch);
        return batch.commit()[parent] as number;
      }
      const transactionId = await addTransactionFromArgs(
        splits ? { ...args, categoryId: null } : args
      );
      if (splits) {
        try {
          await S().splits!.upsertSplits(transactionId, splits);
        } catch (error) {
          // Parent creation commits independently; compensate on split failure.
          await S().transactions!.deleteTransaction(transactionId);
          throw error;
        }
      }
      return transactionId;
    },
    invalidates: [...TRANSACTION_INVALIDATION_KEYS, ...SPLIT_INVALIDATION_KEYS],
    undo: {
      // An add whose import identity is already recorded returns the EXISTING
      // row and creates nothing: there is nothing to undo (deleting would
      // remove the row the identity belongs to).
      capture: async (args) => {
        const payees = missingPayees(args.budgetId, payloadPayees(args));
        const identity = (args.importIdentities as ImportIdentity[] | undefined)?.[0];
        if (!identity) return { duplicateOf: undefined, ...(payees ? { payees } : {}) };
        return {
          duplicateOf: S().importHistory!.duplicates.findOperation(identity.operationId),
          ...(payees ? { payees } : {}),
        };
      },
      // add -> delete the created transaction (and a payee entry it added)
      build: (_args, result, before) => {
        const captured = before as { duplicateOf?: number; payees?: MissingPayees } | undefined;
        if (captured?.duplicateOf !== undefined) return [];
        const id = result as number | undefined;
        return typeof id === 'number' && Number.isFinite(id)
          ? [{ op: 'transactions.delete', args: { id } }, ...removeAddedPayees(captured?.payees)]
          : [];
      },
    },
    // Redo recreates the row under the ID it first got.
    redo: {
      build: (args, result) =>
        typeof result === 'number'
          ? [{ op: 'transactions.add', args: { ...args, id: result } }]
          : [],
    },
  },

  'transactions.addTransfer': {
    execute: async (args) => {
      const budgetId = args.budgetId as number;
      const transferId = args.transferId as string;
      const source = args.source as Record<string, unknown>;
      const destination = args.destination as Record<string, unknown>;

      if (typeof transferId !== 'string' || !transferId.trim()) {
        throw new Error('"transferId" is required.');
      }
      if (
        !source ||
        !destination ||
        typeof source !== 'object' ||
        typeof destination !== 'object' ||
        Array.isArray(source) ||
        Array.isArray(destination)
      ) {
        throw new Error('Source and destination transfer legs are required.');
      }
      if (source.accountId === destination.accountId) {
        throw new Error('Source and destination accounts must differ.');
      }
      // Reusing an ID could merge unrelated transfers, and compensating a
      // failed insert would delete the earlier transfer along with the new leg.
      const existing = await S().transactions!.getTransactionsByTransferID(transferId);
      if (existing.length) throw new Error('This transferId is already in use.');

      const batch = writeBatch();
      if (batch) {
        // Both legs commit together.
        const sourceStep = await addTransactionFromArgs({ ...source, budgetId, transferId }, batch);
        const destinationStep = await addTransactionFromArgs(
          { ...destination, budgetId, transferId },
          batch
        );
        const ids = batch.commit();
        return {
          sourceId: ids[sourceStep] as number,
          destinationId: ids[destinationStep] as number,
        };
      }

      let sourceId: number | null = null;
      try {
        sourceId = await addTransactionFromArgs({ ...source, budgetId, transferId });
        const destinationId = await addTransactionFromArgs({
          ...destination,
          budgetId,
          transferId,
        });
        return { sourceId, destinationId };
      } catch (error) {
        // addTransaction commits each leg independently. Compensate if the
        // second leg fails so callers never observe a half-created transfer.
        if (sourceId !== null) {
          try {
            await S().transactions!.deleteTransaction(sourceId);
          } catch {
            // Preserve the original creation error. The rollback path is best-effort.
          }
        }
        throw error;
      }
    },
    invalidates: [...TRANSACTION_INVALIDATION_KEYS],
    undo: {
      capture: async () => ({ categoryMark: captureCategoryMark() }),
      // Use the stable TransferID because redo creates new database row IDs.
      build: (args, _result, before) => {
        const { transferId } = args;
        return typeof transferId === 'string' && transferId
          ? [
              { op: 'transactions.deleteTransfer', args: { transferId } },
              // A transfer re-creates the Transfers category if it was deleted.
              ...createdCategoriesUndo(
                (before as { categoryMark?: unknown } | null)?.categoryMark,
                args.budgetId
              ),
            ]
          : [];
      },
    },
    // Redo recreates both legs under the IDs they first got.
    redo: {
      build: (args, result) => {
        const ids = result as { sourceId: number; destinationId: number } | undefined;
        if (!ids) return [];
        const leg = (value: unknown, id: number) => ({ ...(value as object), id });
        return [
          {
            op: 'transactions.addTransfer',
            args: {
              ...args,
              source: leg(args.source, ids.sourceId),
              destination: leg(args.destination, ids.destinationId),
            },
          },
        ];
      },
    },
  },

  'transactions.updateTransferRate': {
    execute: async (args) => {
      return await S().transactions!.updateTransferRate(
        args.transferId as string,
        args.rate as number,
        typeof args.transferRateOverride === 'boolean'
          ? args.transferRateOverride
          : typeof args.manualOverride === 'boolean'
            ? args.manualOverride
            : true,
        typeof args.sourceRateOverride === 'boolean' ? args.sourceRateOverride : undefined,
        typeof args.destinationRateOverride === 'boolean' ? args.destinationRateOverride : undefined
      );
    },
    invalidates: [...TRANSACTION_INVALIDATION_KEYS],
    undo: {
      capture: async (args) => {
        const details = await S().transactions!.getTransferRateDetails(args.transferId as string);
        return details
          ? {
              rate: details.rate,
              transferRateOverride: details.transferRateOverride,
              sourceRateOverride: details.source.rateOverride,
              destinationRateOverride: details.destination.rateOverride,
            }
          : undefined;
      },
      build: (args, _result, before) => {
        const previous = before as
          | {
              rate?: number;
              transferRateOverride?: boolean;
              sourceRateOverride?: boolean;
              destinationRateOverride?: boolean;
            }
          | undefined;
        return typeof previous?.rate === 'number'
          ? [
              {
                op: 'transactions.updateTransferRate',
                args: {
                  transferId: args.transferId,
                  rate: previous.rate,
                  transferRateOverride: previous.transferRateOverride ?? false,
                  sourceRateOverride: previous.sourceRateOverride ?? false,
                  destinationRateOverride: previous.destinationRateOverride ?? false,
                },
              },
            ]
          : [];
      },
    },
  },

  'transactions.deleteTransfer': {
    execute: async (args) => {
      const transferId = args.transferId as string;
      if (typeof transferId !== 'string' || !transferId.trim()) {
        throw new Error('"transferId" is required.');
      }
      const transactions = await S().transactions!.getTransactionsByTransferID(transferId);
      const [first] = transactions;
      if (!first) return;
      // TransactionService.deleteTransaction removes every row with the same TransferID
      // while applying the normal balance and running-balance adjustments.
      await S().transactions!.deleteTransaction(first.ID);
    },
    invalidates: TX_WRITE_INVALIDATION_KEYS,
    undo: {
      capture: async (args) => {
        const group = await safeCapture(() =>
          S().transactions!.getTransactionsByTransferID(args.transferId as string)
        );
        const restore = captureRestore((group ?? []).map((row) => row.ID));
        if (restore) return { restore };
        return { snapshots: (group ?? []).map(withImportIdentities) };
      },
      build: (_args, _result, before) => restoreUndo(before) ?? restoreSnapshotsUndo(before),
    },
  },

  // useUpdateTransactionColumn
  'transactions.updateColumn': {
    execute: async (args) => {
      return await S().transactions!.updateTransactionColumn(
        args.id as number,
        args.columnName as string,
        args.newValue as string | number | null,
        typeof args.exchangeRateOverride === 'boolean' ? args.exchangeRateOverride : undefined
      );
    },
    invalidates: TX_UPDATE_COLUMN_INVALIDATION_KEYS,
    invalidatesFor: updateColumnInvalidations,
    undo: {
      // capture current value before update so we can restore it
      capture: async (args) => {
        const tx = (await S().transactions!.getTransactionByID(
          args.id as number
        )) as unknown as TransactionRowWithColumns;
        const col = args.columnName as string;
        const oldValue = readColumn(tx, col);
        const normalized = col.toLowerCase().replace(/_/g, '');
        const oldExchangeRateOverride =
          normalized === 'exchangerate' ? Boolean(tx.ExchangeRateOverride) : undefined;
        const payees =
          normalized === 'payee' ? missingPayees(tx.BudgetID, [args.newValue]) : undefined;
        const restore = exactColumnRestore(tx, normalized, oldValue, args.newValue);
        if (restore) return { oldValue, restore, ...(payees ? { payees } : {}) };
        if (payees) return { oldValue, payees };
        if (AMOUNT_COLUMNS.has(normalized)) {
          return { oldValue, oldExchangeRateOverride, amounts: amountsSnapshot(tx) };
        }
        return { oldValue, oldExchangeRateOverride };
      },
      build: (args, _result, before) => {
        const previous = before as
          | {
              oldValue?: string | number | null;
              oldExchangeRateOverride?: boolean;
              amounts?: TransactionAmountsSnapshot;
              restore?: TransactionRestoreSnapshot;
              payees?: MissingPayees;
            }
          | undefined;
        const addedPayees = removeAddedPayees(previous?.payees);
        const exact = restoreUndo(previous, true);
        if (exact) return [...exact, ...addedPayees];
        // Without a captured old value the inverse would write `undefined`.
        if (!previous || !('oldValue' in previous) || previous.oldValue === undefined) return [];
        if (addedPayees.length) {
          return [
            {
              op: 'transactions.updateColumn',
              args: { id: args.id, columnName: args.columnName, newValue: previous.oldValue },
            },
            ...addedPayees,
          ];
        }
        if (previous.amounts?.ExchangeRateOverride) {
          // An amount edit re-resolves the rate and drops a manual override:
          // restore the row's amounts and rate exactly.
          return [
            {
              op: 'transactions.restoreAmounts',
              args: { id: args.id, amounts: previous.amounts },
            },
          ];
        }
        return [
          {
            op: 'transactions.updateColumn',
            args: {
              id: args.id,
              columnName: args.columnName,
              newValue: previous?.oldValue,
              ...(typeof previous?.oldExchangeRateOverride === 'boolean'
                ? { exchangeRateOverride: previous.oldExchangeRateOverride }
                : {}),
            },
          },
        ];
      },
    },
  },

  /** Undo of an amount edit on a row with a manual rate: see TransactionService.restoreAmounts. */
  'transactions.restoreAmounts': {
    execute: async (args) => {
      return await S().transactions!.restoreAmounts(
        args.id as number,
        args.amounts as TransactionAmountsSnapshot
      );
    },
    invalidates: TX_VALUE_UPDATE_INVALIDATION_KEYS,
  },

  // useDeleteTransaction
  'transactions.delete': {
    execute: async (args) => {
      // Make delete idempotent for batch/undo flows: skip if already missing
      try {
        await S().transactions!.getTransactionByID(args.id as number);
      } catch {
        return; // already deleted — no-op
      }
      return await S().transactions!.deleteTransaction(args.id as number);
    },
    invalidates: TX_WRITE_INVALIDATION_KEYS,
    undo: {
      // delete -> re-create from snapshot
      // If this was a transfer, capture both sides and restore them together.
      capture: async (args) => {
        try {
          const tx = await S().transactions!.getTransactionByID(args.id as number);
          // Exact: the row with its transfer partner or split lines and mirrors.
          const restore = captureRestore([tx.ID]);
          if (restore) return { restore };
          if (tx?.TransferID) {
            const group = await S().transactions!.getTransactionsByTransferID(tx.TransferID);
            return {
              snapshots: (Array.isArray(group) && group.length > 0 ? group : [tx]).map(
                withImportIdentities
              ),
            };
          }
          return { snapshots: [withImportIdentities(tx)] };
        } catch {
          return { snapshots: [] };
        }
      },
      build: (_args, _result, before) => restoreUndo(before) ?? restoreSnapshotsUndo(before),
    },
  },

  // Push API v2: update an existing transaction by its push reference —
  // the message_id of the POST /push that created it (recorded as
  // import-provenance `push:<message_id>` on apply). The only stable handle
  // an external integration can hold under E2E. Reuses the column-update
  // service so every field keeps its existing validation and side effects.
  'transactions.updateByRef': {
    execute: async (args) => {
      const ref = args.messageId;
      if (typeof ref !== 'string' || !ref.trim()) throw new Error('"messageId" is required.');
      const id = S().importHistory!.duplicates.findOperation(`push:${ref}`);
      if (id === undefined) {
        throw new Error(
          `No transaction found for push message_id "${ref}". Only transactions created via the Push API (with a message_id) can be updated by reference.`
        );
      }
      if (!args.fields || typeof args.fields !== 'object' || Array.isArray(args.fields)) {
        throw new Error('"fields" must be an object.');
      }
      const updated = await S().transactions!.updatePushedTransaction(
        id,
        args.fields as Record<string, unknown>
      );
      return { transactionId: id, updated };
    },
    invalidates: [...TX_WRITE_INVALIDATION_KEYS, ['payees'], ['payees', '*']],
  },

  // Push API v2: delete an existing transaction by its push reference.
  // True removal via the same service the UI delete uses (undo-safe snapshot
  // is unnecessary here: the caller is a headless integration, and the
  // mutation history still records the operation).
  'transactions.deleteByRef': {
    execute: async (args) => {
      const ref = args.messageId;
      if (typeof ref !== 'string' || !ref.trim()) throw new Error('"messageId" is required.');
      const id = S().importHistory!.duplicates.findOperation(`push:${ref}`);
      // Provenance is cascade-deleted with the transaction. Missing references
      // are successful no-ops so retries of a delete remain idempotent.
      if (id === undefined) return { deleted: false };
      await S().transactions!.deleteTransaction(id);
      return { transactionId: id, deleted: true };
    },
    invalidates: TX_WRITE_INVALIDATION_KEYS,
  },

  'transactions.deleteBatch': {
    execute: async (args) => {
      const ids = Array.isArray(args.ids) ? args.ids.map(Number) : [];
      return await S().transactions!.deleteTransactions(ids);
    },
    invalidates: TX_WRITE_INVALIDATION_KEYS,
    undo: {
      capture: async (args) => {
        const ids = Array.isArray(args.ids) ? args.ids.map(Number) : [];
        const restore = captureRestore(ids);
        if (restore) return { restore };
        return {
          snapshots: (await S().transactions!.getTransactionsForDelete(ids)).map(
            withImportIdentities
          ),
        };
      },
      build: (_args, _result, before) => {
        const exact = restoreUndo(before);
        if (exact) return exact;
        const beforeState = before as { snapshots?: TransactionSnapshot[] } | undefined;
        const snapshots = beforeState?.snapshots || [];
        if (!snapshots.length) return [];
        return [
          {
            op: 'transactions.restoreBatch',
            args: { snapshots: sortTransactionSnapshots(snapshots) },
          },
        ];
      },
    },
  },

  // Undo of batch deletes logged before transactions.restore existed.
  'transactions.restoreBatch': {
    execute: async (args) => {
      const snapshots = Array.isArray(args.snapshots)
        ? sortTransactionSnapshots(args.snapshots as TransactionSnapshot[])
        : [];

      const batch = writeBatch();
      for (const snapshot of snapshots) {
        const addArgs = transactionSnapshotToAddOp(snapshot).args;
        await addTransactionFromArgs(addArgs, batch ?? undefined);
      }
      batch?.commit();
    },
    invalidates: TX_WRITE_INVALIDATION_KEYS,
  },

  // Undo of a delete (or of an edit, with `replace`): puts the captured rows,
  // split lines, mirrors, provenance and links back exactly, in one write.
  'transactions.restore': {
    execute: async (args) => {
      if (!args.snapshot || typeof args.snapshot !== 'object') {
        throw new Error('"snapshot" is required.');
      }
      return S().transactions!.restoreTransactions(args.snapshot as TransactionRestoreSnapshot, {
        replace: args.replace === true,
      });
    },
    invalidates: [
      ...TX_WRITE_INVALIDATION_KEYS,
      ...SPLIT_INVALIDATION_KEYS,
      ...RECURRING_OCCURRENCE_INVALIDATIONS,
    ],
  },

  // The split editor's save: parent total and lines in one op and one write.
  'transactions.saveSplits': {
    execute: async (args) => {
      const amount = args.amount as
        { inflow?: unknown; outflow?: unknown; currency?: unknown } | undefined;
      return S().transactions!.saveSplitTransaction(args.transactionId as number, {
        amount: amount
          ? {
              inflow: asMilli(Number(amount.inflow ?? 0)),
              outflow: asMilli(Number(amount.outflow ?? 0)),
              currency: amount.currency === 'native' ? 'native' : 'converted',
            }
          : undefined,
        exactAmount: args.exactAmount as SplitParentAmounts | undefined,
        splits: normalizeSplitLines(args.splits),
      });
    },
    invalidates: [...TX_WRITE_INVALIDATION_KEYS, ...SPLIT_INVALIDATION_KEYS],
    undo: {
      capture: async (args) => {
        const restore = captureRestore([args.transactionId as number]);
        return restore ? { restore } : null;
      },
      build: (_args, _result, before) => restoreUndo(before, true) ?? [],
    },
  },

  // The register's batch toolbar: account / category / payee for many rows,
  // one op, one write, one undo step.
  'transactions.batchEdit': {
    execute: async (args) => {
      const edits = Array.isArray(args.edits) ? (args.edits as TransactionBatchEdit[]) : [];
      if (!edits.every((edit) => Number.isSafeInteger(edit?.id) && edit.id > 0)) {
        throw new Error('edits must list transaction ids.');
      }
      return S().transactions!.editTransactions(edits);
    },
    invalidates: [
      ...TX_UPDATE_COLUMN_INVALIDATION_KEYS,
      ...TX_MOVE_INVALIDATION_KEYS,
      ['accounts', '*'],
    ],
    undo: {
      capture: async (args) => {
        const edits = Array.isArray(args.edits) ? (args.edits as TransactionBatchEdit[]) : [];
        const restore = captureRestore(edits.map((edit) => edit.id));
        if (!restore) return null;
        const typed = edits.filter((edit) => edit.payee !== undefined);
        const payees = typed.length
          ? missingPayees(
              restore.transactions[0]?.BudgetID,
              typed.map((edit) => edit.payee)
            )
          : undefined;
        return payees ? { restore, payees } : { restore };
      },
      build: (_args, _result, before) => {
        const exact = restoreUndo(before, true);
        return exact
          ? [...exact, ...removeAddedPayees((before as { payees?: MissingPayees }).payees)]
          : [];
      },
    },
  },

  // useMoveTransactionToNewCategory
  'transactions.moveToNewCategory': {
    execute: async (args) => {
      return await S().transactions!.moveTransactionToNewCategory(
        args.transactionId as number,
        args.newCategoryId as number
      );
    },
    invalidates: TX_MOVE_INVALIDATION_KEYS,
    undo: {
      capture: async (args) => {
        const tx = (await S().transactions!.getTransactionByID(
          args.transactionId as number
        )) as unknown as TransactionRowWithColumns | undefined;
        return {
          oldCategoryId: tx?.CategoryID,
        };
      },
      build: (args, _result, before) => [
        {
          op: 'transactions.moveToNewCategory',
          args: {
            transactionId: args.transactionId,
            newCategoryId: (before as { oldCategoryId?: number } | undefined)?.oldCategoryId,
          },
        },
      ],
    },
  },

  // useMoveTransactionToNewAccount
  'transactions.moveToNewAccount': {
    execute: async (args) => {
      return await S().transactions!.moveTransactionToNewAccount(
        args.transactionId as number,
        args.newAccountId as number
      );
    },
    invalidates: [...TX_MOVE_INVALIDATION_KEYS, ['accounts', '*']],
    undo: {
      capture: async (args) => {
        const tx = (await S().transactions!.getTransactionByID(
          args.transactionId as number
        )) as unknown as TransactionRowWithColumns | undefined;
        // Across currencies the move converts the native amount: put the row back exactly.
        const restore =
          tx && crossCurrencyMove(tx.AccountID, args.newAccountId) ? captureRestore([tx.ID]) : null;
        return restore ? { oldAccountId: tx?.AccountID, restore } : { oldAccountId: tx?.AccountID };
      },
      build: (args, _result, before) =>
        restoreUndo(before, true) ?? [
          {
            op: 'transactions.moveToNewAccount',
            args: {
              transactionId: args.transactionId,
              newAccountId: (before as { oldAccountId?: number } | undefined)?.oldAccountId,
            },
          },
        ],
    },
  },

  // useReassignTransactions
  'transactions.reassign': {
    execute: async (args) => {
      return await S().transactions!.reassignTransactions(
        args.newCategoryId as number,
        args.oldCategoryId as number
      );
    },
    invalidates: [
      ...TRANSACTION_INVALIDATION_KEYS,
      ['transactionSplits', '*'],
      ...RECURRING_TEMPLATE_INVALIDATIONS,
    ],
  },

  // useReconcileAccount
  'transactions.reconcile': {
    execute: async (args) => {
      return await S().transactions!.reconcileAccount(
        args.accountId as number,
        args.reconcileDate as string | undefined
      );
    },
    invalidates: [
      ...ACCOUNT_TRANSACTION_INVALIDATION_KEYS,
      ['accounts', '*'], // Account's reconciled_at is updated
      ['allTransactions', '*'],
      ['allTransactionsDetailed', '*'],
      ['allTransactionsAnalytics', '*'],
      ['monthlyTransactions', '*'],
      ['spendingByLabels', '*'],
      ['labels', '*'],
      ['labelDirectory', '*'],
    ],
    undo: {
      build: (args, result) => reconcileUndo(args.accountId, result),
    },
  },
  // Locks only cleared transactions; uncleared ones stay open. Kept separate
  // from transactions.reconcile so older ops replay with their original meaning.
  'transactions.reconcileCleared': {
    execute: async (args): Promise<ReconcileWithAdjustment> => {
      // The balance adjustment is created inside the op (cleared, so it is
      // locked too) so one undo removes both.
      const adjustment = args.adjustment as Record<string, unknown> | undefined;
      const batch = writeBatch();
      if (batch) {
        // Adjustment and lock commit together.
        const adjustmentStep = adjustment
          ? await addTransactionFromArgs({ ...adjustment, cleared: true }, batch)
          : undefined;
        const reconcileStep = batch.queue(() =>
          S().transactions!.reconcileAccount(
            args.accountId as number,
            args.reconcileDate as string | undefined,
            { clearedOnly: true }
          )
        );
        const results = batch.commit();
        const result = results[reconcileStep] as ReconcileResult;
        return adjustmentStep === undefined
          ? result
          : { ...result, adjustmentId: results[adjustmentStep] as number };
      }
      const adjustmentId = adjustment
        ? await addTransactionFromArgs({ ...adjustment, cleared: true })
        : undefined;
      const result = S().transactions!.reconcileAccount(
        args.accountId as number,
        args.reconcileDate as string | undefined,
        { clearedOnly: true }
      );
      return adjustmentId === undefined ? result : { ...result, adjustmentId };
    },
    invalidates: [
      ...TRANSACTION_INVALIDATION_KEYS,
      ...ACCOUNT_TRANSACTION_INVALIDATION_KEYS,
      ['accounts', '*'],
      ['allTransactions', '*'],
      ['allTransactionsDetailed', '*'],
      ['allTransactionsAnalytics', '*'],
      ['monthlyTransactions', '*'],
    ],
    undo: {
      build: (args, result) => reconcileUndo(args.accountId, result),
    },
    // Redo re-creates the adjustment under the ID it first got, so the undo
    // entry that deletes it stays valid.
    redo: {
      build: (args, result) => {
        const { adjustmentId } = (result ?? {}) as ReconcileWithAdjustment;
        const adjustment = args.adjustment as Record<string, unknown> | undefined;
        return [
          {
            op: 'transactions.reconcileCleared',
            args:
              adjustment && adjustmentId !== undefined
                ? { ...args, adjustment: { ...adjustment, id: adjustmentId } }
                : args,
          },
        ];
      },
    },
  },
  'transactions.unreconcile': {
    execute: async (args) => {
      S().transactions!.unreconcileAccount(args.accountId as number, {
        reconciledIds: (args.reconciledIds as number[]) ?? [],
        newlyClearedIds: (args.newlyClearedIds as number[]) ?? [],
        previousReconciledAt: (args.previousReconciledAt as string | null) ?? null,
      });
    },
    invalidates: [
      ...ACCOUNT_TRANSACTION_INVALIDATION_KEYS,
      ['accounts', '*'],
      ['allTransactions', '*'],
      ['allTransactionsDetailed', '*'],
      ['allTransactionsAnalytics', '*'],
      ['monthlyTransactions', '*'],
    ],
  },
  'transactions.setCleared': {
    execute: async (args) => {
      const { ids } = args;
      if (!Array.isArray(ids) || !ids.every((id) => Number.isSafeInteger(id) && id > 0)) {
        throw new Error('ids must be a list of transaction ids.');
      }
      if (typeof args.cleared !== 'boolean') throw new Error('cleared must be true or false.');
      return { changed: S().transactions!.setTransactionsCleared(ids as number[], args.cleared) };
    },
    invalidates: [
      ...ACCOUNT_TRANSACTION_INVALIDATION_KEYS,
      ['accounts', '*'],
      ['allTransactions', '*'],
      ['allTransactionsDetailed', '*'],
    ],
    undo: {
      build: (args, result) => {
        const changed = (result as { changed?: number[] } | undefined)?.changed ?? [];
        return changed.length
          ? [{ op: 'transactions.setCleared', args: { ids: changed, cleared: !args.cleared } }]
          : [];
      },
    },
  },

  // Copies rows as new uncleared transactions. A transfer copies both legs
  // under a new transfer ID (supplied by the caller so replays match).
  'transactions.duplicate': {
    execute: async (args) => {
      const { ids } = args;
      if (!Array.isArray(ids) || !ids.every((id) => Number.isSafeInteger(id) && id > 0)) {
        throw new Error('ids must be a list of transaction ids.');
      }
      const transferIds = (args.transferIds ?? {}) as Record<string, string>;
      const reuseIds = Array.isArray(args.createdIds) ? (args.createdIds as number[]) : [];
      const created: number[] = [];
      const copied = new Set<string>();

      // With a batch every copy (and its lines) commits together; `created`
      // then holds step indexes until the commit turns them into IDs.
      const batch = writeBatch();
      const copy = async (row: TransactionSnapshot, transferId?: string) => {
        const {
          id: _id,
          importIdentities: _identities,
          ...addArgs
        } = transactionSnapshotToAddOp(row).args;
        const newId = await addTransactionFromArgs(
          {
            ...addArgs,
            transferId,
            cleared: false,
            id: reuseIds[created.length],
          },
          batch ?? undefined
        );
        created.push(newId);
        return newId;
      };

      for (const id of ids as number[]) {
        const row = (await S().transactions!.getTransactionByID(id)) as TransactionSnapshot;
        const sourceTransferId = row.TransferID?.trim();
        if (sourceTransferId) {
          // Split-transfer rows belong to their split parent; copy the parent instead.
          if (sourceTransferId.startsWith('split_transfer_') || copied.has(sourceTransferId)) {
            continue;
          }
          const newTransferId = transferIds[sourceTransferId];
          if (!newTransferId) throw new Error('A new transferId is required for each transfer.');
          copied.add(sourceTransferId);
          const legs = sortTransactionSnapshots(
            await S().transactions!.getTransactionsByTransferID(sourceTransferId)
          );
          for (const leg of legs) await copy(leg, newTransferId);
          continue;
        }

        const splits = S().splits.getSplits(id);
        const newId = await copy(row);
        if (splits.length) {
          await S().splits.upsertSplits(
            batch ? { batchIndex: newId } : newId,
            splits.map((line, index) => ({
              CategoryID: line.CategoryID ?? null,
              TransferAccountID: line.TransferAccountID ?? null,
              Memo: line.Memo,
              Payee: line.Payee ?? '',
              InflowConverted: line.InflowConverted,
              OutflowConverted: line.OutflowConverted,
              InflowNative: line.InflowNative ?? null,
              OutflowNative: line.OutflowNative ?? null,
              PairID: null,
              OrderIndex: line.OrderIndex ?? index,
            })),
            ...(batch ? [batch] : [])
          );
        }
      }
      if (batch) {
        const results = batch.commit();
        return { created: created.map((step) => results[step] as number) };
      }
      return { created };
    },
    invalidates: [...TX_WRITE_INVALIDATION_KEYS, ...SPLIT_INVALIDATION_KEYS],
    undo: {
      build: (_args, result) =>
        ((result as { created?: number[] } | undefined)?.created ?? []).map((id) => ({
          op: 'transactions.delete',
          args: { id },
        })),
    },
    // Redo recreates the copies under the IDs they first got.
    redo: {
      build: (args, result) => {
        const created = (result as { created?: number[] } | undefined)?.created ?? [];
        return created.length
          ? [{ op: 'transactions.duplicate', args: { ...args, createdIds: created } }]
          : [];
      },
    },
  },

  // upsert split transaction
  'transactions.upsertSplits': {
    execute: async (args) => {
      // Normalize client payload (snake_case) to core service shape (PascalCase).
      const normalized = normalizeSplitLines(args.splits);
      return S().splits.upsertSplits(args.transactionId as number, normalized);
    },
    invalidates: SPLIT_INVALIDATION_KEYS,
    undo: splitsUndo,
  },
  'transactions.clearSplits': {
    execute: async (args) => {
      return await S().splits.clearSplits(args.transactionId as number);
    },
    invalidates: SPLIT_INVALIDATION_KEYS,
    undo: splitsUndo,
  },
} satisfies Record<string, OpCodeEntry>;
