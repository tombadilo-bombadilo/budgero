import type { ImportRunRecordInput } from '@budgero/core/browser';
import { S, type OpCodeEntry } from '../shared';

export const importHistoryOps = {
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
      ['transactions'],
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
