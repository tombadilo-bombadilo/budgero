import { S, TRANSACTION_INVALIDATION_KEYS, type OpCodeEntry } from '../shared';

export const payeeOps = {
  'payees.add': {
    execute: async (args) => {
      return await S().payees.addPayee(args.budgetId as number, args.name as string);
    },
    invalidates: [['payees'], ['payees', '*'], ['payeeDirectory'], ['payeeDirectory', '*']],
    undo: {
      // add -> delete
      build: (args) => [
        {
          op: 'payees.delete',
          args: { budgetId: args.budgetId, name: args.name },
        },
      ],
    },
  },
  'payees.rename': {
    execute: async (args) => {
      return await S().payees.renamePayee(
        args.budgetId as number,
        args.oldName as string,
        args.newName as string
      );
    },
    invalidates: [...TRANSACTION_INVALIDATION_KEYS, ['payeeDirectory'], ['payeeDirectory', '*']],
    undo: {
      // rename -> rename back (swap old and new)
      build: (args) => [
        {
          op: 'payees.rename',
          args: {
            budgetId: args.budgetId,
            oldName: args.newName,
            newName: args.oldName,
          },
        },
      ],
    },
  },
  'payees.delete': {
    execute: async (args) => {
      return await S().payees.deletePayee(args.budgetId as number, args.name as string);
    },
    invalidates: [...TRANSACTION_INVALIDATION_KEYS, ['payeeDirectory'], ['payeeDirectory', '*']],
    undo: {
      // delete -> add back
      build: (args) => [
        {
          op: 'payees.add',
          args: { budgetId: args.budgetId, name: args.name },
        },
      ],
    },
  },
} satisfies Record<string, OpCodeEntry>;
