import { asMilli } from '@budgero/core/browser';
import { S, type OpCodeEntry } from '../shared';

export const warrantyOps = {
  'warranties.create': {
    execute: async (args) => {
      return await S().warranties.create({
        budgetId: args.budgetId as number,
        name: args.name as string,
        expiresAt: args.expiresAt as string,
        amount: args.amount == null ? undefined : asMilli(Number(args.amount)),
        transactionId: args.transactionId as number | null | undefined,
        receiptImage: args.receiptImage as Uint8Array | null | undefined,
        notes: args.notes as string | undefined,
      });
    },
    invalidates: [['warranties', '*']],
  },

  'warranties.update': {
    execute: async (args) => {
      return await S().warranties.update({
        id: args.id as number,
        name: args.name as string | undefined,
        expiresAt: args.expiresAt as string | undefined,
        amount: args.amount == null ? undefined : asMilli(Number(args.amount)),
        transactionId: args.transactionId as number | null | undefined,
        receiptImage: args.receiptImage as Uint8Array | null | undefined,
        notes: args.notes as string | undefined,
      });
    },
    invalidates: [['warranties', '*']],
  },

  'warranties.delete': {
    execute: async (args) => {
      return await S().warranties.delete(args.id as number);
    },
    invalidates: [['warranties', '*']],
  },
} satisfies Record<string, OpCodeEntry>;
