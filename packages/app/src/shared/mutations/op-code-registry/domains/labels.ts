import {
  S,
  TRANSACTION_INVALIDATION_KEYS,
  makeRestoreUndo,
  safeCapture,
  type OpCodeEntry,
} from '../shared';

export const labelOps = {
  'labels.add': {
    execute: async (args) => {
      return await S().labels.addLabel(
        args.budgetId as number,
        args.name as string,
        args.color as string
      );
    },
    invalidates: [...TRANSACTION_INVALIDATION_KEYS],
    undo: {
      build: (args, result) => {
        const id = result as number | undefined;
        return typeof id === 'number' && Number.isFinite(id)
          ? [{ op: 'labels.delete', args: { id, budgetId: args.budgetId } }]
          : [];
      },
    },
  },

  'labels.update': {
    execute: async (args) => {
      return await S().labels.updateLabel(
        args.id as number,
        args.budgetId as number,
        args.name as string,
        args.color as string
      );
    },
    invalidates: [...TRANSACTION_INVALIDATION_KEYS],
    undo: makeRestoreUndo(
      'labels.update',
      async (args) => {
        const label = await S().labels.getLabelById(args.id as number, args.budgetId as number);
        return { oldName: label?.Name, oldColor: label?.Color };
      },
      (args, snapshot) => ({
        id: args.id,
        budgetId: args.budgetId,
        name: snapshot.oldName,
        color: snapshot.oldColor,
      })
    ),
  },

  'labels.delete': {
    execute: async (args) => {
      return await S().labels.deleteLabel(args.id as number, args.budgetId as number);
    },
    invalidates: [...TRANSACTION_INVALIDATION_KEYS],
    undo: {
      capture: async (args) =>
        safeCapture(async () => {
          const label = await S().labels.getLabelById(args.id as number, args.budgetId as number);
          return {
            name: label?.Name,
            color: label?.Color,
            budgetId: label?.BudgetID,
          };
        }),
      build: (_args, _result, before) => {
        const snapshot = before as
          | {
              budgetId?: number;
              name?: string;
              color?: string;
            }
          | null
          | undefined;
        if (!snapshot?.budgetId || !snapshot?.name || !snapshot?.color) return [];
        return [
          {
            op: 'labels.add',
            args: {
              budgetId: snapshot.budgetId,
              name: snapshot.name,
              color: snapshot.color,
            },
          },
        ];
      },
    },
  },
} satisfies Record<string, OpCodeEntry>;
