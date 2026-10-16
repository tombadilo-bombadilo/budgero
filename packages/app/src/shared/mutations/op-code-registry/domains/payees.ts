import type { PayeeSnapshot, RestorePayeesInput } from '@budgero/core/browser';
import {
  S,
  TRANSACTION_INVALIDATION_KEYS,
  safeCapture,
  type OpCall,
  type OpCodeEntry,
} from '../shared';

const PAYEE_WRITE_INVALIDATIONS: string[][] = [
  ...TRANSACTION_INVALIDATION_KEYS,
  ['payeeDirectory'],
  ['payeeDirectory', '*'],
];

/** Undo of a payee delete: the directory rows and the exact rows that had each name. */
const restoreDeletedPayeesUndo: NonNullable<OpCodeEntry['undo']> = {
  capture: async (args) =>
    safeCapture(() =>
      S().payees.snapshotPayees(
        args.budgetId as number,
        Array.isArray(args.names) ? (args.names as string[]) : [args.name as string]
      )
    ),
  build: (args, _result, before) => {
    const snapshot = before as PayeeSnapshot | null | undefined;
    if (!snapshot) return [];
    return restorePayeesOps(args.budgetId, {
      rows: snapshot.rows,
      assignments: snapshot.assignments,
    });
  },
};

function restorePayeesOps(budgetId: unknown, input: RestorePayeesInput): OpCall[] {
  const empty = !input.rows?.length && !input.assignments?.length && !input.removeNames?.length;
  return empty ? [] : [{ op: 'payees.restore', args: { budgetId, ...input } }];
}

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
        args.newName as string,
        typeof args.newPayeeId === 'number' ? args.newPayeeId : undefined
      );
    },
    invalidates: PAYEE_WRITE_INVALIDATIONS,
    undo: {
      // A rename into an existing name is a merge: renaming back would also
      // rename the rows that already had the new name. Restore exactly the
      // rows and directory entry the old name had instead.
      capture: async (args) =>
        safeCapture(() => {
          const budgetId = args.budgetId as number;
          const newName = ((args.newName as string) || '').trim();
          return {
            snapshot: S().payees.snapshotPayees(budgetId, [args.oldName as string]),
            newName,
            newExisted: S().payees.hasSavedPayee(budgetId, newName),
          };
        }),
      build: (args, result, before) => {
        const captured = before as
          { snapshot: PayeeSnapshot; newName: string; newExisted: boolean } | null | undefined;
        const updated = (result as { updated?: number } | undefined)?.updated;
        if (!captured) return [];
        if (!updated && !captured.snapshot.rows.length) return [];
        return restorePayeesOps(args.budgetId, {
          removeNames: captured.newExisted || !captured.newName ? [] : [captured.newName],
          rows: captured.snapshot.rows,
          assignments: captured.snapshot.assignments,
        });
      },
    },
    redo: {
      // When the rename created the destination entry, redo re-creates it
      // under the same ID (read right after the rename ran).
      build: (args, _result, before) => {
        const captured = before as { newName?: string; newExisted?: boolean } | null | undefined;
        const createdId =
          captured && !captured.newExisted && captured.newName
            ? S().payees.getSavedPayeeId(args.budgetId as number, captured.newName)
            : undefined;
        return [
          {
            op: 'payees.rename',
            args: createdId === undefined ? args : { ...args, newPayeeId: createdId },
          },
        ];
      },
    },
  },
  'payees.delete': {
    execute: async (args) => {
      return await S().payees.deletePayee(args.budgetId as number, args.name as string);
    },
    invalidates: PAYEE_WRITE_INVALIDATIONS,
    undo: restoreDeletedPayeesUndo,
  },
  'payees.deleteMany': {
    execute: async (args) => {
      return await S().payees.deletePayees(args.budgetId as number, args.names as string[]);
    },
    invalidates: PAYEE_WRITE_INVALIDATIONS,
    undo: restoreDeletedPayeesUndo,
  },
  /** Undo of rename/delete: see PayeeService.restorePayees. */
  'payees.restore': {
    execute: async (args) => {
      return S().payees.restorePayees(args.budgetId as number, {
        rows: args.rows as RestorePayeesInput['rows'],
        assignments: args.assignments as RestorePayeesInput['assignments'],
        removeNames: args.removeNames as RestorePayeesInput['removeNames'],
      });
    },
    invalidates: PAYEE_WRITE_INVALIDATIONS,
  },
} satisfies Record<string, OpCodeEntry>;
