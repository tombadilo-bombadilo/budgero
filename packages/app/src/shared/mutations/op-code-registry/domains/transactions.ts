import { asMilli } from '@budgero/core/browser';
import {
  S,
  sortTransactionSnapshots,
  transactionSnapshotToAddOp,
  TRANSACTION_INVALIDATION_KEYS,
  type NormalizedSplit,
  type OpCodeEntry,
  type TransactionRowWithColumns,
  type TransactionSnapshot,
} from '../shared';

const SPLIT_INVALIDATION_KEYS: [string, ...string[]][] = [
  ['transactions', '*'],
  ['allTransactions', '*'],
  ['allTransactionsDetailed', '*'],
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
  ['transactions'],
  ['transactionsByCategoryAndMonth', '*'],
  ['allTransactions', '*'],
  ['allTransactionsDetailed', '*'],
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
  ['transactions'],
  ['allTransactions', '*'],
  ['allTransactionsDetailed', '*'],
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

export const transactionOps = {
  'transactions.add': {
    execute: async (args) => {
      return await S().transactions!.addTransaction(
        asMilli(Number(args.inflow ?? 0)),
        asMilli(Number(args.outflow ?? 0)),
        args.accountId as number,
        args.categoryId as number,
        args.budgetId as number,
        args.date as string,
        args.memo as string,
        (args.transferId as string | undefined) || '',
        (args.payee as string | undefined) ?? '',
        (args.labelId as number | null | undefined) ?? null
      );
    },
    invalidates: [...TRANSACTION_INVALIDATION_KEYS],
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

  // useUpdateTransactionColumn
  'transactions.updateColumn': {
    execute: async (args) => {
      return await S().transactions!.updateTransactionColumn(
        args.id as number,
        args.columnName as string,
        args.newValue as string | number | null
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
        return { oldValue };
      },
      build: (args, _result, before) => [
        {
          op: 'transactions.updateColumn',
          args: {
            id: args.id,
            columnName: args.columnName,
            newValue: (before as { oldValue?: string | number | null } | undefined)?.oldValue,
          },
        },
      ],
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
            return { snapshots: Array.isArray(group) && group.length > 0 ? group : [tx] };
          }
          return { snapshots: [tx] };
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
    invalidates: TX_MOVE_INVALIDATION_KEYS,
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
      ['transactions', '*'],
      ['accounts', '*'], // Account's reconciled_at is updated
      ['allTransactions', '*'],
      ['allTransactionsDetailed', '*'],
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
          const inflowOriginal = s.InflowOriginal ?? s.inflow_original ?? null;
          const outflowOriginal = s.OutflowOriginal ?? s.outflow_original ?? null;
          return {
            CategoryID: (s.CategoryID ?? s.category_id ?? null) as number | null,
            TransferAccountID: (s.TransferAccountID ?? s.transfer_account_id ?? null) as
              | number
              | null,
            Memo: String(s.Memo ?? s.memo ?? ''),
            Inflow: asMilli(Number(s.Inflow ?? s.inflow ?? 0)),
            Outflow: asMilli(Number(s.Outflow ?? s.outflow ?? 0)),
            InflowOriginal: inflowOriginal == null ? null : asMilli(Number(inflowOriginal)),
            OutflowOriginal: outflowOriginal == null ? null : asMilli(Number(outflowOriginal)),
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
