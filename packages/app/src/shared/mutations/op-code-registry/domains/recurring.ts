import type {
  CreateRecurringTransactionInput,
  MarkOccurrenceReadyOptions,
  MarkOccurrenceReadyResult,
  RecurringOccurrence,
  RecurringOccurrenceRef,
  RecurringTransaction,
  UpdateRecurringTransactionInput,
} from '@budgero/core/browser';
import {
  S,
  newOpRowId,
  redoWithIds,
  safeCapture,
  RECURRING_OCCURRENCE_INVALIDATIONS,
  RECURRING_TEMPLATE_INVALIDATIONS,
  TRANSACTION_INVALIDATION_KEYS,
  type OpCodeEntry,
} from '../shared';

// Analytics/projection queries union scheduled occurrences in as projections when
// their range extends past today, so changing recurring rules must refresh them.
const PROJECTION_CONSUMER_INVALIDATIONS: string[][] = [
  ['spendingByDates', '*'],
  ['spendingByDatesByCategories', '*'],
  ['spendingByCategoriesInGroup', '*'],
  ['analyticsPeriodSummary', '*'],
  ['topSpendingCategories', '*'],
  ['incomeExpenseByPeriod', '*'],
  ['spendingTotalsByPeriod', '*'],
  ['categoryTotalsByPeriod', '*'],
  ['spendingByLabels', '*'],
  ['spendingByPayees', '*'],
];

/**
 * Occurrence ops take `{ id, recurringTransactionId?, dueDate? }`. Occurrence
 * IDs are local to each device, so the core resolves the (template, due date)
 * key first and falls back to `id` for ops logged before the key existed.
 */
function occurrenceRef(args: Record<string, unknown>): RecurringOccurrenceRef {
  return {
    occurrenceId: args.id as number | undefined,
    recurringTransactionId: args.recurringTransactionId as number | undefined,
    dueDate: args.dueDate as string | undefined,
  };
}

/** Args addressing one occurrence, keyed from the op's result when it has one. */
function occurrenceArgs(
  ref: RecurringOccurrenceRef,
  occurrence?: Partial<RecurringOccurrence> | null
): Record<string, unknown> {
  const recurringTransactionId = occurrence?.recurringTransactionId ?? ref.recurringTransactionId;
  const dueDate = occurrence?.dueDate ?? ref.dueDate;
  const args: Record<string, unknown> = { id: occurrence?.id ?? ref.occurrenceId };
  if (recurringTransactionId != null && dueDate) {
    args.recurringTransactionId = recurringTransactionId;
    args.dueDate = dueDate;
  }
  return args;
}

export const recurringOps = {
  'recurring.create': {
    execute: async (args) => {
      return await S().recurring!.createRecurringTransaction(
        args.input as CreateRecurringTransactionInput
      );
    },
    invalidates: [
      ...RECURRING_TEMPLATE_INVALIDATIONS,
      ...RECURRING_OCCURRENCE_INVALIDATIONS,
      ...PROJECTION_CONSUMER_INVALIDATIONS,
    ],
    undo: {
      build: (_args, result) => {
        const id = (result as RecurringTransaction | undefined)?.id;
        return typeof id === 'number' ? [{ op: 'recurring.delete', args: { id } }] : [];
      },
    },
    redo: redoWithIds('recurring.create', (args, result) => {
      const id = (result as RecurringTransaction | undefined)?.id;
      return typeof id === 'number'
        ? { ...args, input: { ...(args.input as CreateRecurringTransactionInput), id } }
        : null;
    }),
  },
  'recurring.update': {
    execute: async (args) => {
      return await S().recurring!.updateRecurringTransaction(
        args.id as number,
        args.patch as UpdateRecurringTransactionInput
      );
    },
    invalidates: [
      ...RECURRING_TEMPLATE_INVALIDATIONS,
      ...RECURRING_OCCURRENCE_INVALIDATIONS,
      ...PROJECTION_CONSUMER_INVALIDATIONS,
    ],
    undo: {
      capture: async (args) =>
        safeCapture(() =>
          S().recurring!.getRecurringTransaction(args.id as number, { includeInactive: true })
        ),
      build: (args, _result, before) => {
        const template = before as RecurringTransaction | null;
        if (!template) return [];
        const patch: UpdateRecurringTransactionInput = {
          accountId: template.accountId,
          toAccountId: template.toAccountId,
          categoryId: template.categoryId,
          name: template.name,
          memo: template.memo,
          amount: template.amount,
          direction: template.direction,
          schedule: template.schedule,
          notifyDaysBefore: template.notifyDaysBefore,
          active: template.active,
        };
        return [{ op: 'recurring.update', args: { id: args.id, patch } }];
      },
    },
  },
  'recurring.delete': {
    execute: async (args) => {
      return await S().recurring!.deleteRecurringTransaction(args.id as number);
    },
    invalidates: [
      ...RECURRING_TEMPLATE_INVALIDATIONS,
      ...RECURRING_OCCURRENCE_INVALIDATIONS,
      ...PROJECTION_CONSUMER_INVALIDATIONS,
    ],
  },
  'recurring.markReady': {
    // A transfer template posts two legs sharing a TransferID: mint it here so
    // every device's legs carry the same one (later edits are keyed by it).
    prepare: (args) => {
      const options = (args.options ?? {}) as MarkOccurrenceReadyOptions;
      return options.transferId
        ? args
        : { ...args, options: { ...options, transferId: newOpRowId() } };
    },
    execute: async (args) => {
      return await S().recurring!.markOccurrenceReady(args.options as MarkOccurrenceReadyOptions);
    },
    invalidates: [
      ...RECURRING_OCCURRENCE_INVALIDATIONS,
      ...TRANSACTION_INVALIDATION_KEYS,
      ...RECURRING_TEMPLATE_INVALIDATIONS,
    ],
    undo: {
      capture: async (args) => {
        try {
          const options = args.options as MarkOccurrenceReadyOptions | undefined;
          if (!options) return null;
          const recurring = S().recurring!;
          const occurrence = await recurring.getOccurrenceWithTemplate(
            recurring.resolveOccurrenceId(options)
          );
          return { occurrence };
        } catch (error) {
          console.warn(
            '[OpCodeRegistry] Unable to capture occurrence before markReady undo',
            error
          );
          return null;
        }
      },
      build: (args, result, _before) => {
        const options = (args.options ?? {}) as MarkOccurrenceReadyOptions;
        const ready = result as MarkOccurrenceReadyResult | undefined;
        const transactionId = ready?.transactionId;
        const reset = occurrenceArgs(options, ready?.occurrence);
        if (!reset.id || transactionId == null || !Number.isFinite(transactionId)) {
          return [];
        }
        const ops: { op: string; args: Record<string, unknown> }[] = [];
        ops.push({ op: 'transactions.delete', args: { id: transactionId } });
        ops.push({ op: 'recurring.resetOccurrence', args: reset });
        return ops;
      },
    },
  },
  'recurring.skip': {
    execute: async (args) => {
      return await S().recurring!.skipOccurrence(occurrenceRef(args));
    },
    invalidates: [...RECURRING_OCCURRENCE_INVALIDATIONS, ...PROJECTION_CONSUMER_INVALIDATIONS],
    undo: {
      build: (args, result) => [
        {
          op: 'recurring.resetOccurrence',
          args: occurrenceArgs(occurrenceRef(args), result as RecurringOccurrence | undefined),
        },
      ],
    },
  },
  'recurring.markNotified': {
    execute: async (args) => {
      return await S().recurring!.markOccurrenceNotified(occurrenceRef(args));
    },
    invalidates: [...RECURRING_OCCURRENCE_INVALIDATIONS],
  },
  'recurring.resetOccurrence': {
    execute: async (args) => {
      return await S().recurring!.resetOccurrence(occurrenceRef(args));
    },
    invalidates: [...RECURRING_OCCURRENCE_INVALIDATIONS, ...RECURRING_TEMPLATE_INVALIDATIONS],
  },
} satisfies Record<string, OpCodeEntry>;
