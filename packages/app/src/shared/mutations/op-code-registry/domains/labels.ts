import type { LabelSnapshot } from '@budgero/core/browser';
import {
  S,
  TRANSACTION_INVALIDATION_KEYS,
  makeRestoreUndo,
  redoWithIds,
  safeCapture,
  type OpCodeEntry,
} from '../shared';

export const labelOps = {
  'labels.add': {
    execute: async (args) => {
      return await S().labels.addLabel(
        args.budgetId as number,
        args.name as string,
        args.color as string,
        (args.id as number | undefined) ?? undefined
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
    redo: redoWithIds('labels.add', (args, result) =>
      typeof result === 'number' ? { ...args, id: result } : null
    ),
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
      // Deleting a label also clears it from its transactions: the undo puts
      // the label back under its ID on exactly those rows.
      capture: async (args) =>
        safeCapture(() => S().labels.snapshotLabel(args.id as number, args.budgetId as number)),
      build: (_args, _result, before) => {
        const snapshot = before as LabelSnapshot | null | undefined;
        if (!snapshot?.row) return [];
        return [
          {
            op: 'labels.restore',
            args: { budgetId: Number(snapshot.row.BudgetID), snapshot },
          },
        ];
      },
    },
  },

  'labels.restore': {
    execute: async (args) => {
      return S().labels.restoreLabel(args.budgetId as number, args.snapshot as LabelSnapshot);
    },
    invalidates: [...TRANSACTION_INVALIDATION_KEYS],
  },
} satisfies Record<string, OpCodeEntry>;
