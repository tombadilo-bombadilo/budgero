import { type ImportIdentity, asMilli } from '@budgero/core/browser';
import {
  S,
  sortTransactionSnapshots,
  transactionSnapshotToAddOp,
  TRANSACTION_INVALIDATION_KEYS,
  ACCOUNT_TRANSACTION_INVALIDATION_KEYS,
  RECURRING_TEMPLATE_INVALIDATIONS,
  type NormalizedSplit,
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
];

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

async function addTransactionFromArgs(args: Record<string, unknown>): Promise<number> {
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
  return args.importIdentities
    ? S().transactions!.addTransaction(
        ...parameters,
        false,
        args.importIdentities as ImportIdentity[]
      )
    : S().transactions!.addTransaction(...parameters);
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
      return { transactionId: await addTransactionFromArgs(args), created: true };
    },
    invalidates: [...TRANSACTION_INVALIDATION_KEYS],
    undo: {
      build: (_args, result) => {
        const imported = result as { transactionId: number; created: boolean };
        return imported.created
          ? [{ op: 'transactions.delete', args: { id: imported.transactionId } }]
          : [];
      },
    },
  },
  'transactions.add': {
    execute: async (args) => {
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
      // add -> delete the created transaction
      build: (_args, result) => {
        const id = result as number | undefined;
        return typeof id === 'number' && Number.isFinite(id)
          ? [{ op: 'transactions.delete', args: { id } }]
          : [];
      },
    },
    // Customize redo to also restore the snapshots (useful for multi-leg transfers)
    redo: {
      build: (_args, _result, before) => {
        const beforeState = before as { snapshots?: TransactionSnapshot[] } | undefined;
        const snaps = beforeState?.snapshots || [];
        if (!snaps.length) return [];
        return sortTransactionSnapshots(snaps).map(transactionSnapshotToAddOp);
      },
    },
  },

  'transactions.addTransfer': {
    execute: async (args) => {
      const budgetId = args.budgetId as number;
      const transferId = args.transferId as string;
      const source = args.source as Record<string, unknown>;
      const destination = args.destination as Record<string, unknown>;

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
      // Use the stable TransferID because redo creates new database row IDs.
      build: (args) => {
        const { transferId } = args;
        return typeof transferId === 'string' && transferId
          ? [{ op: 'transactions.deleteTransfer', args: { transferId } }]
          : [];
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
      const transactions = await S().transactions!.getTransactionsByTransferID(transferId);
      const [first] = transactions;
      if (!first) return;
      // TransactionService.deleteTransaction removes every row with the same TransferID
      // while applying the normal balance and running-balance adjustments.
      await S().transactions!.deleteTransaction(first.ID);
    },
    invalidates: TX_WRITE_INVALIDATION_KEYS,
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
    invalidates: [...TX_WRITE_INVALIDATION_KEYS, ['payees'], ['payees', '*']],
    undo: {
      // capture current value before update so we can restore it
      capture: async (args) => {
        const tx = (await S().transactions!.getTransactionByID(
          args.id as number
        )) as unknown as TransactionRowWithColumns;
        const col = args.columnName as string;
        const oldValue = tx[col];
        const oldExchangeRateOverride =
          col.toLowerCase().replace(/_/g, '') === 'exchangerate'
            ? Boolean(tx.ExchangeRateOverride)
            : undefined;
        return { oldValue, oldExchangeRateOverride };
      },
      build: (args, _result, before) => {
        const previous = before as
          | {
              oldValue?: string | number | null;
              oldExchangeRateOverride?: boolean;
            }
          | undefined;
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
      build: (_args, _result, before) => {
        const beforeState = before as { snapshots?: TransactionSnapshot[] } | undefined;
        const snaps = beforeState?.snapshots || [];
        if (!snaps.length) return [];
        return sortTransactionSnapshots(snaps).map(transactionSnapshotToAddOp);
      },
    },
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
        return {
          snapshots: (await S().transactions!.getTransactionsForDelete(ids)).map(
            withImportIdentities
          ),
        };
      },
      build: (_args, _result, before) => {
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

  'transactions.restoreBatch': {
    execute: async (args) => {
      const snapshots = Array.isArray(args.snapshots)
        ? sortTransactionSnapshots(args.snapshots as TransactionSnapshot[])
        : [];

      for (const snapshot of snapshots) {
        const addArgs = transactionSnapshotToAddOp(snapshot).args;
        await addTransactionFromArgs(addArgs);
      }
    },
    invalidates: TX_WRITE_INVALIDATION_KEYS,
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
        return { oldAccountId: tx?.AccountID };
      },
      build: (args, _result, before) => [
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
  },

  // upsert split transaction
  'transactions.upsertSplits': {
    execute: async (args) => {
      // Normalize client payload (snake_case) to core service shape (PascalCase).
      // asMilli doubles as the op-boundary guard: a decimal amount in a payload
      // throws here instead of reaching an integer column.
      const normalized: NormalizedSplit[] = ((args.splits as Record<string, unknown>[]) || []).map(
        (s, idx) => {
          const inflowOriginal = s.InflowNative ?? s.InflowOriginal ?? s.inflow_original ?? null;
          const outflowOriginal =
            s.OutflowNative ?? s.OutflowOriginal ?? s.outflow_original ?? null;
          return {
            CategoryID: (s.CategoryID ?? s.category_id ?? null) as number | null,
            TransferAccountID: (s.TransferAccountID ?? s.transfer_account_id ?? null) as
              number | null,
            Memo: String(s.Memo ?? s.memo ?? ''),
            Payee: String(s.Payee ?? s.payee ?? ''),
            InflowConverted: asMilli(Number(s.InflowConverted ?? s.Inflow ?? s.inflow ?? 0)),
            OutflowConverted: asMilli(Number(s.OutflowConverted ?? s.Outflow ?? s.outflow ?? 0)),
            InflowNative: inflowOriginal == null ? null : asMilli(Number(inflowOriginal)),
            OutflowNative: outflowOriginal == null ? null : asMilli(Number(outflowOriginal)),
            PairID: (s.PairID ?? s.pair_id ?? null) as string | null,
            OrderIndex: Number(s.OrderIndex ?? s.order_index ?? idx),
          };
        }
      );
      return S().splits.upsertSplits(args.transactionId as number, normalized);
    },
    invalidates: SPLIT_INVALIDATION_KEYS,
  },
  'transactions.clearSplits': {
    execute: async (args) => {
      return await S().splits.clearSplits(args.transactionId as number);
    },
    invalidates: SPLIT_INVALIDATION_KEYS,
  },
} satisfies Record<string, OpCodeEntry>;
