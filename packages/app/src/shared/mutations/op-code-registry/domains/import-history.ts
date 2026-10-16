import type { ImportRunRecordInput, ImportIdentity } from '@budgero/core/browser';
import { S, ACCOUNT_TRANSACTION_INVALIDATION_KEYS, type OpCodeEntry } from '../shared';

export const importHistoryOps = {
  'importHistory.match': {
    execute: async (args) => {
      const tx = await S().transactions!.getTransactionByID(args.transactionId as number);
      if (tx.BudgetID !== args.budgetId || tx.AccountID !== args.accountId)
        throw new Error('Import destination changed');
      S().importHistory!.duplicates.record(tx.ID, args.identity as ImportIdentity);
    },
    invalidates: [['importHistory']],
    undo: {
      // Only a match that recorded the identity is undone (it may already
      // have belonged to a transaction, in which case record() was a no-op).
      capture: async (args) => ({
        existing: S().importHistory!.duplicates.findOperation(
          (args.identity as ImportIdentity).operationId
        ),
      }),
      build: (args, _result, before) =>
        (before as { existing?: number } | undefined)?.existing === undefined
          ? [
              {
                op: 'importHistory.unmatch',
                args: {
                  budgetId: args.budgetId,
                  transactionId: args.transactionId,
                  operationId: (args.identity as ImportIdentity).operationId,
                },
              },
            ]
          : [],
    },
  },
  'importHistory.unmatch': {
    execute: async (args) => {
      S().importHistory!.duplicates.forget(
        args.transactionId as number,
        args.operationId as string
      );
    },
    invalidates: [['importHistory']],
  },
  'importHistory.record': {
    execute: async (args) => {
      return await S().importHistory!.recordImportRun(args.input as ImportRunRecordInput);
    },
    invalidates: [['importHistory']],
  },
  'importHistory.undo': {
    execute: async (args) => {
      return await S().importHistory!.undoImportRun(args.id as number);
    },
    invalidates: [
      ...ACCOUNT_TRANSACTION_INVALIDATION_KEYS,
      ['categories'],
      ['accounts'],
      ['monthlyBudget'],
      ['readyToAssign'],
      ['uncategorizedTransactions', '*'],
      ['importHistory'],
    ],
  },
  'importHistory.delete': {
    execute: async (args) => {
      await S().importHistory!.deleteImportRun(args.id as number);
    },
    invalidates: [['importHistory']],
  },
} satisfies Record<string, OpCodeEntry>;
